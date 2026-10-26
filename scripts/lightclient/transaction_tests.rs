//! Offline encryption/serialization fixtures. Proofs and signatures are invalid
//! placeholders: these transactions cannot be submitted as payments or refunds.
use super::*;
use nonempty::NonEmpty;
use orchard::{bundle::{Authorized, BundleVersion}, keys::Scope,
    note::{ExtractedNoteCommitment, NoteVersion, Nullifier, RandomSeed, Rho, TransmittedNoteCiphertext},
    note_encryption::{IronwoodDomain, IronwoodNoteEncryption, OrchardDomain, OrchardNoteEncryption},
    primitives::redpallas, value::{NoteValue, ValueCommitment}, Action, Anchor, Bundle, Note, Proof};
use zcash_keys::keys::UnifiedSpendingKey;
use zcash_note_encryption::Domain;
use zcash_primitives::transaction::{TransactionData, Authorized as TxAuthorized};
use zcash_protocol::value::ZatBalance;

fn key(seed: u8) -> UnifiedFullViewingKey {
    UnifiedSpendingKey::from_seed(&MAIN_NETWORK,&[seed;32],zip32::AccountId::ZERO).unwrap().to_unified_full_viewing_key()
}
fn memo() -> MemoBytes {MemoBytes::from_bytes(b"nostos:offline-fixture:expected").unwrap()}
fn receiver(k: &UnifiedFullViewingKey) -> OrchardReceiver {
    OrchardReceiver(k.orchard().unwrap().address_at(0u32,Scope::External).to_raw_address_bytes())
}
fn fixture(pool: ShieldedPool, ovk_present: bool, duplicate: bool) -> (VerifiedTransaction, UnifiedFullViewingKey, UnifiedFullViewingKey) {
    fixture_from_sender(pool,ovk_present,duplicate,key(31))
}
fn fixture_from_sender(pool: ShieldedPool, ovk_present: bool, duplicate: bool, sender: UnifiedFullViewingKey) -> (VerifiedTransaction, UnifiedFullViewingKey, UnifiedFullViewingKey) {
    fixture_details(pool,ovk_present,duplicate,sender,1800000,memo(),0)
}
fn fixture_details(pool: ShieldedPool, ovk_present: bool, duplicate: bool, sender: UnifiedFullViewingKey,
    amount: u64, message: MemoBytes, fee: i64) -> (VerifiedTransaction, UnifiedFullViewingKey, UnifiedFullViewingKey) {
    let customer = key(32);
    let recipient = customer.orchard().unwrap().address_at(0u32,Scope::External);
    let rho = Rho::from_bytes(&[0;32]).unwrap();
    let nf = Nullifier::from_bytes(&[0;32]).unwrap();
    let rseed = RandomSeed::from_bytes([3;32],&rho).unwrap();
    let ironwood = pool==ShieldedPool::Ironwood;
    let note = Note::from_parts(recipient,NoteValue::from_raw(amount),rho,rseed,
        if ironwood {NoteVersion::V3} else {NoteVersion::V2}).unwrap();
    let cmx = ExtractedNoteCommitment::from(note.commitment());
    let cv = ValueCommitment::from_bytes(&[0;32]).unwrap();
    let ovk = ovk_present.then(||sender.orchard().unwrap().to_ovk(Scope::External));
    let mut rng = rand::rngs::OsRng;
    let encrypted = if ironwood {
        let ne = IronwoodNoteEncryption::new(ovk,note,*message.as_array());
        TransmittedNoteCiphertext{epk_bytes:IronwoodDomain::epk_bytes(ne.epk()).0,
            enc_ciphertext:ne.encrypt_note_plaintext(),out_ciphertext:ne.encrypt_outgoing_plaintext(&cv,&cmx,&mut rng)}
    } else {
        let ne = OrchardNoteEncryption::new(ovk,note,*message.as_array());
        TransmittedNoteCiphertext{epk_bytes:OrchardDomain::epk_bytes(ne.epk()).0,
            enc_ciphertext:ne.encrypt_note_plaintext(),out_ciphertext:ne.encrypt_outgoing_plaintext(&cv,&cmx,&mut rng)}
    };
    let rk_bytes: [u8;32] = sender.orchard().unwrap().to_bytes()[..32].try_into().unwrap();
    let action = Action::from_parts(nf,redpallas::VerificationKey::try_from(rk_bytes).unwrap(),cmx,
        encrypted,cv,redpallas::Signature::from([0u8;64])).unwrap();
    let mut actions = NonEmpty::new(action.clone());
    if duplicate {actions.push(action);}
    let version = if ironwood {BundleVersion::ironwood_v3()} else {BundleVersion::orchard_v3()};
    let authorization = Authorized::from_parts(Proof::new(vec![0;Proof::expected_proof_size(actions.len())]),
        redpallas::Signature::from([0u8;64]));
    let bundle = Bundle::try_from_parts(actions,version.default_flags(),ZatBalance::from_i64(fee).unwrap(),Anchor::empty_tree(),authorization,version).unwrap();
    let height = 3_524_931;
    let branch = BranchId::for_height(&MAIN_NETWORK,BlockHeight::from_u32(height));
    let tx = TransactionData::<TxAuthorized>::from_parts_v6(branch,0,BlockHeight::from_u32(height+20),None,None,
        if ironwood {None} else {Some(bundle.clone())},if ironwood {Some(bundle)} else {None}).freeze().unwrap();
    let mut bytes = vec![]; tx.write(&mut bytes).unwrap();
    let parsed = decode(&bytes,tx.txid(),height,height+5).unwrap();
    (VerifiedTransaction{tx:parsed,height,tip:height+5,anchor:zcash_primitives::block::BlockHash([0;32])},sender,customer)
}

