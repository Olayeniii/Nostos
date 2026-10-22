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

// No Debug/serialization. This is a private request, never a browser match claim.
pub struct ControlRequest<A> { expected: Expected<A>, max_fee: u64, max_debit: u64 }
impl<A> ControlRequest<A> {
    pub fn new(account: A, receiver: &str, reference: &str,
        max_fee: u64, max_debit: u64, confirmations: u32) -> Result<Self, &'static str> {
        if reference.len()!=32 || !reference.bytes().all(|c|c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            || max_fee==0 || max_fee>10_000 || max_debit>20_000
            || 10_000u64.checked_add(max_fee).is_none_or(|n|n>max_debit) || confirmations<3 {
            return Err("control_request");
        }
        let memo=MemoBytes::from_bytes(format!("nostos:control:{reference}").as_bytes())
            .map_err(|_| "control_memo")?;
        Ok(Self{expected:Expected::new(account,OrchardReceiver::parse_mainnet(receiver)?,10_000,
            memo,ShieldedPool::Ironwood,TransferType::Outgoing,confirmations)?,max_fee,max_debit})
    }
}

// Only verify_control constructs this token outside this module. It carries no
// key, receiver or memo. A private persistence adapter is still required.
pub struct ControlEvidence {
    txid: TxId, height: u32, tip: u32, anchor: zcash_primitives::block::BlockHash,
    output_index: usize, fee: u64, gross_owned_inputs: u64,
}
impl ControlEvidence {
    pub fn txid(&self)->TxId {self.txid}
    pub fn height(&self)->u32 {self.height}
    pub fn tip(&self)->u32 {self.tip}
    pub fn anchor(&self)->zcash_primitives::block::BlockHash {self.anchor}
    pub fn output_index(&self)->usize {self.output_index}
    pub fn fee(&self)->u64 {self.fee}
    pub fn gross_owned_inputs(&self)->u64 {self.gross_owned_inputs}
}
struct ControlUnresolved;
impl From<rusqlite::Error> for ControlUnresolved {fn from(_:rusqlite::Error)->Self {Self}}
impl From<&'static str> for ControlUnresolved {fn from(_:&'static str)->Self {Self}}
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

    // Public SDK account/nullifier APIs plus a pinned-schema, read-only query
    // through the SDK extension authorizer. No wallet schema/data writes occur.
    pub fn verify_control(&self, db: &mut Database,
        request: &ControlRequest<<Database as WalletRead>::AccountId>) -> Result<ControlEvidence,&'static str> {
        db.transactionally_with_extension::<_,_,ControlUnresolved>(|db,ext| {
            let height=BlockHeight::from_u32(self.height);
            if db.chain_height().map_err(|_| "control_chain")?!=Some(BlockHeight::from_u32(self.tip))
                || db.block_fully_scanned().map_err(|_| "control_scan")?.map(|b|b.block_height())!=Some(BlockHeight::from_u32(self.tip))
                || db.get_tx_height(self.txid()).map_err(|_| "control_height")?!=Some(height)
                || db.get_block_hash(height).map_err(|_| "control_anchor")?!=Some(self.anchor) {
                return Err(ControlUnresolved);
            }
            let keys=db.get_unified_full_viewing_keys().map_err(|_| "control_keys")?;
            let known=db.get_ironwood_nullifiers(zcash_client_backend::data_api::NullifierQuery::All)
                .map_err(|_| "control_nullifiers")?.into_iter()
                .filter(|(account,_)|*account==request.expected.account).map(|(_,nf)|nf.to_bytes()).collect::<Vec<_>>();
            let account=request.expected.account.expose_uuid();
            let (output_index,fee,gross_owned_inputs)=self.control_fields(&keys,request,&known,|nf| {
                // The schema is pinned at librustzcash 1f6bb207. Fail closed on
                // missing/pruned notes or unmined funding; never infer a value.
                let (value,mined,block):(i64,Option<u32>,Option<u32>)=ext.query_row(
                    "SELECT rn.value,t.mined_height,t.block FROM ironwood_received_notes rn
                     JOIN accounts a ON a.id=rn.account_id JOIN transactions t ON t.id_tx=rn.transaction_id
                     WHERE a.uuid=?1 AND rn.nf=?2",
                    rusqlite::params![account.as_bytes().as_slice(),nf.as_slice()],
                    |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_| "control_input_value")?;
                let h=mined.filter(|h|*h>0 && *h<self.height && block==Some(*h)).ok_or("control_funding_height")?;
                if db.get_block_hash(BlockHeight::from_u32(h)).map_err(|_| "control_funding_anchor")?.is_none() {
                    return Err("control_funding_anchor");
                }
                u64::try_from(value).ok().filter(|n|*n>0).ok_or("control_input_value")
            })?;
            Ok(ControlEvidence{txid:self.txid(),height:self.height,tip:self.tip,anchor:self.anchor,
                output_index,fee,gross_owned_inputs})
        }).map_err(|_| "control_unresolved")
    }

    // Fixture-testable field checks. This helper never produces ControlEvidence
    // and cannot establish mining or account ownership from caller claims.
    fn control_fields<A:Copy+Eq+std::hash::Hash,F>(&self,keys:&HashMap<A,UnifiedFullViewingKey>,
        request:&ControlRequest<A>,known:&[[u8;32]],mut input_value:F) -> Result<(usize,u64,u64),&'static str>
        where F:FnMut(&[u8;32])->Result<u64,&'static str> {
        use zcash_protocol::consensus::NetworkUpgrade;
        let expected=&request.expected;
        if keys.len()!=1 || expected.pool!=ShieldedPool::Ironwood
            || !MAIN_NETWORK.is_nu_active(NetworkUpgrade::Nu6_3,BlockHeight::from_u32(self.height))
            || self.tx.transparent_bundle().is_some() || self.tx.sprout_bundle().is_some()
            || self.tx.sapling_bundle().is_some() || self.tx.orchard_bundle().is_some() {
            return Err("control_pool");
        }
        let key=keys.get(&expected.account).ok_or("control_account")?.orchard().ok_or("control_key")?;
        let receiver=Option::<orchard::Address>::from(orchard::Address::from_raw_address_bytes(&expected.receiver.0))
            .ok_or("control_receiver")?;
        if key.scope_for_address(&receiver).is_some() {return Err("control_self_send");}
        let index=self.matching_output(keys,expected)?;
        let decrypted=zcash_client_backend::decrypt_transaction(&MAIN_NETWORK,
            Some(BlockHeight::from_u32(self.height)),Some(BlockHeight::from_u32(self.tip)),&self.tx,keys);
        if decrypted.ironwood_outputs().iter().filter(|out|*out.account()==expected.account
            && out.transfer_type()==TransferType::Outgoing && out.note().0.value().inner()>0).count()!=1 {
            return Err("control_additional_output");
        }
        let fee=self.tx.fee_paid::<zcash_protocol::value::BalanceError,_>(|_|Ok(None))
            .map_err(|_| "control_fee")?.ok_or("control_fee")?.into_u64();
        if fee>request.max_fee || expected.amount.checked_add(fee).is_none_or(|n|n>request.max_debit) {
            return Err("control_fee_cap");
        }
        let mut seen=std::collections::HashSet::new();
        let mut gross=0u64;
        let mut owned=0;
        for action in self.tx.ironwood_bundle().ok_or("control_bundle")?.actions().iter() {
            let nf=action.nullifier().to_bytes();
            if !seen.insert(nf) {return Err("control_duplicate_spend");}
            if known.contains(&nf) {
                let value=input_value(&nf)?;
                if value==0 {return Err("control_input_value");}
                gross=gross.checked_add(value).ok_or("control_input_overflow")?;
                owned+=1;
            }
        }
        // Conservative cap: all business-owned inputs consumed, before change,
        // must fit the approved debit. Do not assume amount+fee is the debit.
        if owned==0 || gross>request.max_debit || expected.amount.checked_add(fee).is_none_or(|n|gross<n) {
            return Err("control_owned_input_cap");
        }
        Ok((index,fee,gross))
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
