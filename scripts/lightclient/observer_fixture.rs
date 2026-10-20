//! Temporary public fixture only. Does not accept merchant keys or persistent paths.
#[path = "nostos_observer/mod.rs"]
mod observer;
use std::time::Duration;
use tonic::transport::{ClientTlsConfig, Endpoint};
use zcash_client_backend::{data_api::{AccountBirthday, WalletRead},
    proto::service::{compact_tx_streamer_client::CompactTxStreamerClient, BlockId, Empty}};
use zcash_keys::keys::UnifiedSpendingKey;
use zcash_protocol::consensus::MAIN_NETWORK;

async fn check() -> Result<serde_json::Value, &'static str> {
    let endpoint = Endpoint::from_static("https://zec.rocks:443")
        .connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(30))
        .tls_config(ClientTlsConfig::new().with_webpki_roots()).map_err(|_| "tls_configuration")?;
    let mut client = CompactTxStreamerClient::new(endpoint.connect().await.map_err(|_| "tls_connection")?);
    let info = client.get_lightd_info(Empty{}).await.map_err(|_| "chain_metadata")?.into_inner();
    if info.chain_name != "main" || info.block_height < 3_428_200 || info.block_height > u64::from(u32::MAX-100) {
        return Err("mainnet_identity");
    }
    let birthday_height = info.block_height as u32 - 4;
    let tree = client.get_tree_state(BlockId{height:u64::from(birthday_height-1),hash:vec![]})
        .await.map_err(|_| "birthday_rpc")?.into_inner();
    if tree.network != "main" || tree.height != u64::from(birthday_height-1) { return Err("birthday_identity"); }
    let birthday = AccountBirthday::from_treestate(tree,None).map_err(|_| "birthday_decode")?;
    // Public deterministic test material only. Never export the address or fund it.
    let key = UnifiedSpendingKey::from_seed(&MAIN_NETWORK,&[9;32],zip32::AccountId::ZERO)
        .map_err(|_| "fixture_key")?.to_unified_full_viewing_key();
    let temp = tempfile::tempdir().map_err(|_| "fixture_directory")?;
    let path = temp.path().join("fixture.sqlite");
    let mut db = observer::open_fixture(&path)?;
    if !observer::import_once(&mut db,&key,&birthday,birthday_height)? { return Err("initial_import"); }
    if observer::import_once(&mut db,&key,&birthday,birthday_height)? { return Err("duplicate_import"); }
    if observer::import_once(&mut db,&key,&birthday,birthday_height+1).is_ok() { return Err("birthday_conflict_allowed"); }
    let other = UnifiedSpendingKey::from_seed(&MAIN_NETWORK,&[10;32],zip32::AccountId::ZERO)
        .map_err(|_| "fixture_key")?.to_unified_full_viewing_key();
    if observer::import_once(&mut db,&other,&birthday,birthday_height).is_ok() { return Err("different_key_allowed"); }
    // Retry only public reads. A new in-memory cache cannot overwrite durable account identity.
    let mut synced = false;
    let mut attempts = 0;
    for attempt in 0..3 {
        attempts += 1;
        let cache = observer::MemoryCache::default();
        if zcash_client_backend::sync::run(&mut client,&MAIN_NETWORK,&cache,&mut db,128).await.is_ok() {
            synced = true; break;
        }
        tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
    }
    if !synced { return Err("fixture_scan"); }
    let first = db.block_fully_scanned().map_err(|_| "scan_status")?.ok_or("no_scanned_block")?.block_height();
    if u32::from(first) < info.block_height as u32 { return Err("fixture_not_synced"); }
    drop(db);
    let mut db = observer::open_fixture(&path)?;
    if observer::import_once(&mut db,&key,&birthday,birthday_height)? { return Err("reopen_reimported"); }
    if db.get_account_ids().map_err(|_| "account_count")?.len() != 1 { return Err("duplicate_account"); }
    let reopened = db.block_fully_scanned().map_err(|_| "reopen_status")?.ok_or("lost_scan_checkpoint")?.block_height();
    if reopened != first { return Err("changed_scan_checkpoint"); }
    zcash_client_backend::sync::run(&mut client,&MAIN_NETWORK,&observer::MemoryCache::default(),&mut db,128)
        .await.map_err(|_| "resume_scan")?;
    Ok(serde_json::json!({"fixture_scan_passed":true,"reopen_checkpoint_passed":true,
        "same_key_idempotent":true,"changed_key_rejected":true,"changed_birthday_rejected":true,
        "sampled_height":info.block_height,"fully_scanned_height":u32::from(reopened),"attempts":attempts}))
}

#[tokio::main]
async fn main() {
    rustls::crypto::ring::default_provider().install_default().expect("probe TLS provider");
    let result = tokio::time::timeout(Duration::from_secs(240),check()).await;
    let mut output = serde_json::json!({"fixture_only":true,"temporary_wallet_created":true,
        "public_test_key_only":true,"merchant_sync_verified":false,"transaction_enhancement_verified":false,
        "payment_refund_verified":false,"sends_requested":0,"vps_services_changed":false});
    let passed = match result {
        Ok(Ok(evidence)) => {output["evidence"] = evidence; true},
        Ok(Err(stage)) => {output["failed_stage"] = stage.into(); false},
        Err(_) => {output["failed_stage"] = "fixture_timeout".into(); false},
    };
    output["passed"] = passed.into();
    println!("{output}");
    if !passed {std::process::exit(1);}
}