// Public, already-published SDK regression vectors. Never fund this account.
// Source: zodl-inc/zodl-android-wallet-sdk @ 828874217a22bbf6ab7df4ea59b59f295d059ff4,
// backend-lib/src/main/rust/unified_r0.rs, MAINNET_PRE_PORT. No mnemonic is copied.
const PUBLIC_WALLET_EXPORT: &str = "uview188kc3e0wkwlv2qrke9wskcqz4qwj5sx0h8te0jgnfzyarwxm6ymzmsu9jzcl72pyamvj8whnvpfqahhx7nga2qgcv9zn9xsppym2vpcmw3204u57r5ygan9y3pllvv8wgk29ef34uycks9gee2plsa82v0g2dzdcve0g4y8ym4nmax9hnge4v9azw0hdzqr2pqr5uxq62x9p9vucdppq3f3u9z24jqx7envsh6tweu7a5xvrecxk7axjfad4pmtupsr76kvrqsjuqz3hpfdru5p6ty8qwjlfjr7p06u3dmmaap43k0fshcr3994a4l5cce2z3ef6ejdztqtqhd70xl43lmx938z56lz3d4w8twkjhx3en0up8dzqsjh5llmgxtdge3ux2lpxnr3f2e45enda2pa3qxx5pq2wjahj0k7vqfzqltkn3j0d5lxwppaqazyyfm5e5s93j4jzu25k663t8hwj6tq53mjagspzvl2y6fszhgvuudzt";
const PUBLIC_WALLET_ADDRESS: &str = "u1ppm8qyhws4mrs2m2puq2nyyrcpzfrj8hynw00355wy7vapzw5f84udl5qs5xf9lh9antxyvqfcgh76h87946q7vw5d6rrmze8x2c6p7vw59uy6mkadgz2467358z3ar7edyjcm7gkpqhdlaxhdzhqhxfacff0fud38zyyzakkscdmwvee59xzf36rhm5xvc893wewsrfe5svcmg4l85";
fn wallet_export() -> UnifiedFullViewingKey {
    UnifiedFullViewingKey::decode(&MAIN_NETWORK,PUBLIC_WALLET_EXPORT).unwrap()
}

