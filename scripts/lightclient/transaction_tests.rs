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
    fixture_with_values(pool,ovk_present,duplicate,sender,1800000,memo(),0)
}
fn fixture_with_values(pool: ShieldedPool, ovk_present: bool, duplicate: bool, sender: UnifiedFullViewingKey,
    value:u64, note_memo:MemoBytes, fee:i64) -> (VerifiedTransaction, UnifiedFullViewingKey, UnifiedFullViewingKey) {
    let customer = key(32);
    let recipient = customer.orchard().unwrap().address_at(0u32,Scope::External);
    let rho = Rho::from_bytes(&[0;32]).unwrap();
    let nf = Nullifier::from_bytes(&[0;32]).unwrap();
    let rseed = RandomSeed::from_bytes([3;32],&rho).unwrap();
    let ironwood = pool==ShieldedPool::Ironwood;
    let note = Note::from_parts(recipient,NoteValue::from_raw(value),rho,rseed,
        if ironwood {NoteVersion::V3} else {NoteVersion::V2}).unwrap();
    let cmx = ExtractedNoteCommitment::from(note.commitment());
    let cv = ValueCommitment::from_bytes(&[0;32]).unwrap();
    let ovk = ovk_present.then(||sender.orchard().unwrap().to_ovk(Scope::External));
    let mut rng = rand::rngs::OsRng;
    let encrypted = if ironwood {
        let ne = IronwoodNoteEncryption::new(ovk,note,*note_memo.as_array());
        TransmittedNoteCiphertext{epk_bytes:IronwoodDomain::epk_bytes(ne.epk()).0,
            enc_ciphertext:ne.encrypt_note_plaintext(),out_ciphertext:ne.encrypt_outgoing_plaintext(&cv,&cmx,&mut rng)}
    } else {
        let ne = OrchardNoteEncryption::new(ovk,note,*note_memo.as_array());
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

fn control_request<A>(account:A, customer:&UnifiedFullViewingKey) -> ControlRequest<A> {
    let ua=unified::Address::try_from_items(vec![unified::Receiver::Orchard(receiver(customer).0)])
        .unwrap().encode(&MAIN_NETWORK.network_type());
    ControlRequest::new(account,&ua,&"a".repeat(32),10_000,20_000,3).unwrap()
}
fn control_fixture(pool:ShieldedPool, ovk:bool, fee:i64) -> (VerifiedTransaction,UnifiedFullViewingKey,UnifiedFullViewingKey) {
    let request=control_request(1,&key(32));
    fixture_with_values(pool,ovk,false,key(31),10_000,request.expected.memo,fee)
}

#[test]
fn control_fields_recover_exact_outgoing_and_enforce_actual_gross_input_cap() {
    let (tx,sender,customer)=control_fixture(ShieldedPool::Ironwood,true,10_000);
    let request=control_request(1,&customer);
    let keys=HashMap::from([(1,sender)]);
    let nfs=[[0u8;32]];
    assert_eq!(tx.control_fields(&keys,&request,&nfs,|_|Ok(20_000)).unwrap(),(0,10_000,20_000));
    for value in [0,19_999,20_001,u64::MAX] {
        assert!(tx.control_fields(&keys,&request,&nfs,|_|Ok(value)).is_err());
    }
    assert!(tx.control_fields(&keys,&request,&[],|_|panic!("no owned input should be queried")).is_err());
    assert!(tx.control_fields(&keys,&request,&nfs,|_|Err("missing_note")).is_err());
}

#[test]
fn control_fields_reject_wrong_memo_receiver_pool_key_and_fee() {
    for (pool,ovk,fee) in [(ShieldedPool::Orchard,true,10_000),(ShieldedPool::Ironwood,false,10_000),
        (ShieldedPool::Ironwood,true,10_001),(ShieldedPool::Ironwood,true,-1)] {
        let (tx,sender,customer)=control_fixture(pool,ovk,fee);
        assert!(tx.control_fields(&HashMap::from([(1,sender)]),&control_request(1,&customer),&[[0u8;32]],|_|Ok(20_000)).is_err());
    }
    let (tx,sender,customer)=control_fixture(ShieldedPool::Ironwood,true,10_000);
    let mut request=control_request(1,&customer);
    request.expected.memo=MemoBytes::from_bytes(b"wrong-control-reference").unwrap();
    assert!(tx.control_fields(&HashMap::from([(1,sender.clone())]),&request,&[[0u8;32]],|_|Ok(20_000)).is_err());
    let own_receiver=control_request(1,&sender);
    assert!(tx.control_fields(&HashMap::from([(1,sender.clone())]),&own_receiver,&[[0u8;32]],|_|Ok(20_000)).is_err());
    assert!(tx.control_fields(&HashMap::from([(1,sender),(2,key(44))]),&control_request(1,&customer),&[[0u8;32]],|_|Ok(20_000)).is_err());
}

#[test]
fn control_request_rejects_unsafe_policy_or_noncanonical_destination() {
    let customer=key(32);
    let ua=unified::Address::try_from_items(vec![unified::Receiver::Orchard(receiver(&customer).0)])
        .unwrap().encode(&MAIN_NETWORK.network_type());
    for (fee,debit,confirmations) in [(10_001,20_001,3),(0,20_000,3),(10_000,19_999,3),(10_000,20_000,2)] {
        assert!(ControlRequest::new(1,&ua,&"a".repeat(32),fee,debit,confirmations).is_err());
    }
    for reference in ["", "nostos:control:private-route",&"A".repeat(32)] {
        assert!(ControlRequest::new(1,&ua,reference,10_000,20_000,3).is_err());
    }
    for address in ["t1invalid","tex1invalid",""] {
        assert!(ControlRequest::new(1,address,&"a".repeat(32),10_000,20_000,3).is_err());
    }
}

#[test]
fn synthetic_unmined_control_cannot_produce_verified_evidence_even_after_reopen() {
    use zcash_client_backend::data_api::{Account,AccountBirthday,WalletWrite,chain::ChainState};
    let (tx,sender,customer)=control_fixture(ShieldedPool::Ironwood,true,10_000);
    let temp=tempfile::tempdir().unwrap();
    let path=temp.path().join("unmined-control.sqlite");
    let scoped=super::super::connection::scoped_key(&sender.encode(&MAIN_NETWORK)).unwrap();
    let birthday=AccountBirthday::from_parts(ChainState::empty(BlockHeight::from_u32(tx.height-1),tx.anchor),None);
    let mut db=super::super::open_fixture(&path).unwrap();
    super::super::import_once(&mut db,&scoped,&birthday,tx.height).unwrap();
    let account=db.get_account_for_ufvk(&scoped).unwrap().unwrap().id();
    db.update_chain_tip(BlockHeight::from_u32(tx.tip)).unwrap();
    decrypt_and_store_transaction(&MAIN_NETWORK,&mut db,&tx.tx,None).unwrap();
    assert!(tx.verify_control(&mut db,&control_request(account,&customer)).is_err());
    drop(db);
    let mut reopened=super::super::open_fixture(&path).unwrap();
    assert_eq!(reopened.get_tx_height(tx.txid()).unwrap(),None);
    assert!(tx.verify_control(&mut reopened,&control_request(account,&customer)).is_err());
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
