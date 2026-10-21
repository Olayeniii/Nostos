//! Temporary public fixture only. Does not accept merchant keys or persistent paths.
#[path = "nostos_observer/mod.rs"]
mod observer;
use std::time::Duration;
use tonic::transport::{ClientTlsConfig, Endpoint};
use zcash_client_backend::{data_api::{AccountBirthday, WalletRead},
    proto::service::{BlockId, Empty}};
use zcash_keys::keys::{UnifiedSpendingKey, UnifiedFullViewingKey};
use zcash_address::unified::{Container, Encoding, Fvk, Ufvk};
use zcash_protocol::consensus::MAIN_NETWORK;

fn fixture_key(seed: u8) -> Result<UnifiedFullViewingKey, &'static str> {
    let full = UnifiedSpendingKey::from_seed(&MAIN_NETWORK,&[seed;32],zip32::AccountId::ZERO)
        .map_err(|_| "fixture_key")?.to_unified_full_viewing_key();
    let (network, raw) = Ufvk::decode(&full.encode(&MAIN_NETWORK)).map_err(|_| "fixture_key_decode")?;
    let orchard_only = Ufvk::try_from_items(raw.items().into_iter().filter(|k| matches!(k,Fvk::Orchard(_))).collect())
        .map_err(|_| "fixture_key_scope")?;
    UnifiedFullViewingKey::decode(&MAIN_NETWORK,&orchard_only.encode(&network)).map_err(|_| "fixture_key_decode")
}

#[cfg(test)]
fn only_shielded_reads(request: tonic::Request<()>) -> Result<tonic::Request<()>,tonic::Status> {
    observer::transactions::shielded_reads(request)
}