#[test]
fn merchant_wallet_export_binds_visible_receiver_and_view_only_import() {
    use zcash_client_backend::data_api::{Account, AccountBirthday, AccountPurpose, chain::ChainState};
    let full=wallet_export();
    assert_eq!(full.encode(&MAIN_NETWORK),PUBLIC_WALLET_EXPORT);
    let scoped=super::super::connection::scoped_key(PUBLIC_WALLET_EXPORT).unwrap();
    let (_,visible)=unified::Address::decode(PUBLIC_WALLET_ADDRESS).unwrap();
    let bytes=visible.items().iter().find_map(|r|match r {
        unified::Receiver::Orchard(bytes)=>Some(*bytes),_=>None,
    }).unwrap();
    let address=orchard::Address::from_raw_address_bytes(&bytes).unwrap();
    assert_eq!(scoped.orchard().unwrap().scope_for_address(&address),Some(Scope::External));
    assert!(key(51).orchard().unwrap().scope_for_address(&address).is_none());
    assert!(scoped.transparent().is_none() && scoped.sapling().is_none());
    assert_eq!(scoped.orchard().unwrap().to_bytes(),full.orchard().unwrap().to_bytes());
    // Derive a shielded-only business destination, not a transparent fallback
    // from the wallet's mixed display address. Receipt scanning covers the same account.
    let destination=unified::Address::try_from_items(vec![unified::Receiver::Orchard(bytes)])
        .unwrap().encode(&MAIN_NETWORK.network_type());
    assert!(OrchardReceiver::parse_mainnet(&destination).is_ok());
    assert!(OrchardReceiver::parse_mainnet(PUBLIC_WALLET_ADDRESS).is_err());
    let temp=tempfile::tempdir().unwrap();
    let path=temp.path().join("fixture.sqlite");
    let birthday=AccountBirthday::from_parts(ChainState::empty(BlockHeight::from_u32(3_524_930),
        zcash_primitives::block::BlockHash([0;32])),None);
    let mut db=super::super::open_fixture(&path).unwrap();
    assert!(super::super::import_once(&mut db,&scoped,&birthday,3_524_931).unwrap());
    assert!(!super::super::import_once(&mut db,&scoped,&birthday,3_524_931).unwrap());
    let account=db.get_account_for_ufvk(&scoped).unwrap().unwrap();
    assert!(matches!(account.purpose(),AccountPurpose::ViewOnly));
    drop(db);
    let db=super::super::open_fixture(&path).unwrap();
    assert!(matches!(db.get_account_for_ufvk(&scoped).unwrap().unwrap().purpose(),AccountPurpose::ViewOnly));
}

#[test]
fn merchant_wallet_incoming_only_and_wrong_network_exports_are_rejected() {
    let full=wallet_export();
    assert!(super::super::connection::scoped_key(
        &full.to_unified_incoming_viewing_key().encode(&MAIN_NETWORK)).is_err());
    assert!(super::super::connection::scoped_key(
        &full.encode(&zcash_protocol::consensus::TEST_NETWORK)).is_err());
}

#[test]
fn merchant_wallet_scoped_export_recovers_exact_outgoing_after_reopen() {
    use zcash_client_backend::data_api::{AccountBirthday, WalletWrite, chain::ChainState};
    for pool in [ShieldedPool::Orchard,ShieldedPool::Ironwood] {
        let (tx,_,customer)=fixture_from_sender(pool,true,false,wallet_export());
        let scoped=super::super::connection::scoped_key(PUBLIC_WALLET_EXPORT).unwrap();
        let temp=tempfile::tempdir().unwrap();
        let path=temp.path().join("fixture.sqlite");
        let birthday=AccountBirthday::from_parts(ChainState::empty(BlockHeight::from_u32(tx.height-1),tx.anchor),None);
        let mut db=super::super::open_fixture(&path).unwrap();
        super::super::import_once(&mut db,&scoped,&birthday,tx.height).unwrap();
        db.update_chain_tip(BlockHeight::from_u32(tx.tip)).unwrap();
        decrypt_and_store_transaction(&MAIN_NETWORK,&mut db,&tx.tx,None).unwrap();
        assert_eq!(db.get_tx_height(tx.txid()).unwrap(),None);
        assert!(tx.store(&mut db).is_err());
        drop(db);
        let db=super::super::open_fixture(&path).unwrap();
        let stored=db.get_transaction(tx.txid()).unwrap().unwrap();
        let mut raw=vec![];stored.write(&mut raw).unwrap();
        let reparsed=decode(&raw,tx.txid(),tx.height,tx.tip).unwrap();
        let recovered=VerifiedTransaction{tx:reparsed,height:tx.height,tip:tx.tip,anchor:tx.anchor};
        let keys=HashMap::from([(1,scoped)]);
        assert_eq!(recovered.matching_output(&keys,&expected(1,&customer,pool,TransferType::Outgoing)).unwrap(),0);
        assert!(recovered.matching_output(&keys,&expected(1,&key(53),pool,TransferType::Outgoing)).is_err());
        // Synthetic mined context exists only in this test; SQLite remains unmined.
        assert_eq!(db.get_tx_height(tx.txid()).unwrap(),None);
    }
}

