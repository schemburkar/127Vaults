//! Native tailnet discovery. Public addresses and offline peers are never offered.
use serde::Serialize;
use serde_json::Value;
use std::{
    io::Read,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[derive(Serialize)]
pub struct Peer {
    pub name: String,
    pub address: String,
}

fn peers_from_status(source: &[u8]) -> Result<Vec<Peer>, String> {
    let value: Value =
        serde_json::from_slice(source).map_err(|_| "Tailscale returned invalid status")?;
    if value["BackendState"] != "Running" {
        return Err("Sign in to Tailscale on this computer first".to_owned());
    }
    let nodes = std::iter::once(&value["Self"]).chain(
        value["Peer"]
            .as_object()
            .into_iter()
            .flat_map(|peers| peers.values()),
    );
    let mut result = Vec::new();
    for node in nodes {
        if node["Online"] != true {
            continue;
        }
        let Some(address) = node["TailscaleIPs"].as_array().and_then(|ips| {
            ips.iter().filter_map(Value::as_str).find(|ip| {
                ip.parse::<std::net::Ipv4Addr>().is_ok_and(|ip| {
                    let o = ip.octets();
                    o[0] == 100 && (64..=127).contains(&o[1])
                })
            })
        }) else {
            continue;
        };
        let name = node["DNSName"]
            .as_str()
            .filter(|name| !name.is_empty())
            .or_else(|| node["HostName"].as_str())
            .unwrap_or(address)
            .trim_end_matches('.');
        result.push(Peer {
            name: name.to_owned(),
            address: address.to_owned(),
        });
    }
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

/// Reads the signed-in native Tailscale client's current peer inventory.
///
/// # Errors
/// Refuses missing, offline, oversized or stalled native-client status.
pub fn discover() -> Result<Vec<Peer>, String> {
    let mut command = Command::new("tailscale");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if let Some(root) = std::env::var_os("ProgramFiles") {
            let program = std::path::PathBuf::from(root).join("Tailscale/tailscale.exe");
            if program.is_file() {
                command = Command::new(program);
            }
        }
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .args(["status", "--json"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Install and sign in to Tailscale first")?;
    let stdout = child.stdout.take().ok_or("Tailscale status unavailable")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(1_048_577)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Tailscale status timed out".to_owned());
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| "Tailscale status unavailable")?
        .map_err(|_| "Tailscale status unavailable")?;
    if !status.success() || bytes.len() > 1_048_576 {
        return Err("Tailscale status unavailable".to_owned());
    }
    peers_from_status(&bytes)
}

#[cfg(test)]
mod tests {
    #[test]
    fn filters_public_and_offline_nodes_and_keeps_exact_peer_addresses() {
        let peers=super::peers_from_status(br#"{"BackendState":"Running","Self":{"Online":true,"HostName":"local","TailscaleIPs":["100.65.72.10"]},"Peer":{"a":{"Online":true,"DNSName":"peer.example.ts.net.","TailscaleIPs":["100.64.0.10"]},"b":{"Online":true,"HostName":"public","TailscaleIPs":["8.8.8.8"]},"c":{"Online":false,"HostName":"offline","TailscaleIPs":["100.64.0.2"]}}}"#).unwrap();
        assert_eq!(peers.len(), 2);
        assert_eq!(peers[1].name, "peer.example.ts.net");
        assert_eq!(peers[1].address, "100.64.0.10");
        assert!(super::peers_from_status(br#"{"BackendState":"Stopped"}"#).is_err());
    }
}
