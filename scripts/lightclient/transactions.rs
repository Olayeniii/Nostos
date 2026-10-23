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
    pub fn require_external_to(&self, key: &UnifiedFullViewingKey) -> Result<(), &'static str> {
        let address=Option::<orchard::Address>::from(orchard::Address::from_raw_address_bytes(&self.0))
            .ok_or("control_receiver")?;
        if key.orchard().ok_or("control_keys")?.scope_for_address(&address).is_some() {
            return Err("control_self_transfer");
        }
        Ok(())
    }
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
    pub fn verify_product<A: Copy+Eq+std::hash::Hash>(&self,
        keys: &HashMap<A,UnifiedFullViewingKey>, expected: &Expected<A>,
        owned: &[orchard::note::Nullifier], remote_tip: u32, fee_cap: u64,
        binding: &str, account_uuid: &str, tip_hash: &str)
        -> Result<serde_json::Value, &'static str> {
        if expected.confirmations<3 || remote_tip!=self.tip || self.tx.transparent_bundle().is_some()
            || self.tx.sprout_bundle().is_some() {return Err("product_context");}
        let outgoing=expected.direction==TransferType::Outgoing;
        let fee=if outgoing {
            expected.receiver.require_external_to(keys.get(&expected.account).ok_or("product_keys")?)?;
            if self.tx.sapling_bundle().is_some() {return Err("product_input_pool");}
            let bundle=match expected.pool {
                ShieldedPool::Orchard=>self.tx.orchard_bundle(),
                ShieldedPool::Ironwood=>self.tx.ironwood_bundle(),
                _=>None,
            }.ok_or("product_output_pool")?;
            if !bundle.actions().iter().any(|a| owned.contains(a.nullifier())) {
                return Err("product_owned_spend");
            }
            let fee=self.tx.fee_paid::<zcash_protocol::value::BalanceError,_>(|_| Ok(None))
                .map_err(|_| "product_fee")?.ok_or("product_fee")?.into_u64();
            if fee_cap==0 || fee>fee_cap {return Err("product_fee_cap");}
            Some(fee)
        } else {None};
        let index=self.matching_output(keys,expected)?;
        Ok(serde_json::json!({"nostos_output_proof_v1":true,"network":"mainnet",
            "observation_scope":"orchard-family-only","payments_enabled":false,
            "binding":binding,"account_uuid":account_uuid,"txid":self.txid().to_string(),
            "pool":if expected.pool==ShieldedPool::Ironwood {"ironwood"} else {"orchard"},
            "direction":if outgoing {"outgoing"} else {"incoming"},"amount_zat":expected.amount,
            "output_index":index,"height":self.height,"block_hash":self.anchor.to_string(),
            "tip_height":self.tip,"tip_hash":tip_hash,"confirmations":self.tip-self.height+1,
            "fee_zat":fee,"exact_match":true,"owned_spend":outgoing}))
    }
    // Control-only check. The caller must source these nullifiers from the
    // already-bound account, including notes now marked spent after scanning.
    fn control_policy(&self, owned: &[orchard::note::Nullifier]) -> Result<u64, &'static str> {
        if self.tx.transparent_bundle().is_some() || self.tx.sprout_bundle().is_some()
            || self.tx.sapling_bundle().is_some() || self.tx.orchard_bundle().is_some() {
            return Err("control_unexpected_pool");
        }
        let bundle = self.tx.ironwood_bundle().ok_or("control_ironwood_required")?;
        if !bundle.actions().iter().any(|a| owned.contains(a.nullifier())) {
            return Err("control_owned_spend_required");
        }
        let fee = self.tx.fee_paid::<zcash_protocol::value::BalanceError, _>(|_| Ok(None))
            .map_err(|_| "control_fee_unresolved")?.ok_or("control_fee_unresolved")?.into_u64();
        if fee > 10_000 {return Err("control_fee_cap");}
        Ok(fee)
    }
    pub fn verify_control<A: Copy+Eq+std::hash::Hash>(&self,
        keys: &HashMap<A,UnifiedFullViewingKey>, expected: &Expected<A>,
        owned: &[orchard::note::Nullifier], remote_tip: u32)
        -> Result<serde_json::Value, &'static str> {
        if expected.amount!=10_000 || expected.pool!=ShieldedPool::Ironwood
            || expected.direction!=TransferType::Outgoing || expected.confirmations<3 {
            return Err("control_expectation");
        }
        if remote_tip!=self.tip {return Err("control_chain_changed");}
        expected.receiver.require_external_to(keys.get(&expected.account).ok_or("control_keys")?)?;
        let fee=self.control_policy(owned)?;
        let output_index=self.matching_output(keys,expected)?;
        Ok(serde_json::json!({"nostos_control_v1":true,"txid":self.txid().to_string(),
            "height":self.height,"block_hash":self.anchor.to_string(),
            "confirmations":self.tip-self.height+1,"pool":"ironwood",
            "output_index":output_index,"amount_zats":10_000,"fee_zats":fee,
            "exact_output_match":true,"owned_spend_match":true,
            "payments_enabled":false}))
    }
    pub fn store(&self, db: &mut Database) -> Result<(), &'static str> {
        require_current_context(
            self.height, self.tip, self.anchor,
            db.chain_height().map_err(|_| "chain_height")?.map(u32::from),
            db.block_fully_scanned().map_err(|_| "scan_height")?.map(|b| u32::from(b.block_height())),
            db.get_block_hash(BlockHeight::from_u32(self.height)).map_err(|_| "wallet_block_hash")?,
        )?;
        // Refuse to persist after the wallet's anchored block has changed.
        let known = db.get_tx_height(self.tx.txid()).map_err(|_| "wallet_tx_height")?;
        if known != Some(BlockHeight::from_u32(self.height))
            || db.get_block_hash(BlockHeight::from_u32(self.height)).map_err(|_| "wallet_block_hash")? != Some(self.anchor) {
            return Err("wallet_anchor_changed");
        }
        decrypt_and_store_transaction(&MAIN_NETWORK,db,&self.tx,Some(BlockHeight::from_u32(self.height)))
            .map_err(|_| "transaction_store")
    }
    pub fn matching_output<A: Copy+Eq+std::hash::Hash>(&self, keys: &HashMap<A,UnifiedFullViewingKey>, expected: &Expected<A>)
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
            && out.note().0.recipient().to_raw_address_bytes()==expected.receiver.0
            && out.note().0.value().inner()==expected.amount && out.memo()==&expected.memo
        ).map(|out|out.index()).collect();
        match matches.as_slice() {
            [index] => Ok(*index), [] => Err("exact_output_not_found"), _ => Err("ambiguous_output_match"),
        }
    }
}


fn require_current_context(
    height: u32, verified_tip: u32, anchor: zcash_primitives::block::BlockHash,
    current_tip: Option<u32>, scanned_tip: Option<u32>,
    current_anchor: Option<zcash_primitives::block::BlockHash>,
) -> Result<(), &'static str> {
    // A rewind, new tip or incomplete rescan invalidates the captured evidence.
    // Enhance again rather than committing an older confirmation count.
    if height == 0 || height > verified_tip
        || current_tip != Some(verified_tip) || scanned_tip != Some(verified_tip)
        || current_anchor != Some(anchor) {
        return Err("wallet_context_changed");
    }
    Ok(())
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
        || block.vtx.iter().filter(|t|t.txid.as_slice()==requested.as_ref()).count()!=1 {
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
    let hash: [u8;32] = block.vtx.first().ok_or("public_block_empty")?.txid.as_slice().try_into().map_err(|_| "public_txid")?;
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

