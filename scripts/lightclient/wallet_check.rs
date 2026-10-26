//! Offline, memory-only account binding. No wallet, transport or signer module.
use zcash_address::unified::{self, Container, Encoding};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_protocol::consensus::{Parameters, MAIN_NETWORK};

pub fn check(encoded: &str, display_address: &str) -> Result<(), ()> {
    if encoded.len() > 3000 || !encoded.starts_with("uview1")
        || display_address.len() > 3000 || !display_address.starts_with("u1") {
        return Err(());
    }
    let key = UnifiedFullViewingKey::decode(&MAIN_NETWORK, encoded).map_err(|_| ())?;
    if key.encode(&MAIN_NETWORK) != encoded { return Err(()); }
    let full = key.orchard().ok_or(())?;
    let (network, ua) = unified::Address::decode(display_address).map_err(|_| ())?;
    if network != MAIN_NETWORK.network_type() || ua.encode(&network) != display_address {
        return Err(());
    }
    let raw = ua.items().iter().find_map(|r| match r {
        unified::Receiver::Orchard(bytes) => Some(*bytes), _ => None,
    }).ok_or(())?;
    let receiver = Option::<orchard::Address>::from(
        orchard::Address::from_raw_address_bytes(&raw)).ok_or(())?;
    if full.scope_for_address(&receiver) != Some(orchard::keys::Scope::External) {
        return Err(());
    }
    // A normal wallet display UA may be mixed. This checks its Orchard component
    // only; it does not approve that mixed address as a refund destination.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use orchard::keys::Scope;
    use zcash_keys::keys::UnifiedSpendingKey;
    use zcash_protocol::consensus::TEST_NETWORK;

    fn key(seed: u8) -> UnifiedFullViewingKey {
        UnifiedSpendingKey::from_seed(&MAIN_NETWORK, &[seed; 32], zip32::AccountId::ZERO)
            .unwrap().to_unified_full_viewing_key()
    }
    fn address(k: &UnifiedFullViewingKey, scope: Scope, mixed: bool) -> String {
        let mut items = vec![unified::Receiver::Orchard(
            k.orchard().unwrap().address_at(0u32, scope).to_raw_address_bytes())];
        if mixed { items.push(unified::Receiver::P2pkh([0; 20])); }
        unified::Address::try_from_items(items).unwrap().encode(&MAIN_NETWORK.network_type())
    }
    #[test]
    fn selected_external_receiver_binds_in_single_and_mixed_display_addresses() {
        let k = key(21);
        for mixed in [false, true] {
            assert!(check(&k.encode(&MAIN_NETWORK), &address(&k, Scope::External, mixed)).is_ok());
        }
    }
    #[test]
    fn another_account_and_internal_change_are_rejected() {
        let k = key(21);
        assert!(check(&key(22).encode(&MAIN_NETWORK), &address(&k, Scope::External, false)).is_err());
        assert!(check(&k.encode(&MAIN_NETWORK), &address(&k, Scope::Internal, false)).is_err());
    }
    #[test]
    fn wrong_network_incoming_only_and_non_unified_addresses_are_rejected() {
        let k = key(21);
        let ua = address(&k, Scope::External, false);
        let (_, decoded) = unified::Address::decode(&ua).unwrap();
        assert!(check(&k.encode(&TEST_NETWORK), &ua).is_err());
        assert!(check(&k.encode(&MAIN_NETWORK), &decoded.encode(&TEST_NETWORK.network_type())).is_err());
        assert!(check(&k.to_unified_incoming_viewing_key().encode(&MAIN_NETWORK), &ua).is_err());
        for a in ["t1invalid", "tex1invalid", "", &"u1".repeat(2000)] {
            assert!(check(&k.encode(&MAIN_NETWORK), a).is_err());
        }
        assert!(check(&"uview1".repeat(600), &ua).is_err());
    }
}
