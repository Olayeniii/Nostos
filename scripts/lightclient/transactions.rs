//! Full transaction enhancement and exact output matching. No signing or sends.
use std::{collections::HashMap, io::Cursor};
use tonic::{service::interceptor::InterceptedService, transport::Channel};
use zcash_address::unified::{self, Container, Encoding};
use zcash_client_backend::{TransferType, data_api::{WalletRead, wallet::decrypt_and_store_transaction},
    proto::service::{compact_tx_streamer_client::CompactTxStreamerClient, BlockId, TxFilter}};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_primitives::transaction::{Transaction, TxId};
use zcash_protocol::{ShieldedPool, consensus::{BlockHeight, BranchId, Parameters, MAIN_NETWORK}, memo::MemoBytes, value::Zatoshis};
use super::Database;

type Filter = fn(tonic::Request<()>) -> Result<tonic::Request<()>, tonic::Status>;
pub type Client = CompactTxStreamerClient<InterceptedService<Channel, Filter>>;

pub fn shielded_reads(request: tonic::Request<()>) -> Result<tonic::Request<()>, tonic::Status> {
    let allowed = request.extensions().get::<tonic::GrpcMethod>().is_some_and(|m| matches!(m.method(),
        "GetLightdInfo" | "GetTreeState" | "GetLatestBlock" | "GetBlockRange" | "GetSubtreeRoots"
        | "GetTransaction" | "GetBlock"));
    if allowed {Ok(request)} else {Err(tonic::Status::permission_denied("method_not_allowlisted"))}
}

pub fn client(channel: Channel) -> Client {
    CompactTxStreamerClient::with_interceptor(channel, shielded_reads as Filter)
}

// No Debug/serialization: a receiver or decrypted memo must not enter logs.
#[derive(Clone)]
pub struct OrchardReceiver([u8;43]);
impl OrchardReceiver {
    pub fn parse_mainnet(address: &str) -> Result<Self, &'static str> {
        if address.len()>512 {return Err("route_length");}
        let (network, ua) = unified::Address::decode(address).map_err(|_| "route_decode")?;
        if network != MAIN_NETWORK.network_type() {return Err("route_network");}
        match ua.items().as_slice() {
            [unified::Receiver::Orchard(bytes)] if ua.encode(&network)==address
                && bool::from(orchard::Address::from_raw_address_bytes(bytes).is_some()) => Ok(Self(*bytes)),
            _ => Err("route_requires_only_orchard"),
        }
    }
}

pub struct Expected<A> {
    account: A, receiver: OrchardReceiver, amount: u64, memo: MemoBytes,
    pool: ShieldedPool, direction: TransferType, confirmations: u32,
}
impl<A> Expected<A> {
    pub fn new(account: A, receiver: OrchardReceiver, amount: u64, memo: MemoBytes,
        pool: ShieldedPool, direction: TransferType, confirmations: u32) -> Result<Self, &'static str> {
        if amount==0 || Zatoshis::from_u64(amount).is_err() || confirmations==0
            || !matches!(pool,ShieldedPool::Orchard | ShieldedPool::Ironwood)
            || !matches!(direction,TransferType::Incoming | TransferType::Outgoing) {
            return Err("invalid_output_expectation");
        }
        Ok(Self{account,receiver,amount,memo,pool,direction,confirmations})
    }
}

// Only enhance() can establish this context outside tests. Parsing a transaction
// or receiving a nonzero height alone cannot construct confirmed evidence.
pub struct VerifiedTransaction {tx: Transaction, height: u32, tip: u32, anchor: zcash_primitives::block::BlockHash}
impl VerifiedTransaction {
    pub fn txid(&self) -> TxId {self.tx.txid()}
    pub fn store(&self, db: &mut Database) -> Result<(), &'static str> {
        // Refuse to persist after the wallet's anchored block has changed.
        let known = db.get_tx_height(self.tx.txid()).map_err(|_| "wallet_tx_height")?;
        if known != Some(BlockHeight::from_u32(self.height))
            || db.get_block_hash(BlockHeight::from_u32(self.height)).map_err(|_| "wallet_block_hash")? != Some(self.anchor) {
            return Err("wallet_anchor_changed");
        }
        decrypt_and_store_transaction(&MAIN_NETWORK,db,&self.tx,Some(BlockHeight::from_u32(self.height)))
            .map_err(|_| "transaction_store")
    }
    pub fn matching_output<A: Copy+Eq>(&self, keys: &HashMap<A,UnifiedFullViewingKey>, expected: &Expected<A>)
        -> Result<usize, &'static str> {
        if self.tip.checked_sub(self.height).and_then(|n| n.checked_add(1)).unwrap_or(0) < expected.confirmations {
            return Err("insufficient_confirmations");
        }
        if !keys.contains_key(&expected.account) {return Err("account_not_observed");}
        let decrypted = zcash_client_backend::decrypt_transaction(&MAIN_NETWORK,
            Some(BlockHeight::from_u32(self.height)),Some(BlockHeight::from_u32(self.tip)),&self.tx,keys);
        let outputs = match expected.pool {
            ShieldedPool::Orchard => decrypted.orchard_outputs(),
            ShieldedPool::Ironwood => decrypted.ironwood_outputs(),
            _ => return Err("unsupported_pool"),
        };
        let matches: Vec<_> = outputs.iter().filter(|out|
            *out.account()==expected.account && out.value_pool()==expected.pool
            && out.transfer_type()==expected.direction
            && out.note().recipient().to_raw_address_bytes()==expected.receiver.0
            && out.note().value().inner()==expected.amount && out.memo()==&expected.memo
        ).map(|out|out.index()).collect();
        match matches.as_slice() {
            [index] => Ok(*index), [] => Err("exact_output_not_found"), _ => Err("ambiguous_output_match"),
        }
    }
}