#[test]
fn merchant_wallet_discarded_ovk_cannot_confirm_refund() {
    for pool in [ShieldedPool::Orchard,ShieldedPool::Ironwood] {
        let (tx,_,customer)=fixture_from_sender(pool,false,false,wallet_export());
        let scoped=super::super::connection::scoped_key(PUBLIC_WALLET_EXPORT).unwrap();
        assert!(tx.matching_output(&HashMap::from([(1,scoped)]),
            &expected(1,&customer,pool,TransferType::Outgoing)).is_err());
    }
}

#[test]
fn merchant_wallet_zip321_keeps_exact_amount_receiver_and_memo() {
    use zcash_client_backend::zip321::TransactionRequest;
    let ua=unified::Address::try_from_items(vec![unified::Receiver::Orchard(receiver(&key(32)).0)])
        .unwrap().encode(&MAIN_NETWORK.network_type());
    // A short instruction reference identifies the exact external refund. Payment
    // return routes stay in the existing NOSTOS v1 paying memo.
    let uri=format!("zcash:{ua}?amount=0.01800000&memo=bm9zdG9zOnJlZnVuZDpwdWJsaWMtZml4dHVyZQ");
    let request=TransactionRequest::from_uri(&uri).unwrap();
    let payment=request.payments().values().next().unwrap();
    assert_eq!(payment.amount().unwrap().into_u64(),1800000);
    assert_eq!(payment.recipient_address().encode(),ua);
    assert_eq!(payment.memo().unwrap().as_array(),MemoBytes::from_bytes(b"nostos:refund:public-fixture").unwrap().as_array());
}
fn expected(account: u8, k: &UnifiedFullViewingKey, pool: ShieldedPool, direction: TransferType) -> Expected<u8> {
    Expected::new(account,receiver(k),1800000,memo(),pool,direction,2).unwrap()
}

#[test]
fn encrypted_incoming_and_outgoing_match_in_both_pools() {
    for pool in [ShieldedPool::Orchard,ShieldedPool::Ironwood] {
        let (tx,sender,customer) = fixture(pool,true,false);
        assert_eq!(tx.matching_output(&HashMap::from([(1,sender)]),&expected(1,&customer,pool,TransferType::Outgoing)).unwrap(),0);
        assert_eq!(tx.matching_output(&HashMap::from([(2,customer.clone())]),&expected(2,&customer,pool,TransferType::Incoming)).unwrap(),0);
    }
}
#[test]
fn every_output_field_and_confirmation_is_required() {
    let (tx,sender,customer) = fixture(ShieldedPool::Ironwood,true,false);
    let keys = HashMap::from([(1,sender)]);
    for field in 0..7 {
        let mut e = expected(1,&customer,ShieldedPool::Ironwood,TransferType::Outgoing);
        match field {
            0 => e.amount+=1, 1 => e.memo=MemoBytes::from_bytes(b"different").unwrap(),
            2 => e.receiver=receiver(&key(33)), 3 => e.pool=ShieldedPool::Orchard,
            4 => e.direction=TransferType::Incoming, 5 => e.account=2, _ => e.confirmations=100,
        }
        assert!(tx.matching_output(&keys,&e).is_err(),"field {field}");
    }
}
#[test]
fn missing_outgoing_key_and_ambiguous_outputs_are_unresolved() {
    let (tx,sender,customer) = fixture(ShieldedPool::Ironwood,false,false);
    assert!(tx.matching_output(&HashMap::from([(1,sender)]),&expected(1,&customer,ShieldedPool::Ironwood,TransferType::Outgoing)).is_err());
    let (tx,sender,customer) = fixture(ShieldedPool::Ironwood,true,true);
    assert_eq!(tx.matching_output(&HashMap::from([(1,sender)]),&expected(1,&customer,ShieldedPool::Ironwood,TransferType::Outgoing)).err(),Some("ambiguous_output_match"));
}
#[test]
fn raw_identity_height_and_trailing_data_are_rejected() {
    let (tx,_,_) = fixture(ShieldedPool::Ironwood,true,false);
    let mut raw=vec![]; tx.tx.write(&mut raw).unwrap();
    assert!(decode(&raw,TxId::from_bytes([0;32]),tx.height,tx.tip).is_err());
    assert!(decode(&raw,tx.txid(),0,tx.tip).is_err());
    assert!(decode(&raw,tx.txid(),tx.height,tx.height-1).is_err());
    raw.push(0); assert!(decode(&raw,tx.txid(),tx.height,tx.tip).is_err());
    assert!(decode(&raw[..3],tx.txid(),tx.height,tx.tip).is_err());
}
#[test]
fn routes_require_canonical_mainnet_orchard_only() {
    let k=key(32); let bytes=receiver(&k).0;
    let ua=unified::Address::try_from_items(vec![unified::Receiver::Orchard(bytes)]).unwrap();
    assert!(OrchardReceiver::parse_mainnet(&ua.encode(&MAIN_NETWORK.network_type())).is_ok());
    assert!(OrchardReceiver::parse_mainnet(&ua.encode(&zcash_protocol::consensus::TEST_NETWORK.network_type())).is_err());
    let mixed=unified::Address::try_from_items(vec![unified::Receiver::Orchard(bytes),unified::Receiver::P2pkh([0;20])]).unwrap();
    assert!(OrchardReceiver::parse_mainnet(&mixed.encode(&MAIN_NETWORK.network_type())).is_err());
    assert!(OrchardReceiver::parse_mainnet("t1invalid").is_err());
    assert!(Expected::new(1,receiver(&k),1800000,memo(),ShieldedPool::Ironwood,TransferType::Outgoing,0).is_err());
}

