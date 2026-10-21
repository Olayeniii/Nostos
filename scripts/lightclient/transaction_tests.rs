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
    let sender = key(31);
    let customer = key(32);
    let recipient = customer.orchard().unwrap().address_at(0u32,Scope::External);
    let rho = Rho::from_bytes(&[0;32]).unwrap();
    let nf = Nullifier::from_bytes(&[0;32]).unwrap();
    let rseed = RandomSeed::from_bytes([3;32],&rho).unwrap();
    let ironwood = pool==ShieldedPool::Ironwood;
    let note = Note::from_parts(recipient,NoteValue::from_raw(1800000),rho,rseed,
        if ironwood {NoteVersion::V3} else {NoteVersion::V2}).unwrap();
    let cmx = ExtractedNoteCommitment::from(note.commitment());
    let cv = ValueCommitment::from_bytes(&[0;32]).unwrap();
    let ovk = ovk_present.then(||sender.orchard().unwrap().to_ovk(Scope::External));
    let mut rng = rand::rngs::OsRng;
    let encrypted = if ironwood {
        let ne = IronwoodNoteEncryption::new(ovk,note,*memo().as_array());
        TransmittedNoteCiphertext{epk_bytes:IronwoodDomain::epk_bytes(ne.epk()).0,
            enc_ciphertext:ne.encrypt_note_plaintext(),out_ciphertext:ne.encrypt_outgoing_plaintext(&cv,&cmx,&mut rng)}
    } else {
        let ne = OrchardNoteEncryption::new(ovk,note,*memo().as_array());
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
    let bundle = Bundle::try_from_parts(actions,version.default_flags(),ZatBalance::zero(),Anchor::empty_tree(),authorization,version).unwrap();
    let height = 3_524_931;
    let branch = BranchId::for_height(&MAIN_NETWORK,BlockHeight::from_u32(height));
    let tx = TransactionData::<TxAuthorized>::from_parts_v6(branch,0,BlockHeight::from_u32(height+20),None,None,
        if ironwood {None} else {Some(bundle.clone())},if ironwood {Some(bundle)} else {None}).freeze().unwrap();
    let mut bytes = vec![]; tx.write(&mut bytes).unwrap();
    let parsed = decode(&bytes,tx.txid(),height,height+5).unwrap();
    (VerifiedTransaction{tx:parsed,height,tip:height+5,anchor:zcash_primitives::block::BlockHash([0;32])},sender,customer)
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