async fn check() -> Result<serde_json::Value, &'static str> {
    let endpoint = Endpoint::from_static("https://zec.rocks:443")
        .connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(30))
        .tls_config(ClientTlsConfig::new().with_webpki_roots()).map_err(|_| "tls_configuration")?;
    let mut client = observer::transactions::client(endpoint.connect().await.map_err(|_| "tls_connection")?);
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
    let key = fixture_key(9)?;
    let temp = tempfile::tempdir().map_err(|_| "fixture_directory")?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(temp.path(),std::fs::Permissions::from_mode(0o700)).map_err(|_| "fixture_directory_mode")?;
    let mut wallet = observer::storage::ProtectedWallet::open(temp.path())?;
    let db = wallet.db_mut();
    let unscoped = UnifiedSpendingKey::from_seed(&MAIN_NETWORK,&[9;32],zip32::AccountId::ZERO)
        .map_err(|_| "fixture_key")?.to_unified_full_viewing_key();
    if observer::import_once(db,&unscoped,&birthday,birthday_height).is_ok()
        || !db.get_account_ids().map_err(|_| "account_count")?.is_empty() {
        return Err("transparent_key_not_rejected_before_import");
    }
    if !observer::import_once(db,&key,&birthday,birthday_height)? { return Err("initial_import"); }
    if observer::import_once(db,&key,&birthday,birthday_height)? { return Err("duplicate_import"); }
    if observer::import_once(db,&key,&birthday,birthday_height+1).is_ok() { return Err("birthday_conflict_allowed"); }
    let other = fixture_key(10)?;
    if observer::import_once(db,&other,&birthday,birthday_height).is_ok() { return Err("different_key_allowed"); }
    // Retry only public reads. A new in-memory cache cannot overwrite durable account identity.
    let mut synced = false;
    let mut attempts = 0;
    for attempt in 0..3 {
        attempts += 1;
        let cache = observer::MemoryCache::default();
        match zcash_client_backend::sync::run(&mut client,&MAIN_NETWORK,&cache,db,128).await {
            Ok(()) => { synced = true; break; },
            Err(zcash_client_backend::sync::Error::Server(status)) if matches!(status.code(),
                tonic::Code::Unavailable | tonic::Code::DeadlineExceeded | tonic::Code::ResourceExhausted) => {
                if attempt == 2 { return Err("fixture_server_transient_exhausted"); }
                tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
            },
            Err(zcash_client_backend::sync::Error::Server(_)) => return Err("fixture_server_rejected"),
            Err(zcash_client_backend::sync::Error::Cache(_)) => return Err("fixture_cache"),
            Err(zcash_client_backend::sync::Error::Scan(_)) => return Err("fixture_scan_data"),
            Err(zcash_client_backend::sync::Error::Wallet(_)) => return Err("fixture_wallet_storage"),
            Err(zcash_client_backend::sync::Error::WalletTrees(_)) => return Err("fixture_wallet_trees"),
            Err(zcash_client_backend::sync::Error::MisbehavingServer) => return Err("fixture_server_invalid"),
            Err(_) => return Err("fixture_unclassified_stop"),
        }
    }
    if !synced { return Err("fixture_scan"); }
    let first = db.block_fully_scanned().map_err(|_| "scan_status")?.ok_or("no_scanned_block")?.block_height();
    if u32::from(first) < info.block_height as u32 { return Err("fixture_not_synced"); }
    observer::storage::ProtectedWallet::audit(temp.path())?;
    drop(wallet);
    let mut wallet = observer::storage::ProtectedWallet::open(temp.path())?;
    let db = wallet.db_mut();
    if observer::import_once(db,&key,&birthday,birthday_height)? { return Err("reopen_reimported"); }
    if db.get_account_ids().map_err(|_| "account_count")?.len() != 1 { return Err("duplicate_account"); }
    let reopened = db.block_fully_scanned().map_err(|_| "reopen_status")?.ok_or("lost_scan_checkpoint")?.block_height();
    if reopened != first { return Err("changed_scan_checkpoint"); }
    zcash_client_backend::sync::run(&mut client,&MAIN_NETWORK,&observer::MemoryCache::default(),db,128)
        .await.map_err(|_| "resume_scan")?;
    observer::transactions::check_public_fetch(&mut client,db).await?;
    if observer::transactions::enhance_pending(&mut client,db).await? != 0 {return Err("unexpected_fixture_transactions");}
    observer::storage::ProtectedWallet::audit(temp.path())?;
    let mut connection=observer::connection::Connection::new(wallet,client);
    let full=UnifiedSpendingKey::from_seed(&MAIN_NETWORK,&[9;32],zip32::AccountId::ZERO)
        .map_err(|_| "fixture_key")?.to_unified_full_viewing_key().encode(&MAIN_NETWORK);
    let params=vec![serde_json::json!(full),serde_json::json!("whenkeyisnew"),serde_json::json!(birthday_height)];
    let imported=connection.handle("z_importviewingkey",&params).await?;
    let repeated=connection.handle("z_importviewingkey",&params).await?;
    if imported.get("nostos_sdk_preview_v1")!=Some(&serde_json::json!(true)) || imported!=repeated {return Err("connection_identity");}
    if connection.handle("z_sendfromaccount",&[]).await.is_ok() {return Err("connection_send_allowed");}
    let script=std::env::var("NOSTOS_SERVICE_E2E_SCRIPT").map_err(|_| "service_fixture_script")?;
    let worker=std::env::current_exe().map_err(|_| "fixture_executable")?.with_file_name("nostos_sdk_worker");
    let mut child=std::process::Command::new("node").arg(script).arg(worker)
        .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null())
        .spawn().map_err(|_| "service_fixture_start")?;
    use std::io::Write;
    let payload=serde_json::to_vec(&serde_json::json!({"public_fixture_only":true,"key":full,"birthday":birthday_height}))
        .map_err(|_| "service_fixture_payload")?;
    child.stdin.take().ok_or("service_fixture_input")?.write_all(&payload).map_err(|_| "service_fixture_input")?;
    let result=child.wait_with_output().map_err(|_| "service_fixture_wait")?;
    let proof:serde_json::Value=serde_json::from_slice(&result.stdout).map_err(|_| "service_fixture_result")?;
    if !result.status.success() || proof.get("service_pipe_e2e_passed")!=Some(&serde_json::json!(true)) {
        return Err(match proof.get("failed_stage").and_then(serde_json::Value::as_str) {
            Some("authentication")=>"service_fixture_authentication",Some("initial_status")=>"service_fixture_initial_status",
            Some("import")=>"service_fixture_import",Some("receivers")=>"service_fixture_receivers",
            Some("namespace")=>"service_fixture_namespace",_=>"service_fixture_failed",
        });
    }
    Ok(serde_json::json!({"service_pipe_e2e_passed":true,"protected_storage_checked":true,"public_transaction_fetch_passed":true,"fixture_scan_passed":true,"reopen_checkpoint_passed":true,
        "same_key_idempotent":true,"changed_key_rejected":true,"changed_birthday_rejected":true,
        "shielded_rpc_allowlist_enforced":true,"sampled_height":info.block_height,"fully_scanned_height":u32::from(reopened),"attempts":attempts}))
}

#[tokio::main]
async fn main() {
    rustls::crypto::ring::default_provider().install_default().expect("probe TLS provider");
    let result = tokio::time::timeout(Duration::from_secs(240),check()).await;
    let mut output = serde_json::json!({"fixture_only":true,"temporary_wallet_only":true,
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

#[cfg(test)]
mod policy_tests {
    use super::*;
    #[test]
    fn all_other_methods_are_denied_before_transport() {
        for method in ["SendTransaction", "GetAddressUtxos", "GetTaddressTxids", "Unknown"] {
            let mut request = tonic::Request::new(());
            request.extensions_mut().insert(tonic::GrpcMethod::new("cash.z.wallet.sdk.rpc.CompactTxStreamer", method));
            assert!(only_shielded_reads(request).is_err());
        }
        assert!(only_shielded_reads(tonic::Request::new(())).is_err());
    }
    #[test]
    fn fixture_scope_has_no_transparent_component() {
        let key = fixture_key(9).unwrap();
        assert!(key.transparent().is_none());
        assert!(key.orchard().is_some());
    }
}