#[test]
fn decrypted_memo_and_transaction_survive_wal_reopen_in_both_pools() {
    use std::os::unix::fs::PermissionsExt;
    use zcash_client_backend::{data_api::{AccountBirthday, WalletWrite, chain::ChainState}, wallet::NoteId};
    for pool in [ShieldedPool::Orchard,ShieldedPool::Ironwood] {
        let (tx,_,customer)=fixture(pool,true,false);
        let temp=tempfile::tempdir().unwrap();
        std::fs::set_permissions(temp.path(),std::fs::Permissions::from_mode(0o700)).unwrap();
        let path=temp.path().join("4b723cba-3e4d-4536-9c2e-e8129e2fb731");
        std::fs::create_dir(&path).unwrap();
        std::fs::set_permissions(&path,std::fs::Permissions::from_mode(0o700)).unwrap();
        let root=path.as_path();
        let mut wallet=super::super::storage::ProtectedWallet::open(root).unwrap();
        let connection=rusqlite::Connection::open(root.join("wallet.sqlite")).unwrap();
        connection.pragma_update(None,"journal_mode","WAL").unwrap();
        let scoped=super::super::connection::scoped_key(&customer.encode(&MAIN_NETWORK)).unwrap();
        let birthday=AccountBirthday::from_parts(ChainState::empty(BlockHeight::from_u32(tx.height-1),tx.anchor),None);
        super::super::import_once(wallet.db_mut(),&scoped,&birthday,tx.height).unwrap();
        wallet.db_mut().update_chain_tip(BlockHeight::from_u32(tx.tip)).unwrap();
        // Offline unmined enhancement only: never invent mined-chain evidence.
        decrypt_and_store_transaction(&MAIN_NETWORK,wallet.db_mut(),&tx.tx,None).unwrap();
        let note=NoteId::new(tx.txid(),pool,0);
        assert_eq!(wallet.db_mut().get_memo(note).unwrap().unwrap().encode(),memo());
        assert_eq!(wallet.db_mut().get_tx_height(tx.txid()).unwrap(),None);
        assert!(wallet.db_mut().get_transaction(tx.txid()).unwrap().is_some());
        assert!(tx.store(wallet.db_mut()).is_err());
        super::super::storage::ProtectedWallet::audit(root).unwrap();
        let helper=std::env::var("NOSTOS_BACKUP_FIXTURE").expect("CI backup fixture path");
        assert!(std::path::Path::new(&helper).is_absolute() && std::path::Path::new(&helper).is_file(),"absolute backup fixture script");
        let locked=std::process::Command::new("python3").arg(&helper).arg("--check-locked").arg(root)
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().unwrap();
        assert!(locked.success(),"backup must respect native writer lock");
        drop(connection);
        drop(wallet);
        let mut reopened=super::super::storage::ProtectedWallet::open(root).unwrap();
        assert_eq!(reopened.db_mut().get_memo(note).unwrap().unwrap().encode(),memo());
        assert_eq!(reopened.db_mut().get_tx_height(tx.txid()).unwrap(),None);
        let stored=reopened.db_mut().get_transaction(tx.txid()).unwrap().unwrap();
        let mut expected_raw=vec![];tx.tx.write(&mut expected_raw).unwrap();
        let mut actual_raw=vec![];stored.write(&mut actual_raw).unwrap();
        assert_eq!(actual_raw,expected_raw);
        assert!(tx.store(reopened.db_mut()).is_err());
        super::super::storage::ProtectedWallet::audit(root).unwrap();
        drop(reopened);
        let result=std::process::Command::new("python3").arg(helper).arg(root)
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().unwrap();
        assert!(result.success(),"encrypted backup/restore fixture");
        let recovered=temp.path().join("restored").join(root.file_name().unwrap());
        let mut restored=super::super::storage::ProtectedWallet::open(&recovered).unwrap();
        assert_eq!(restored.db_mut().get_memo(note).unwrap().unwrap().encode(),memo());
        assert_eq!(restored.db_mut().get_tx_height(tx.txid()).unwrap(),None);
        assert!(restored.db_mut().get_transaction(tx.txid()).unwrap().is_some());
        assert!(tx.store(restored.db_mut()).is_err());
        super::super::storage::ProtectedWallet::audit(&recovered).unwrap();
    }
}

