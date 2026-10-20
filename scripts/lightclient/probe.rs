//! Public-chain SDK compatibility probe. No wallet, key input, signing or sends.
use std::time::Duration;
use tonic::transport::{ClientTlsConfig, Endpoint};
use zcash_client_backend::{
    data_api::AccountBirthday,
    proto::service::{compact_tx_streamer_client::CompactTxStreamerClient, BlockId, Empty},
};

async fn probe(url: &'static str) -> Result<serde_json::Value, &'static str> {
    let endpoint = Endpoint::from_static(url)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .tls_config(ClientTlsConfig::new().with_webpki_roots())
        .map_err(|_| "tls_configuration")?;
    let channel = endpoint.connect().await.map_err(|_| "tls_connection")?;
    let mut client = CompactTxStreamerClient::new(channel);
    let info = client
        .get_lightd_info(Empty {})
        .await
        .map_err(|_| "server_metadata")?
        .into_inner();
    if info.chain_name != "main" || info.block_height <= 3_428_143 {
        return Err("mainnet_identity");
    }
    // Use a mined anchor below the sampled tip so a new block cannot race it.
    let height = info.block_height - 2;
    let tree = client
        .get_tree_state(BlockId { height, hash: vec![] })
        .await
        .map_err(|_| "tree_state_rpc")?
        .into_inner();
    if tree.network != "main" || tree.height != height || tree.ironwood_tree.is_empty() {
        return Err("ironwood_tree_identity");
    }
    AccountBirthday::from_treestate(tree.clone(), None)
        .map_err(|_| "sdk_birthday_tree_decode")?;
    let block = client
        .get_block(BlockId { height, hash: vec![] })
        .await
        .map_err(|_| "compact_block_rpc")?
        .into_inner();
    let reversed_hash: Vec<u8> = block.hash.iter().rev().copied().collect();
    if block.height != height || block.hash.len() != 32 || hex::encode(reversed_hash) != tree.hash {
        return Err("anchor_block_identity");
    }
    if block.chain_metadata.as_ref().is_none_or(|m| m.ironwood_commitment_tree_size == 0) {
        return Err("compact_ironwood_metadata");
    }
    Ok(serde_json::json!({
        "height": info.block_height,
        "anchor_height": height,
        "tls_verified": true,
        "mainnet_identity_passed": true,
        "sdk_tree_decode_passed": true,
        "compact_block_decode_passed": true,
        "ironwood_metadata_passed": true
    }))
}

#[tokio::main]
async fn main() {
    // Both endpoints occur in the ZODL Android reference wallet's source list.
    // No fallback to the hosted JSON-RPC relay or a local signing wallet.
    let endpoints = [
        ("zodl_primary", "https://zec.rocks:443"),
        ("zodl_secondary", "https://eu.zec.stardust.rest:443"),
    ];
    let mut passed = 0;
    for (label, endpoint) in endpoints {
        let mut output = serde_json::json!({
            "read_only": true,
            "endpoint_label": label,
            "wallet_created": false,
            "real_key_imported": false,
            "wallet_sync_verified": false,
            "sends_requested": 0
        });
        match tokio::time::timeout(Duration::from_secs(75), probe(endpoint)).await {
            Ok(Ok(evidence)) => {
                output["passed"] = true.into();
                output["evidence"] = evidence;
                passed += 1;
            }
            Ok(Err(stage)) => {
                output["passed"] = false.into();
                output["failed_stage"] = stage.into();
            }
            Err(_) => {
                output["passed"] = false.into();
                output["failed_stage"] = "overall_timeout".into();
            }
        }
        println!("{output}");
    }
    if passed == 0 {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use zcash_keys::keys::{UnifiedFullViewingKey, UnifiedSpendingKey};
    use zcash_protocol::consensus::{MAIN_NETWORK, TEST_NETWORK};

    #[test]
    fn viewing_key_decode_requires_full_key_and_matching_network() {
        // Public deterministic test material, never used as a wallet or funded.
        let full = UnifiedSpendingKey::from_seed(&MAIN_NETWORK, &[7; 32], zip32::AccountId::ZERO)
            .unwrap()
            .to_unified_full_viewing_key();
        let encoded = full.encode(&MAIN_NETWORK);
        let decoded = UnifiedFullViewingKey::decode(&MAIN_NETWORK, &encoded).unwrap();
        assert!(decoded.orchard().is_some());
        assert!(UnifiedFullViewingKey::decode(&TEST_NETWORK, &encoded).is_err());
        assert!(UnifiedFullViewingKey::decode(
            &MAIN_NETWORK,
            &full.to_unified_incoming_viewing_key().encode(&MAIN_NETWORK)
        ).is_err());
    }
}
