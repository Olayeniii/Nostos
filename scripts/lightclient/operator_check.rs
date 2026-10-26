//! Private stdin only. Fixed boolean output, no key/address/error formatting.
#[path = "nostos_wallet_check.rs"]
mod wallet_check;
use std::io::{self, Read};

fn run() -> bool {
    if std::env::args_os().len() != 1 { return false; }
    let mut bytes = Vec::new();
    if io::stdin().take(8193).read_to_end(&mut bytes).is_err() || bytes.len() > 8192 {
        return false;
    }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return false; };
    let Some(object) = value.as_object() else { return false; };
    if object.len() != 2 { return false; }
    match (object.get("ufvk").and_then(|v| v.as_str()),
           object.get("address").and_then(|v| v.as_str())) {
        (Some(key), Some(address)) => wallet_check::check(key, address).is_ok(),
        _ => false,
    }
}
fn main() {
    std::panic::set_hook(Box::new(|_| {}));
    let passed = std::panic::catch_unwind(run).unwrap_or(false);
    println!("{}", serde_json::json!({"nostos_offline_binding_v1": true,
        "passed": passed, "offline": true, "key_imported": false,
        "spending_control_proven": false, "outgoing_recovery_proven": false}));
    if !passed { std::process::exit(1); }
}