#[test]
fn confirmed_store_requires_the_same_fully_scanned_chain_context() {
    let anchor = zcash_primitives::block::BlockHash([7;32]);
    let changed = zcash_primitives::block::BlockHash([8;32]);
    assert!(require_current_context(100,105,anchor,Some(105),Some(105),Some(anchor)).is_ok());
    for (tip, scanned, block) in [
        (None,Some(105),Some(anchor)),
        (Some(104),Some(105),Some(anchor)),
        (Some(106),Some(105),Some(anchor)),
        (Some(105),None,Some(anchor)),
        (Some(105),Some(104),Some(anchor)),
        (Some(105),Some(105),None),
        (Some(105),Some(105),Some(changed)),
    ] {
        assert_eq!(require_current_context(100,105,anchor,tip,scanned,block),
            Err("wallet_context_changed"));
    }
    assert!(require_current_context(0,105,anchor,Some(105),Some(105),Some(anchor)).is_err());
    assert!(require_current_context(106,105,anchor,Some(105),Some(105),Some(anchor)).is_err());
}

#[test]
fn control_requires_owned_spend_exact_outgoing_and_fee_cap() {
    let message=MemoBytes::from_bytes(b"nostos:control:0123456789abcdef0123456789abcdef").unwrap();
    let owned=[Nullifier::from_bytes(&[0;32]).unwrap()];
    let unknown=[Nullifier::from_bytes(&[1;32]).unwrap()];
    for (pool,ovk,duplicate,fee,passes) in [
        (ShieldedPool::Ironwood,true,false,10_000,true),
        (ShieldedPool::Ironwood,true,false,10_001,false),
        (ShieldedPool::Ironwood,true,false,-1,false),
        (ShieldedPool::Orchard,true,false,10_000,false),
        (ShieldedPool::Ironwood,false,false,10_000,false),
        (ShieldedPool::Ironwood,true,true,10_000,false),
    ] {
        let (tx,sender,customer)=fixture_details(pool,ovk,duplicate,key(31),10_000,message.clone(),fee);
        let keys=HashMap::from([(1,sender)]);
        let expected=Expected::new(1,receiver(&customer),10_000,message.clone(),
            ShieldedPool::Ironwood,TransferType::Outgoing,3).unwrap();
        assert_eq!(tx.verify_control(&keys,&expected,&owned,tx.tip).is_ok(),passes);
        assert!(tx.verify_control(&keys,&expected,&[],tx.tip).is_err());
        assert!(tx.verify_control(&keys,&expected,&unknown,tx.tip).is_err());
        assert!(tx.verify_control(&keys,&expected,&owned,tx.tip+1).is_err());
    }
}

