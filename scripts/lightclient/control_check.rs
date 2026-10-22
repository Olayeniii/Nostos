//! Private standalone read-only control helper. Never signs or broadcasts.
#[path = "nostos_observer/mod.rs"] mod observer;
#[path = "nostos_wallet_check.rs"] mod wallet_check;
use std::{io::{self,Read},path::PathBuf,time::Duration};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use hmac::{Hmac,Mac};
use tonic::transport::{ClientTlsConfig,Endpoint};
use zcash_address::unified::{self,Container,Encoding};
use zcash_protocol::consensus::{Parameters,MAIN_NETWORK};

fn hex32(value:&Value)->Result<[u8;32],&'static str> {
    let text=value.as_str().ok_or("hex_format")?;
    if text.len()!=64 || !text.bytes().all(|c|c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) {return Err("hex_format");}
    hex::decode(text).map_err(|_| "hex_format")?.try_into().map_err(|_| "hex_length")
}
fn text<'a>(body:&'a Value,key:&str)->Result<&'a str,&'static str> {
    body[key].as_str().filter(|s|s.len()<=3000).ok_or("private_input")
}
fn shape(value:&Value,keys:&[&str])->Result<(),&'static str> {
    let map=value.as_object().ok_or("input_object")?;
    if map.len()!=keys.len() || keys.iter().any(|k|!map.contains_key(*k)) {return Err("input_fields");} Ok(())
}
fn request(input:&str)->Result<(Value,String,[u8;32],String),&'static str> {
    let envelope:Value=serde_json::from_str(input).map_err(|_| "input_format")?;
    shape(&envelope,&["body","sessionKey","nonce"])?;
    let key=hex32(&envelope["sessionKey"])?;
    hex32(&envelope["nonce"])?;
    let raw=envelope["body"].as_str().filter(|s|s.len()<=16_384).ok_or("body_format")?;
    let body:Value=serde_json::from_str(raw).map_err(|_| "body_format")?;
    let fields=match body["mode"].as_str() {
        Some("prepare")=>vec!["mode","senderUfvk","senderAddress","receiverUfvk","receiverAddress","birthday","reference","bindingKey"],
        Some("verify")=>vec!["mode","receiver","reference","txid","maxFeeZat","maxDebitZat","minConfirmations","bindingKey"],
        Some("preflight")=>vec!["mode","receiver","reference","bindingKey"],
        _=>return Err("mode_not_allowed"),
    };
    shape(&body,&fields)?;hex32(&body["bindingKey"])?;
    Ok((body,hex::encode(Sha256::digest(raw.as_bytes())),key,envelope["nonce"].as_str().unwrap().to_owned()))
}
async fn run()->Result<String,&'static str> {
    let args:Vec<_>=std::env::args_os().collect();if args.len()!=2 {return Err("arguments");}
    let mut input=String::new();io::stdin().take(20_001).read_to_string(&mut input).map_err(|_| "input")?;
    if input.len()>20_000 {return Err("input_limit");}
    let (body,request_digest,session_key,nonce)=request(&input)?;
    let root=PathBuf::from(&args[1]);
    let binding=hex32(&body["bindingKey"])?;
    let mode=text(&body,"mode")?;
    let receiver=if mode=="prepare" {
        wallet_check::check(text(&body,"senderUfvk")?,text(&body,"senderAddress")?).map_err(|_| "sender_binding")?;
        wallet_check::check(text(&body,"receiverUfvk")?,text(&body,"receiverAddress")?).map_err(|_| "recipient_binding")?;
        let (network,ua)=unified::Address::decode(text(&body,"receiverAddress")?).map_err(|_| "recipient_address")?;
        let raw=ua.items().iter().find_map(|r|match r {unified::Receiver::Orchard(b)=>Some(*b),_=>None}).ok_or("recipient_address")?;
        unified::Address::try_from_items(vec![unified::Receiver::Orchard(raw)]).map_err(|_| "recipient_address")?.encode(&network)
    } else {
        if !root.join("wallet.sqlite").is_file() {return Err("prepared_wallet_required");}
        text(&body,"receiver")?.to_owned()
    };
    observer::transactions::OrchardReceiver::parse_mainnet(&receiver)?;
    let reference=text(&body,"reference")?;
    if reference.len()!=32 || !reference.bytes().all(|c|c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) {return Err("reference");}
    let wallet=observer::storage::ProtectedWallet::open(&root)?;
    let endpoint=Endpoint::from_static("https://zec.rocks:443").connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30)).tls_config(ClientTlsConfig::new().with_webpki_roots()).map_err(|_| "tls")?;
    let channel=endpoint.connect().await.map_err(|_| "provider")?;
    let mut connection=observer::connection::Connection::new(wallet,observer::transactions::client(channel));
    let result=if mode=="prepare" {
        let birthday=body["birthday"].as_u64().and_then(|n|u32::try_from(n).ok()).filter(|n|*n>0).ok_or("birthday")?;
        connection.control_prepare(text(&body,"senderUfvk")?,birthday,&receiver,reference,&binding).await?
    } else if mode=="preflight" {
        connection.control_preflight(&receiver,reference,&binding).await?
    } else {
        let txid=text(&body,"txid")?.parse().map_err(|_| "txid")?;
        let fee=body["maxFeeZat"].as_u64().ok_or("fee")?;
        let debit=body["maxDebitZat"].as_u64().ok_or("debit")?;
        let confirmations=body["minConfirmations"].as_u64().and_then(|n|u32::try_from(n).ok()).ok_or("confirmations")?;
        connection.control_verify(&receiver,reference,&binding,txid,fee,debit,confirmations).await?
    };
    observer::storage::ProtectedWallet::audit(&root)?;
    let payload=serde_json::to_string(&json!({"nonce":nonce,"requestDigest":request_digest,"mode":mode,"result":result})).map_err(|_| "output")?;
    let mut mac=Hmac::<Sha256>::new_from_slice(&session_key).map_err(|_| "output")?;
    mac.update(payload.as_bytes());
    serde_json::to_string(&json!({"payload":payload,"mac":hex::encode(mac.finalize().into_bytes())})).map_err(|_| "output")
}
#[tokio::main]
async fn main() {
    std::panic::set_hook(Box::new(|_| {}));
    if rustls::crypto::ring::default_provider().install_default().is_err() {std::process::exit(1);}
    match run().await {Ok(report)=>println!("{report}"),Err(_)=>std::process::exit(1)}
}
#[cfg(test)]
fn fixture_key(seed:u8)->Result<zcash_keys::keys::UnifiedFullViewingKey,&'static str> {
    let key=zcash_keys::keys::UnifiedSpendingKey::from_seed(&MAIN_NETWORK,&[seed;32],zip32::AccountId::ZERO)
        .map_err(|_| "fixture_key")?.to_unified_full_viewing_key();
    observer::connection::scoped_key(&key.encode(&MAIN_NETWORK))
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn private_envelope_rejects_send_unknown_fields_and_bad_secrets() {
        for value in [json!({"body":"{}","sessionKey":"invalid","nonce":"invalid"}),
            json!({"body":"{\"mode\":\"send\"}","sessionKey":"0".repeat(64),"nonce":"0".repeat(64)}),
            json!({"body":"{}","sessionKey":"0".repeat(64),"nonce":"0".repeat(64),"extra":"private"})] {
            assert!(request(&value.to_string()).is_err());
        }
    }
    #[test] fn request_digest_binds_exact_private_body() {
        let body=json!({"mode":"verify","receiver":"private","reference":"a".repeat(32),"txid":"1".repeat(64),
            "maxFeeZat":10_000,"maxDebitZat":20_000,"minConfirmations":3,"bindingKey":"2".repeat(64)}).to_string();
        let input=json!({"body":body,"sessionKey":"3".repeat(64),"nonce":"4".repeat(64)}).to_string();
        let (_,digest,_,_)=request(&input).unwrap();assert_eq!(digest,hex::encode(Sha256::digest(body.as_bytes())));
    }
}