fn decode(bytes: &[u8], expected: TxId, height: u32, tip: u32) -> Result<Transaction, &'static str> {
    if bytes.is_empty() || bytes.len()>2_000_000 || height==0 || height>tip {return Err("transaction_bounds");}
    let branch = BranchId::for_height(&MAIN_NETWORK,BlockHeight::from_u32(height));
    let mut cursor = Cursor::new(bytes);
    let tx = Transaction::read(&mut cursor,branch).map_err(|_| "transaction_decode")?;
    if cursor.position()!=bytes.len() as u64 || tx.txid()!=expected || tx.consensus_branch_id()!=branch {
        return Err("transaction_identity");
    }
    Ok(tx)
}

pub async fn enhance(client: &mut Client, db: &Database, requested: TxId)
    -> Result<VerifiedTransaction, &'static str> {
    let tip = db.chain_height().map_err(|_| "chain_height")?.ok_or("no_chain_tip")?;
    if db.block_fully_scanned().map_err(|_| "scan_height")?.map(|b|b.block_height()) != Some(tip) {
        return Err("wallet_not_fully_scanned");
    }
    let raw = client.get_transaction(TxFilter{block:None,index:0,hash:requested.as_ref().to_vec()})
        .await.map_err(|_| "transaction_rpc_unresolved")?.into_inner();
    let height = u32::try_from(raw.height).map_err(|_| "transaction_not_main_chain")?;
    let tx = decode(&raw.data,requested,height,u32::from(tip))?;
    let h = BlockHeight::from_u32(height);
    if db.get_tx_height(requested).map_err(|_| "wallet_tx_height")? != Some(h) {return Err("wallet_tx_height_mismatch");}
    let anchor = db.get_block_hash(h).map_err(|_| "wallet_block_hash")?.ok_or("unscanned_transaction_block")?;
    let block = client.get_block(BlockId{height:raw.height,hash:vec![]})
        .await.map_err(|_| "transaction_block_rpc")?.into_inner();
    if block.height!=raw.height || block.hash.as_slice()!=anchor.0
        || block.vtx.iter().filter(|t|t.hash.as_slice()==requested.as_ref()).count()!=1 {
        return Err("transaction_block_mismatch");
    }
    Ok(VerifiedTransaction{tx,height,tip:u32::from(tip),anchor})
}

pub async fn enhance_pending(client: &mut Client, db: &mut Database) -> Result<usize, &'static str> {
    use zcash_client_backend::data_api::TransactionDataRequest;
    let requests = db.transaction_data_requests().map_err(|_| "enhancement_queue")?;
    let mut stored = 0;
    for request in requests.into_iter().take(32) {
        let id = match request {
            TransactionDataRequest::Enhancement(id) | TransactionDataRequest::GetStatus(id) => id,
            _ => return Err("unsupported_transaction_request"),
        };
        // Any unavailable/unmined/conflicting result stays unresolved. No failed status,
        // reservation clearance, retry permission or send is inferred here.
        enhance(client,db,id).await?.store(db)?;
        stored += 1;
    }
    Ok(stored)
}

pub async fn check_public_fetch(client: &mut Client, db: &Database) -> Result<(), &'static str> {
    let tip = db.block_fully_scanned().map_err(|_| "scan_height")?.ok_or("no_scan_height")?.block_height();
    let height = u32::from(tip).checked_sub(1).ok_or("scan_height")?;
    let anchor = db.get_block_hash(BlockHeight::from_u32(height)).map_err(|_| "block_hash")?.ok_or("no_block_hash")?;
    let block = client.get_block(BlockId{height:u64::from(height),hash:vec![]})
        .await.map_err(|_| "public_block_rpc")?.into_inner();
    if block.height!=u64::from(height) || block.hash.as_slice()!=anchor.0 {return Err("public_block_anchor");}
    let hash: [u8;32] = block.vtx.first().ok_or("public_block_empty")?.hash.as_slice().try_into().map_err(|_| "public_txid")?;
    let id = TxId::from_bytes(hash);
    let raw = client.get_transaction(TxFilter{block:None,index:0,hash:hash.to_vec()})
        .await.map_err(|_| "public_transaction_rpc")?.into_inner();
    if raw.height!=u64::from(height) {return Err("public_transaction_height");}
    decode(&raw.data,id,height,u32::from(tip))?;
    Ok(())
}

#[cfg(test)]
#[path = "transaction_tests.rs"]
mod tests;
