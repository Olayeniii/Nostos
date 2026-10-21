//! Public deterministic material in fresh temporary directories only.
#[path = "nostos_observer/mod.rs"]
mod observer;
use std::{path::Path, os::unix::fs::PermissionsExt};
use zcash_client_backend::data_api::{AccountBirthday, AccountPurpose, WalletRead, WalletWrite, chain::ChainState};
use zcash_keys::keys::UnifiedSpendingKey;
use zcash_protocol::consensus::{MAIN_NETWORK, BlockHeight};

fn child(root: &Path, committed: bool) -> Result<(), &'static str> {
    // Refuse existing wallet state, even when invoked directly by mistake.
    if std::fs::read_dir(root).map_err(|_| "fresh_root")?.next().is_some() {return Err("root_not_empty");}
    let mut wallet=observer::storage::ProtectedWallet::open(root)?;
    let connection=rusqlite::Connection::open(root.join("wallet.sqlite")).map_err(|_| "wal_connection")?;
    connection.pragma_update(None,"journal_mode","WAL").map_err(|_| "wal_mode")?;
    let full=UnifiedSpendingKey::from_seed(&MAIN_NETWORK,&[9;32],zip32::AccountId::ZERO)
        .map_err(|_| "fixture_key")?.to_unified_full_viewing_key().encode(&MAIN_NETWORK);
    let key=observer::connection::scoped_key(&full)?;
    let height=BlockHeight::from_u32(3_524_931);
    let birthday=AccountBirthday::from_parts(ChainState::empty(height-1,zcash_primitives::block::BlockHash([0;32])),None);
    if committed {
        observer::import_once(wallet.db_mut(),&key,&birthday,u32::from(height))?;
        observer::storage::ProtectedWallet::audit(root)?;
        if !root.join("wallet.sqlite-wal").exists() {return Err("wal_missing");}
        // No destructors, SQLite close/checkpoint, or graceful writer-lock release.
        std::process::exit(67);
    }
    let result: Result<(), zcash_client_sqlite::error::SqliteClientError> = wallet.db_mut().transactionally(|db| {
        db.import_account_ufvk("public-crash-fixture",&key,&birthday,AccountPurpose::ViewOnly,None)?;
        std::process::exit(67);
    });
    result.map_err(|_| "uncommitted_import")
}

fn check() -> Result<(), &'static str> {
    for committed in [false,true] {
        let root=tempfile::tempdir().map_err(|_| "temporary_root")?;
        std::fs::set_permissions(root.path(),std::fs::Permissions::from_mode(0o700)).map_err(|_| "root_permissions")?;
        let status=std::process::Command::new(std::env::current_exe().map_err(|_| "fixture_executable")?)
            .arg(if committed {"committed"} else {"uncommitted"}).arg(root.path())
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .status().map_err(|_| "child_start")?;
        if status.code()!=Some(67) {return Err("child_exit");}
        let mut wallet=observer::storage::ProtectedWallet::open(root.path())?;
        if wallet.db_mut().get_account_ids().map_err(|_| "recovered_accounts")?.len()!=usize::from(committed) {
            return Err("recovery_atomicity");
        }
        let connection=rusqlite::Connection::open(root.path().join("wallet.sqlite")).map_err(|_| "integrity_open")?;
        let integrity:String=connection.query_row("PRAGMA integrity_check",[],|row|row.get(0)).map_err(|_| "integrity_query")?;
        if integrity!="ok" {return Err("integrity_failed");}
        observer::storage::ProtectedWallet::audit(root.path())?;
    }
    Ok(())
}

fn main() {
    let args:Vec<_>=std::env::args_os().collect();
    if args.len()==3 {
        let committed=match args[1].to_str() {Some("committed")=>true,Some("uncommitted")=>false,_=>std::process::exit(1)};
        if child(Path::new(&args[2]),committed).is_err() {std::process::exit(1);}
        std::process::exit(1);
    }
    if args.len()!=1 {std::process::exit(1);}
    let result=check();
    println!("{}",serde_json::json!({"temporary_public_fixture_only":true,"abrupt_exit_recovery_passed":result.is_ok(),
        "failed_stage":result.err(),"sends_requested":0,"vps_services_changed":false}));
    if result.is_err() {std::process::exit(1);}
}
