//! Pipe-only worker. Private values use stdin/stdout pipes, never argv or logs.
#[path = "nostos_observer/mod.rs"]
mod observer;
use std::{io::{BufRead,Write},path::PathBuf,time::Duration};
use serde_json::{json,Value};
use tonic::transport::{ClientTlsConfig,Endpoint};

async fn run() -> Result<(),&'static str> {
    let args:Vec<_>=std::env::args_os().collect();
    if args.len()!=2 {return Err("worker_arguments");}
    let root=PathBuf::from(&args[1]);
    let wallet=observer::storage::ProtectedWallet::open(&root)?;
    let endpoint=Endpoint::from_static("https://zec.rocks:443").connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30)).tls_config(ClientTlsConfig::new().with_webpki_roots()).map_err(|_| "tls_configuration")?;
    let channel=endpoint.connect().await.map_err(|_| "tls_connection")?;
    let mut connection=observer::connection::Connection::new(wallet,observer::transactions::client(channel));
    let stdin=std::io::stdin();let mut input=stdin.lock();let stdout=std::io::stdout();let mut output=stdout.lock();
    loop {
        let mut line=String::new();
        let mut bounded=std::io::Read::take(&mut input,16385);
        let read=bounded.read_line(&mut line).map_err(|_| "worker_input")?;
        if read==0 {break;}
        if read>16384 || !line.ends_with('\n') {return Err("worker_input_limit");}
        let request:Value=serde_json::from_str(&line).map_err(|_| "worker_input_format")?;
        let id=request.get("id").and_then(Value::as_u64).filter(|n|*n>0).ok_or("worker_request_id")?;
        let method=request.get("method").and_then(Value::as_str).ok_or("worker_method")?;
        let params=request.get("params").and_then(Value::as_array).ok_or("worker_params")?;
        let result=connection.handle(method,params).await;
        observer::storage::ProtectedWallet::audit(&root)?;
        let response=match result {
            Ok(value)=>json!({"id":id,"result":value}),
            Err(_)=>json!({"id":id,"error":{"code":-32000,"message":"Observer request is unresolved."}}),
        };
        serde_json::to_writer(&mut output,&response).map_err(|_| "worker_output")?;
        output.write_all(b"\n").map_err(|_| "worker_output")?;
        output.flush().map_err(|_| "worker_output")?;
    }
    Ok(())
}
#[tokio::main]
async fn main() {
    if rustls::crypto::ring::default_provider().install_default().is_err() || run().await.is_err() {
        // No panic, original error text, key, request or provider URL is printed.
        std::process::exit(1);
    }
}