#[test]
fn control_rejects_self_transfer_changed_fields_and_weak_confirmations() {
    let message=MemoBytes::from_bytes(b"nostos:control:0123456789abcdef0123456789abcdef").unwrap();
    let (tx,sender,customer)=fixture_details(ShieldedPool::Ironwood,true,false,key(31),10_000,message.clone(),10_000);
    assert!(receiver(&sender).require_external_to(&sender).is_err());
    assert!(receiver(&customer).require_external_to(&sender).is_ok());
    let keys=HashMap::from([(1,sender)]);
    let owned=[Nullifier::from_bytes(&[0;32]).unwrap()];
    for field in 0..7 {
        let mut e=Expected::new(1,receiver(&customer),10_000,message.clone(),
            ShieldedPool::Ironwood,TransferType::Outgoing,3).unwrap();
        match field {
            0=>e.amount=9999, 1=>e.confirmations=2, 2=>e.confirmations=100,
            3=>e.direction=TransferType::Incoming, 4=>e.receiver=receiver(&key(33)),
            5=>e.memo=memo(), _=>e.account=2,
        }
        assert!(tx.verify_control(&keys,&e,&owned,tx.tip).is_err(),"field {field}");
    }
}

#[test]
fn product_proofs_match_saved_fields_without_echoing_receiver_or_memo() {
    let owned=[Nullifier::from_bytes(&[0;32]).unwrap()];
    for pool in [ShieldedPool::Orchard,ShieldedPool::Ironwood] {
        let (tx,sender,customer)=fixture(pool,true,false);
        let keys=HashMap::from([(1,sender.clone()),(2,customer.clone())]);
        for (account,direction) in [(1,TransferType::Outgoing),(2,TransferType::Incoming)] {
            let expected=Expected::new(account,receiver(&customer),1800000,memo(),pool,direction,3).unwrap();
            let proof=tx.verify_product(&keys,&expected,&owned,tx.tip,10000,
                "afcf8468-1814-4fea-a9f6-ce5a57505078","afcf8468-1814-4fea-a9f6-ce5a57505078",&"a".repeat(64)).unwrap();
            assert_eq!(proof["nostos_output_proof_v1"],true);
            assert_eq!(proof["owned_spend"],direction==TransferType::Outgoing);
            assert!(!proof.to_string().contains("nostos:offline-fixture"));
            assert!(proof.get("receiver").is_none() && proof.get("memo").is_none());
            assert!(tx.verify_product(&keys,&expected,&owned,tx.tip+1,10000,"binding","account","tip").is_err());
            if direction==TransferType::Outgoing {
                assert!(tx.verify_product(&keys,&expected,&[],tx.tip,10000,"binding","account","tip").is_err());
                assert!(tx.verify_product(&keys,&expected,&owned,tx.tip,0,"binding","account","tip").is_err());
            }
        }
    }
}

#[test]
fn product_proofs_reject_ambiguous_outputs_and_changed_expectations() {
    let owned=[Nullifier::from_bytes(&[0;32]).unwrap()];
    for (ovk,duplicate) in [(false,false),(true,true)] {
        let (tx,sender,customer)=fixture(ShieldedPool::Ironwood,ovk,duplicate);
        let expected=Expected::new(1,receiver(&customer),1800000,memo(),ShieldedPool::Ironwood,TransferType::Outgoing,3).unwrap();
        assert!(tx.verify_product(&HashMap::from([(1,sender)]),&expected,&owned,tx.tip,10000,"binding","account","tip").is_err());
    }
    let (tx,sender,customer)=fixture(ShieldedPool::Ironwood,true,false);
    let keys=HashMap::from([(1,sender)]);
    for field in 0..6 {
        let mut expected=Expected::new(1,receiver(&customer),1800000,memo(),ShieldedPool::Ironwood,TransferType::Outgoing,3).unwrap();
        match field {0=>expected.amount+=1,1=>expected.memo=MemoBytes::from_bytes(b"wrong").unwrap(),
            2=>expected.pool=ShieldedPool::Orchard,3=>expected.account=3,
            4=>expected.confirmations=2,_=>expected.receiver=receiver(&key(33)),}
        assert!(tx.verify_product(&keys,&expected,&owned,tx.tip,10000,"binding","account","tip").is_err());
    }
}


