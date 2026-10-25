//! Linux-only protected SQLite opening. No real-key intake or backup export.
use std::{fs::{self,File,OpenOptions}, os::unix::fs::{MetadataExt,OpenOptionsExt}, path::Path};
use super::Database;

pub struct ProtectedWallet {db: Database, _lock: File, root: std::path::PathBuf}
const FILES: [&str;5] = ["wallet.sqlite","wallet.sqlite-wal","wallet.sqlite-shm","wallet.sqlite-journal","writer.lock"];

fn private_file(meta: &fs::Metadata, uid: u32) -> Result<(), &'static str> {
    if !meta.is_file() || meta.uid()!=uid || meta.mode()&0o077!=0 || meta.nlink()!=1 {
        return Err("unsafe_wallet_file");
    }
    Ok(())
}
fn validate(root: &Path) -> Result<u32, &'static str> {
    let uid = fs::metadata("/proc/self").map_err(|_| "process_identity")?.uid();
    if !root.is_absolute() || fs::canonicalize(root).map_err(|_| "storage_path")?!=root {
        return Err("storage_path_not_canonical");
    }
    let meta=fs::symlink_metadata(root).map_err(|_| "storage_directory")?;
    if !meta.is_dir() || meta.uid()!=uid || meta.mode()&0o077!=0 {return Err("unsafe_storage_directory");}
    for parent in root.ancestors().skip(1) {
        let m=fs::symlink_metadata(parent).map_err(|_| "storage_ancestor")?;
        // A root-owned sticky directory such as /tmp cannot be used by other users
        // to replace this process's private child directory. Other writable
        // ancestors and ancestors controlled by another user are rejected.
        if !m.is_dir() || (m.uid()!=0 && m.uid()!=uid)
            || (m.mode()&0o022!=0 && !(m.uid()==0 && m.mode()&0o1000!=0)) {
            return Err("unsafe_storage_ancestor");
        }
    }
    for name in FILES {
        match fs::symlink_metadata(root.join(name)) {
            Ok(meta) => private_file(&meta,uid)?,
            Err(e) if e.kind()==std::io::ErrorKind::NotFound => (),
            Err(_) => return Err("wallet_file_metadata"),
        }
    }
    // Unexpected copies, exported keys or raw logs are not accepted in this root.
    for entry in fs::read_dir(root).map_err(|_| "storage_listing")? {
        let name=entry.map_err(|_| "storage_entry")?.file_name();
        if !FILES.iter().any(|n|name==*n) {return Err("unexpected_storage_file");}
    }
    Ok(uid)
}
fn open_private(root: &Path, name: &str, uid: u32) -> Result<File, &'static str> {
    let file=OpenOptions::new().read(true).write(true).create(true).truncate(false).mode(0o600)
        .custom_flags(nix::libc::O_NOFOLLOW).open(root.join(name)).map_err(|_| "protected_file_open")?;
    private_file(&file.metadata().map_err(|_| "protected_file_metadata")?,uid)?;
    Ok(file)
}
impl ProtectedWallet {
    pub fn open(root: &Path) -> Result<Self, &'static str> {
        let uid=validate(root)?;
        let lock=open_private(root,"writer.lock",uid)?;
        lock.try_lock().map_err(|_| "wallet_writer_locked")?;
        // Pre-create with 0600 before SQLite can create a journal. SQLite derives
        // WAL/SHM permissions from the database; audit them again after writes.
        let _file=open_private(root,"wallet.sqlite",uid)?;
        let db=super::open_fixture(&root.join("wallet.sqlite"))?;
        validate(root)?;
        Ok(Self{db,_lock:lock,root:root.to_path_buf()})
    }
    pub fn incoming_candidates(&self, account: &str, after: i64) -> Result<Vec<(i64,String)>, &'static str> {
        let account=uuid::Uuid::parse_str(account).map_err(|_| "candidate_account")?;
        let conn=rusqlite::Connection::open_with_flags(self.root.join("wallet.sqlite"),rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| "candidate_open")?;
        candidate_rows(&conn, account, after)
    }
    pub fn db_mut(&mut self) -> &mut Database {&mut self.db}
    pub fn audit(root: &Path) -> Result<(), &'static str> {validate(root).map(|_|())}
}

fn candidate_rows(conn: &rusqlite::Connection, account: uuid::Uuid, after: i64) -> Result<Vec<(i64,String)>, &'static str> {
        let mut stmt=conn.prepare("SELECT DISTINCT t.id_tx,t.txid FROM v_received_outputs ro JOIN accounts a ON a.id=ro.account_id JOIN transactions t ON t.id_tx=ro.transaction_id WHERE a.uuid=? AND t.id_tx>? ORDER BY t.id_tx LIMIT 4").map_err(|_| "candidate_query")?;
        let rows=stmt.query_map(rusqlite::params![account.as_bytes().as_slice(),after],|row| {
            let id:i64=row.get(0)?;
            let mut bytes:Vec<u8>=row.get(1)?;
            bytes.reverse();
            Ok((id,hex::encode(bytes)))
        }).map_err(|_| "candidate_read")?;
        rows.collect::<Result<Vec<_>,_>>().map_err(|_| "candidate_read")
    }


