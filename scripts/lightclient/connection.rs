//! Private pipe protocol for one merchant's isolated view-only wallet.
use serde_json::{json,Value};
use zcash_address::unified::{self,Container,Encoding,Fvk,Ufvk};
use zcash_client_backend::{data_api::{Account,AccountBirthday,WalletRead},
    proto::service::{BlockId,ChainSpec,Empty}};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_protocol::consensus::{Parameters,MAIN_NETWORK};
use super::{storage::ProtectedWallet,transactions::{self,Client}};

pub struct Connection {wallet: ProtectedWallet, client: Client}
pub fn scoped_key(encoded: &str) -> Result<UnifiedFullViewingKey,&'static str> {
    if encoded.len()>3000 || !encoded.starts_with("uview1") {return Err("view_key_format");}
    let original=UnifiedFullViewingKey::decode(&MAIN_NETWORK,encoded).map_err(|_| "view_key_decode")?;
    if original.orchard().is_none() {return Err("orchard_view_access_required");}
    let (network,key)=Ufvk::decode(encoded).map_err(|_| "view_key_decode")?;
    let scoped=Ufvk::try_from_items(key.items().into_iter().filter(|k|matches!(k,Fvk::Orchard(_))).collect())
        .map_err(|_| "view_key_scope")?;
    UnifiedFullViewingKey::decode(&MAIN_NETWORK,&scoped.encode(&network)).map_err(|_| "view_key_scope")
}
impl Connection {
    pub fn new(wallet: ProtectedWallet,client: Client) -> Self {Self{wallet,client}}
    async fn tip(&mut self) -> Result<(u32,String),&'static str> {
        let info=self.client.get_lightd_info(Empty{}).await.map_err(|_| "chain_metadata")?.into_inner();
        let tip=self.client.get_latest_block(ChainSpec{}).await.map_err(|_| "chain_tip")?.into_inner();
        let height=u32::try_from(tip.height).map_err(|_| "chain_height")?;
        if info.chain_name!="main" || tip.hash.len()!=32 || height==0 {return Err("chain_identity");}
        Ok((height,hex::encode(tip.hash.iter().rev().copied().collect::<Vec<_>>())))
    }
    pub async fn status(&mut self) -> Result<Value,&'static str> {
        let (height,hash)=self.tip().await?;
        let db=self.wallet.db_mut();
        let full=db.block_fully_scanned().map_err(|_| "scan_status")?;
        let wallet_tip=db.get_max_height_hash().map_err(|_| "wallet_tip")?;
        let connected=db.get_account_ids().map_err(|_| "account_lookup")?.len()==1;
        let pending=db.transaction_data_requests().map_err(|_| "enhancement_status")?;
        let ready=full.as_ref().is_some_and(|b|u32::from(b.block_height())==height)
            && wallet_tip.is_some_and(|(h,b)|u32::from(h)==height && b.to_string()==hash)
            && pending.is_empty();
        Ok(json!({"node_tip":{"height":height,"blockhash":hash},
            "wallet_tip":wallet_tip.map(|(h,b)|json!({"height":u32::from(h),"blockhash":b.to_string()})),
            "fully_synced_height":full.map(|b|u32::from(b.block_height())),"locked":!ready,
            "account_connected":connected,"nostos_sdk_preview_v1":true,"observation_scope":"orchard-family-only","payments_enabled":false}))
    }
    pub async fn handle(&mut self,method:&str,params:&[Value]) -> Result<Value,&'static str> {
        match method {
            "nostos_incoming_candidates" | "nostos_outgoing_candidates" if params.len()==2 => {
                let account=params[0].as_str().ok_or("candidate_account")?;
                let after=params[1].as_i64().filter(|n|*n>=0).ok_or("candidate_cursor")?;
                let accounts=self.wallet.db_mut().get_account_ids().map_err(|_| "candidate_account")?;
                if accounts.len()!=1 || accounts[0].expose_uuid().to_string()!=account {return Err("candidate_account");}
                let rows=if method=="nostos_outgoing_candidates" {self.wallet.outgoing_candidates(account,after)?} else {self.wallet.incoming_candidates(account,after)?};
                Ok(json!({"nostos_sdk_preview_v1":true,"payments_enabled":false,"observation_scope":"orchard-family-only","candidates":rows}))
            },
            "nostos_verify_output" if params.len()==9 => {
                use zcash_client_backend::{TransferType,data_api::NullifierQuery};
                use zcash_protocol::{ShieldedPool,memo::MemoBytes};
                let account_uuid=params[0].as_str().ok_or("product_account")?;
                let accounts=self.wallet.db_mut().get_account_ids().map_err(|_| "account_lookup")?;
                if accounts.len()!=1 || accounts[0].expose_uuid().to_string()!=account_uuid {
                    return Err("product_account");
                }
                let account=accounts[0];
                let id=params[1].as_str().ok_or("product_txid")?;
                if id.len()!=64 || !id.bytes().all(|b|b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
                    return Err("product_txid");
                }
                let mut bytes:[u8;32]=hex::decode(id).map_err(|_| "product_txid")?.try_into().map_err(|_| "product_txid")?;
                bytes.reverse();
                let txid=zcash_primitives::transaction::TxId::from_bytes(bytes);
                let receiver=transactions::OrchardReceiver::parse_mainnet(params[2].as_str().ok_or("product_receiver")?)?;
                let amount=params[3].as_u64().ok_or("product_amount")?;
                let encoded=params[4].as_str().ok_or("product_memo")?;
                if encoded.len()>1024 || encoded.len()%2!=0 {return Err("product_memo");}
                let memo=MemoBytes::from_bytes(&hex::decode(encoded).map_err(|_| "product_memo")?).map_err(|_| "product_memo")?;
                let pool=match params[5].as_str() {Some("ironwood")=>ShieldedPool::Ironwood,Some("orchard")=>ShieldedPool::Orchard,_=>return Err("product_pool")};
                let direction=match params[6].as_str() {Some("incoming")=>TransferType::Incoming,Some("outgoing")=>TransferType::Outgoing,_=>return Err("product_direction")};
                let binding=params[7].as_str().ok_or("product_binding")?;
                if uuid::Uuid::parse_str(binding).map_err(|_| "product_binding")?.to_string()!=binding {
                    return Err("product_binding");
                }
                let fee_cap=params[8].as_u64().ok_or("product_fee_cap")?;
                let expected=transactions::Expected::new(account,receiver,amount,memo,pool,direction,3)?;
                let keys=self.wallet.db_mut().get_unified_full_viewing_keys().map_err(|_| "product_keys")?;
                let before=self.tip().await?;
                let tx=transactions::enhance(&mut self.client,self.wallet.db_mut(),txid).await?;
                let owned=if direction==TransferType::Outgoing {
                    let pairs=match pool {
                        ShieldedPool::Ironwood=>self.wallet.db_mut().get_ironwood_nullifiers(NullifierQuery::All),
                        _=>self.wallet.db_mut().get_orchard_nullifiers(NullifierQuery::All),
                    }.map_err(|_| "product_nullifiers")?;
                    pairs.into_iter().filter_map(|(owner,nf)|(owner==account).then_some(nf)).collect::<Vec<_>>()
                } else {vec![]};
                let after=self.tip().await?;
                let scanned=self.wallet.db_mut().get_max_height_hash().map_err(|_| "product_tip")?.ok_or("product_tip")?;
                if before!=after || u32::from(scanned.0)!=after.0 || scanned.1.to_string()!=after.1 {
                    return Err("product_chain_changed");
                }
                let result=tx.verify_product(&keys,&expected,&owned,after.0,fee_cap,binding,account_uuid,&after.1)?;
                tx.store(self.wallet.db_mut())?;
                Ok(result)
            },
            // Private operator pipe only. The HTTP broker does not allow this
            // method. This never settles a product instruction or enables payments.
            "nostos_control" if params.len()==4 => {
                use zcash_client_backend::{TransferType, data_api::NullifierQuery};
                use zcash_protocol::{ShieldedPool, memo::MemoBytes};
                use zcash_primitives::transaction::TxId;
                let receiver=transactions::OrchardReceiver::parse_mainnet(params[1].as_str().ok_or("control_receiver")?)?;
                let memo=params[2].as_str().ok_or("control_memo")?;
                if memo.len()!=47 || !memo.starts_with("nostos:control:")
                    || !memo[15..].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
                    return Err("control_memo");
                }
                let account_id=params[3].as_str().ok_or("control_account")?;
                let accounts=self.wallet.db_mut().get_account_ids().map_err(|_| "account_lookup")?;
                if accounts.len()!=1 || accounts[0].expose_uuid().to_string()!=account_id {
                    return Err("control_account");
                }
                let account=accounts[0];
                let keys=self.wallet.db_mut().get_unified_full_viewing_keys().map_err(|_| "control_keys")?;
                let key=keys.get(&account).ok_or("control_keys")?;
                receiver.require_external_to(key)?;
                let expected=transactions::Expected::new(account,receiver,10_000,
                    MemoBytes::from_bytes(memo.as_bytes()).map_err(|_| "control_memo")?,
                    ShieldedPool::Ironwood,TransferType::Outgoing,3)?;
                if params[0].is_null() {
                    if self.status().await?.get("locked").and_then(Value::as_bool)!=Some(false) {
                        return Err("control_not_synced");
                    }
                    return Ok(json!({"nostos_control_plan_v1":true,"amount_zats":10_000,
                        "fee_cap_zats":10_000,"pool":"ironwood","minimum_confirmations":3,
                        "payments_enabled":false}));
                }
                let id=params[0].as_str().ok_or("control_txid")?;
                if id.len()!=64 || !id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
                    return Err("control_txid");
                }
                let mut bytes: [u8;32]=hex::decode(id).map_err(|_| "control_txid")?.try_into().map_err(|_| "control_txid")?;
                bytes.reverse();
                let txid=TxId::from_bytes(bytes);
                let before=self.tip().await?;
                let tx=transactions::enhance(&mut self.client,self.wallet.db_mut(),txid).await?;
                let owned=self.wallet.db_mut().get_ironwood_nullifiers(NullifierQuery::All)
                    .map_err(|_| "control_nullifiers")?.into_iter()
                    .filter_map(|(owner,nf)| (owner==account).then_some(nf)).collect::<Vec<_>>();
                let after=self.tip().await?;
                if before!=after {return Err("control_chain_changed");}
                let result=tx.verify_control(&keys,&expected,&owned,after.0)?;
                tx.store(self.wallet.db_mut())?;
                Ok(result)
            },
            "getwalletstatus" if params.is_empty() => self.status().await,
            "z_importviewingkey" if params.len()==3 => {
                let key=scoped_key(params[0].as_str().ok_or("view_key_format")?)?;
                if params[1].as_str()!=Some("whenkeyisnew") {return Err("rescan_policy");}
                let birthday=params[2].as_u64().and_then(|n|u32::try_from(n).ok()).filter(|h|*h>0).ok_or("birthday_format")?;
                let (tip,_)=self.tip().await?;
                if birthday>tip {return Err("birthday_in_future");}
                let tree=self.client.get_tree_state(BlockId{height:u64::from(birthday-1),hash:vec![]})
                    .await.map_err(|_| "birthday_rpc")?.into_inner();
                if tree.network!="main" || tree.height!=u64::from(birthday-1) {return Err("birthday_identity");}
                let birth=AccountBirthday::from_treestate(tree,None).map_err(|_| "birthday_decode")?;
                let db=self.wallet.db_mut();
                super::import_once(db,&key,&birth,birthday)?;
                let account=db.get_account_for_ufvk(&key).map_err(|_| "account_lookup")?.ok_or("account_missing")?;
                let receiver=key.orchard().ok_or("orchard_view_access_required")?.address_at(0u32,orchard::keys::Scope::External);
                let ua=unified::Address::try_from_items(vec![unified::Receiver::Orchard(receiver.to_raw_address_bytes())])
                    .map_err(|_| "address_scope")?.encode(&MAIN_NETWORK.network_type());
                Ok(json!({"address_type":"unified","address":ua,"account_uuid":account.id().expose_uuid().to_string(),
                    "nostos_view_only_v1":true,"nostos_sdk_preview_v1":true,"observation_scope":"orchard-family-only"}))
            },
            "z_listunifiedreceivers" if params.len()==1 => {
                let address=params[0].as_str().ok_or("address_format")?;
                transactions::refund_receivers(address)
            },
            "nostos_sync" if params.is_empty() => {
                if self.wallet.db_mut().get_account_ids().map_err(|_| "account_lookup")?.len()!=1 {return Err("account_not_connected");}
                zcash_client_backend::sync::run(&mut self.client,&MAIN_NETWORK,&super::MemoryCache::default(),self.wallet.db_mut(),128)
                    .await.map_err(|_| "sync_unresolved")?;
                transactions::enhance_pending(&mut self.client,self.wallet.db_mut()).await?;
                self.status().await
            },
            _ => Err("method_not_allowed"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zcash_keys::keys::UnifiedSpendingKey;
    #[test]
    fn explicit_scope_preserves_orchard_and_discards_other_view_components() {
        let full=UnifiedSpendingKey::from_seed(&MAIN_NETWORK,&[9;32],zip32::AccountId::ZERO).unwrap().to_unified_full_viewing_key();
        let scoped=scoped_key(&full.encode(&MAIN_NETWORK)).unwrap();
        assert!(scoped.transparent().is_none());
        assert!(scoped.sapling().is_none());
        assert!(scoped.orchard().unwrap().to_bytes()==full.orchard().unwrap().to_bytes());
        assert!(scoped_key(&full.encode(&zcash_protocol::consensus::TEST_NETWORK)).is_err());
        assert!(scoped_key("not-a-viewing-key").is_err());
    }
}