#[test]
fn shielded_display_routes_are_projected_to_canonical_orchard_without_transparent_fallback() {
    let k=key(53); let bytes=receiver(&k).0;
    let canonical=unified::Address::try_from_items(vec![unified::Receiver::Orchard(bytes)]).unwrap().encode(&MAIN_NETWORK.network_type());
    let mixed=unified::Address::try_from_items(vec![unified::Receiver::Orchard(bytes),unified::Receiver::Sapling([0;43])]).unwrap();
    let projected=refund_receivers(&mixed.encode(&MAIN_NETWORK.network_type())).unwrap();
    assert_eq!(projected["orchard"].as_str(),Some(canonical.as_str()));
    assert!(projected["sapling"].is_string());
    assert_eq!(refund_receivers(&canonical).unwrap(),serde_json::json!({"orchard":canonical}));
    assert!(OrchardReceiver::parse_mainnet(projected["orchard"].as_str().unwrap()).is_ok());
    assert!(refund_receivers(&mixed.encode(&zcash_protocol::consensus::TEST_NETWORK.network_type())).is_err());
    let transparent=unified::Address::try_from_items(vec![unified::Receiver::Orchard(bytes),unified::Receiver::P2pkh([0;20])]).unwrap();
    assert!(refund_receivers(&transparent.encode(&MAIN_NETWORK.network_type())).is_err());
    let sapling=unified::Address::try_from_items(vec![unified::Receiver::Sapling([0;43])]).unwrap();
    assert!(refund_receivers(&sapling.encode(&MAIN_NETWORK.network_type())).is_err());
    assert!(refund_receivers("t1invalid").is_err());
}

#[test]
fn product_refund_to_same_account_requires_owned_spend_and_exact_output() {
    let owned=[Nullifier::from_bytes(&[0;32]).unwrap()];
    let unknown=[Nullifier::from_bytes(&[1;32]).unwrap()];
    for pool in [ShieldedPool::Orchard,ShieldedPool::Ironwood] {
        let (tx,sender,customer)=fixture_from_sender(pool,true,false,key(32));
        assert_eq!(sender.encode(&MAIN_NETWORK),customer.encode(&MAIN_NETWORK));
        let keys=HashMap::from([(1,sender)]);
        let expected=Expected::new(1,receiver(&customer),1800000,memo(),pool,TransferType::Outgoing,3).unwrap();
        // SDK labels external-address receipts Incoming even when this account funded them.
        assert!(tx.matching_output(&keys,&expected).is_err());
        assert!(tx.verify_product_with_policy(&keys,&expected,&owned,tx.tip,10000,"binding","account","tip",false).is_err());
        assert!(tx.verify_product(&keys,&expected,&owned,tx.tip,10000,"binding","account","tip").is_err());
        let proof=tx.verify_product_with_policy(&keys,&expected,&owned,tx.tip,10000,"binding","account","tip",true).unwrap();
        assert_eq!(proof["self_refund_test"],true);
        assert_eq!(proof["owned_spend"],true);
        assert_eq!(proof["direction"],"outgoing");
        assert!(tx.verify_product_with_policy(&keys,&expected,&[],tx.tip,10000,"binding","account","tip",true).is_err());
        assert!(tx.verify_product_with_policy(&keys,&expected,&unknown,tx.tip,10000,"binding","account","tip",true).is_err());
        for field in 0..4 {
            let mut changed=Expected::new(1,receiver(&customer),1800000,memo(),pool,TransferType::Outgoing,3).unwrap();
            match field {0=>changed.amount+=1,1=>changed.memo=MemoBytes::from_bytes(b"wrong").unwrap(),
                2=>changed.receiver=receiver(&key(33)),_=>changed.confirmations=100,}
            assert!(tx.verify_product_with_policy(&keys,&changed,&owned,tx.tip,10000,"binding","account","tip",true).is_err());
        }
        let (ambiguous,sender,customer)=fixture_from_sender(pool,true,true,key(32));
        let expected=Expected::new(1,receiver(&customer),1800000,memo(),pool,TransferType::Outgoing,3).unwrap();
        assert!(ambiguous.verify_product_with_policy(&HashMap::from([(1,sender)]),&expected,&owned,ambiguous.tip,10000,"binding","account","tip",true).is_err());
    }
    let message=MemoBytes::from_bytes(b"nostos:control:0123456789abcdef0123456789abcdef").unwrap();
    let (tx,sender,customer)=fixture_details(ShieldedPool::Ironwood,true,false,key(32),10_000,message.clone(),10_000);
    let expected=Expected::new(1,receiver(&customer),10_000,message,ShieldedPool::Ironwood,TransferType::Outgoing,3).unwrap();
    assert!(tx.verify_control(&HashMap::from([(1,sender)]),&expected,&owned,tx.tip).is_err());
}