#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink,PermissionsExt};
    #[test]
    fn candidates_include_spent_notes_deduplicate_and_page_with_account_isolation() {
        let conn=rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE accounts(id INTEGER,uuid BLOB); CREATE TABLE transactions(id_tx INTEGER,txid BLOB); CREATE TABLE v_received_outputs(account_id INTEGER,transaction_id INTEGER,pool TEXT,spent INTEGER);").unwrap();
        let account=uuid::Uuid::from_bytes([1;16]);
        conn.execute("INSERT INTO accounts VALUES(1,?)",rusqlite::params![account.as_bytes().as_slice()]).unwrap();
        conn.execute("INSERT INTO accounts VALUES(2,?)",rusqlite::params![&[2u8;16][..]]).unwrap();
        for id in 1i64..=6 {
            conn.execute("INSERT INTO transactions VALUES(?,?)",rusqlite::params![id,vec![id as u8;32]]).unwrap();
            conn.execute("INSERT INTO v_received_outputs VALUES(1,?,'orchard',1)",[id]).unwrap();
            conn.execute("INSERT INTO v_received_outputs VALUES(1,?,'ironwood',0)",[id]).unwrap();
        }
        conn.execute("INSERT INTO transactions VALUES(7,?)",rusqlite::params![vec![7u8;32]]).unwrap();
        conn.execute_batch("INSERT INTO v_received_outputs VALUES(2,7,'orchard',0)").unwrap();
        let first=candidate_rows(&conn,account,0).unwrap();
        assert_eq!(first.iter().map(|r|r.0).collect::<Vec<_>>(),vec![1,2,3,4]);
        assert_eq!(candidate_rows(&conn,account,4).unwrap().iter().map(|r|r.0).collect::<Vec<_>>(),vec![5,6]);
    }
    fn private_root() -> tempfile::TempDir {
        let root=tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(),fs::Permissions::from_mode(0o700)).unwrap();
        root
    }
    #[test]
    fn lock_excludes_a_second_writer_and_releases_on_close() {
        let root=private_root();
        let first=ProtectedWallet::open(root.path()).unwrap();
        assert!(ProtectedWallet::open(root.path()).is_err());
        assert_eq!(fs::metadata(root.path().join("wallet.sqlite")).unwrap().mode()&0o777,0o600);
        drop(first);
        assert!(ProtectedWallet::open(root.path()).is_ok());
    }
    #[test]
    fn exposed_directory_is_rejected_without_chmod_or_database_creation() {
        let root=private_root();
        fs::set_permissions(root.path(),fs::Permissions::from_mode(0o755)).unwrap();
        assert!(ProtectedWallet::open(root.path()).is_err());
        assert!(!root.path().join("wallet.sqlite").exists());
    }
    #[test]
    fn wal_and_shm_inherit_private_database_permissions() {
        let root=private_root();
        let mut wallet=ProtectedWallet::open(root.path()).unwrap();
        let connection=rusqlite::Connection::open(root.path().join("wallet.sqlite")).unwrap();
        connection.pragma_update(None,"journal_mode","WAL").unwrap();
        let height=zcash_protocol::consensus::BlockHeight::from_u32(3_524_931);
        let birthday=zcash_client_backend::data_api::AccountBirthday::from_parts(
            zcash_client_backend::data_api::chain::ChainState::empty(height-1,zcash_primitives::block::BlockHash([0;32])),None);
        super::super::import_once(wallet.db_mut(),&crate::fixture_key(9).unwrap(),&birthday,u32::from(height)).unwrap();
        for name in ["wallet.sqlite-wal","wallet.sqlite-shm"] {
            assert_eq!(fs::metadata(root.path().join(name)).unwrap().mode()&0o777,0o600);
        }
        ProtectedWallet::audit(root.path()).unwrap();
    }
    #[test]
    fn symlinks_hardlinks_and_exposed_wal_are_rejected() {
        let root=private_root();
        let other=tempfile::NamedTempFile::new().unwrap();
        let path=root.path().join("wallet.sqlite-wal");
        symlink(other.path(),&path).unwrap();
        assert!(ProtectedWallet::open(root.path()).is_err());
        fs::remove_file(&path).unwrap();
        fs::hard_link(other.path(),&path).unwrap();
        assert!(ProtectedWallet::open(root.path()).is_err());
        fs::remove_file(&path).unwrap();
        fs::write(&path,[]).unwrap();
        fs::set_permissions(&path,fs::Permissions::from_mode(0o644)).unwrap();
        assert!(ProtectedWallet::open(root.path()).is_err());
    }
}

