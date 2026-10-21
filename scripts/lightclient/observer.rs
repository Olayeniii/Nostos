//! Isolated view-only SDK foundation. No production entry point or send interface.
use std::{collections::BTreeMap, io, path::Path, sync::Mutex};
use async_trait::async_trait;
use zcash_client_backend::{
    data_api::{Account, AccountBirthday, AccountPurpose, WalletRead, WalletWrite,
        chain::{self, BlockCache, BlockSource}, scanning::ScanRange},
    proto::compact_formats::CompactBlock,
};
use zcash_client_sqlite::{WalletDb, util::SystemClock, wallet::init::init_wallet_db};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_protocol::consensus::{BlockHeight, Network};

// Downloaded compact blocks are public and disposable. Wallet scan checkpoints persist
// in SQLite; restarting discards this bounded cache and downloads missing ranges again.
#[derive(Default)]
pub struct MemoryCache(Mutex<BTreeMap<u32, CompactBlock>>);

impl MemoryCache {
    fn rows(&self, start: u32, end: u32, limit: usize) -> io::Result<Vec<CompactBlock>> {
        let blocks = self.0.lock().map_err(|_| io::Error::other("cache_lock"))?;
        let rows: Vec<_> = blocks.range(start..end).take(limit).map(|(_, b)| b.clone()).collect();
        if rows.first().is_some_and(|b| b.height != u64::from(start))
            || rows.windows(2).any(|p| p[1].height != p[0].height + 1) {
            return Err(io::Error::other("cache_gap"));
        }
        Ok(rows)
    }
}

impl BlockSource for MemoryCache {
    type Error = io::Error;
    fn with_blocks<F, E>(&self, from: Option<BlockHeight>, limit: Option<usize>, mut apply: F)
        -> Result<(), chain::error::Error<E, Self::Error>>
    where F: FnMut(CompactBlock) -> Result<(), chain::error::Error<E, Self::Error>> {
        let start = match from {
            Some(h) => u32::from(h),
            None => self.0.lock().map_err(|_| chain::error::Error::BlockSource(io::Error::other("cache_lock")))?
                .keys().next().copied().unwrap_or(0),
        };
        let rows = self.rows(start, u32::MAX, limit.unwrap_or(8192))
            .map_err(chain::error::Error::BlockSource)?;
        if rows.is_empty() && from.is_some() && limit != Some(0) {
            return Err(chain::error::Error::BlockSource(io::Error::other("cache_missing")));
        }
        for block in rows { apply(block)?; }
        Ok(())
    }
}

#[async_trait]
impl BlockCache for MemoryCache {
    fn get_tip_height(&self, range: Option<&ScanRange>) -> io::Result<Option<BlockHeight>> {
        let blocks = self.0.lock().map_err(|_| io::Error::other("cache_lock"))?;
        let (start, end) = range.map(|r| (u32::from(r.block_range().start), u32::from(r.block_range().end)))
            .unwrap_or((0, u32::MAX));
        Ok(blocks.range(start..end).next_back().map(|(h, _)| BlockHeight::from_u32(*h)))
    }
    async fn read(&self, range: &ScanRange) -> io::Result<Vec<CompactBlock>> {
        let start = u32::from(range.block_range().start);
        let end = u32::from(range.block_range().end);
        let rows = self.rows(start, end, 8192)?;
        if rows.len() != (end - start) as usize { return Err(io::Error::other("cache_missing")); }
        Ok(rows)
    }
    async fn insert(&self, rows: Vec<CompactBlock>) -> io::Result<()> {
        if rows.iter().any(|b| b.height >= u64::from(u32::MAX) || b.hash.len() != 32) {
            return Err(io::Error::other("cache_block_invalid"));
        }
        let mut blocks = self.0.lock().map_err(|_| io::Error::other("cache_lock"))?;
        let added = rows.iter().filter(|b| !blocks.contains_key(&(b.height as u32))).count();
        if blocks.len() + added > 8192 { return Err(io::Error::other("cache_capacity")); }
        for block in rows { blocks.insert(block.height as u32, block); }
        Ok(())
    }
    async fn delete(&self, range: ScanRange) -> io::Result<()> {
        let start = u32::from(range.block_range().start);
        let end = u32::from(range.block_range().end);
        self.0.lock().map_err(|_| io::Error::other("cache_lock"))?
            .retain(|h, _| *h < start || *h >= end);
        Ok(())
    }
}

pub type Database = WalletDb<rusqlite::Connection, Network, SystemClock, rand::rngs::OsRng>;

// This foundation is called only inside the temporary CI fixture directory. It is
// deliberately not a production file-opening API: locking, protected paths and
// encrypted backup handling must be added before accepting real view access.
pub fn open_fixture(path: &Path) -> Result<Database, &'static str> {
    let mut db = WalletDb::for_path(path, Network::MainNetwork, SystemClock, rand::rngs::OsRng)
        .map_err(|_| "database_open")?;
    init_wallet_db(&mut db, None).map_err(|_| "database_migration")?;
    Ok(db)
}

pub fn import_once(db: &mut Database, key: &UnifiedFullViewingKey, birthday: &AccountBirthday,
    expected_birthday: u32) -> Result<bool, &'static str> {
    if birthday.height() != BlockHeight::from_u32(expected_birthday) {
        return Err("birthday_anchor_mismatch");
    }
    if key.transparent().is_some() { return Err("transparent_view_access_rejected"); }
    if key.orchard().is_none() { return Err("orchard_view_access_required"); }
    if let Some(existing) = db.get_account_for_ufvk(key).map_err(|_| "account_lookup")? {
        if existing.birthday_height() != BlockHeight::from_u32(expected_birthday)
            || !matches!(existing.purpose(), AccountPurpose::ViewOnly) {
            return Err("account_identity_conflict");
        }
        return Ok(false);
    }
    if !db.get_account_ids().map_err(|_| "account_lookup")?.is_empty() {
        return Err("different_account_exists");
    }
    db.import_account_ufvk("observer-fixture", key, birthday, AccountPurpose::ViewOnly, None)
        .map_err(|_| "view_only_import")?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zcash_client_backend::data_api::scanning::ScanPriority;
    fn range(start: u32, end: u32) -> ScanRange {
        ScanRange::from_parts(BlockHeight::from_u32(start)..BlockHeight::from_u32(end), ScanPriority::Historic)
    }
    fn block(height: u64) -> CompactBlock { CompactBlock {height, hash: vec![0;32], ..Default::default()} }
    #[tokio::test]
    async fn gaps_rewinds_and_disposable_cache() {
        let cache = MemoryCache::default();
        cache.insert(vec![block(10), block(12)]).await.unwrap();
        assert!(cache.read(&range(10,13)).await.is_err());
        cache.insert(vec![block(11)]).await.unwrap();
        assert_eq!(cache.read(&range(10,13)).await.unwrap().len(),3);
        cache.truncate(BlockHeight::from_u32(11)).await.unwrap();
        assert_eq!(cache.get_tip_height(None).unwrap(),Some(BlockHeight::from_u32(11)));
        cache.delete(range(10,12)).await.unwrap();
        assert_eq!(cache.get_tip_height(None).unwrap(),None);
    }
    #[tokio::test]
    async fn invalid_block_does_not_modify_cache() {
        let cache = MemoryCache::default();
        assert!(cache.insert(vec![CompactBlock::default()]).await.is_err());
        assert_eq!(cache.get_tip_height(None).unwrap(),None);
    }
}

#[path = "transactions.rs"]
pub mod transactions;

#[path = "storage.rs"]
pub mod storage;
