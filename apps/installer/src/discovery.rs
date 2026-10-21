//! Read-only discovery. Never infer ownership from a port or replace server keys.
use serde_json::Value;
use std::{
    fs,
    io::{self, Read},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    time::{Duration, Instant},
};
use vaults_installer::Result;

trait BoundedOutput {
    fn bounded_output(&mut self) -> io::Result<Output>;
}
impl BoundedOutput for Command {
    fn bounded_output(&mut self) -> io::Result<Output> {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(0x0800_0000);
        }
        let mut child = self
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let pipe = child
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("Missing discovery pipe"))?;
        let reader = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            pipe.take(1_048_577).read_to_end(&mut bytes)?;
            Ok::<_, io::Error>(bytes)
        });
        let start = Instant::now();
        loop {
            if let Some(status) = child.try_wait()? {
                let stdout = reader
                    .join()
                    .map_err(|_| io::Error::other("Discovery reader failed"))??;
                if stdout.len() > 1_048_576 {
                    return Err(io::Error::other("Discovery output too large"));
                }
                return Ok(Output {
                    status,
                    stdout,
                    stderr: Vec::new(),
                });
            }
            if start.elapsed() > Duration::from_secs(15) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "Server discovery timed out",
                ));
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
pub struct Server {
    pub directory: PathBuf,
    pub engine: String,
    pub project: String,
}

pub fn project(directory: &Path) -> Result<String> {
    let config = fs::read_to_string(directory.join(".env"))?;
    let values: Vec<_> = config
        .lines()
        .filter_map(|line| line.strip_prefix("VAULTS_PROJECT="))
        .collect();
    if values.len() != 1
        || !values[0].starts_with("vaults-test-")
        || values[0].len() != 24
        || !values[0][12..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Invalid existing server project; preserve its configuration".into());
    }
    Ok(values[0].into())
}

pub fn candidate(value: &Value, engine: &str) -> Result<Server> {
    let labels = &value["Config"]["Labels"];
    let directory = labels["com.docker.compose.project.working_dir"]
        .as_str()
        .ok_or("Running server has no bundle directory; use --from with its initialized bundle")?;
    let directory = fs::canonicalize(directory)?;
    let configured = project(&directory)?;
    if labels["com.docker.compose.service"] != "server"
        || labels["com.docker.compose.project"] != configured
        || !directory.join("install.mjs").is_file()
    {
        return Err(
            "Running server and bundle configuration differ; recover them before installing".into(),
        );
    }
    Ok(Server {
        directory,
        engine: engine.into(),
        project: configured,
    })
}

pub fn discover(selected_engine: Option<&str>) -> Result<Vec<Server>> {
    let mut servers = Vec::new();
    for engine in ["podman", "docker"] {
        if selected_engine.is_some_and(|selected| selected != engine) {
            continue;
        }
        let Ok(output) = Command::new(engine)
            .args([
                "ps",
                "--filter",
                "label=com.docker.compose.service=relay",
                "--format",
                "{{.ID}}",
            ])
            .bounded_output()
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        for id in String::from_utf8(output.stdout)?.split_whitespace() {
            let output = Command::new(engine)
                .args(["inspect", id])
                .bounded_output()?;
            if !output.status.success() {
                return Err("Cannot inspect existing server publication".into());
            }
            let relay: Vec<Value> = serde_json::from_slice(&output.stdout)?;
            let relay = relay.first().ok_or("Missing relay inspection")?;
            // Discover published installations, excluding isolated release rehearsals.
            let published = relay["NetworkSettings"]["Ports"]
                .as_object()
                .is_some_and(|ports| {
                    ports.values().any(|bindings| {
                        bindings.as_array().is_some_and(|bindings| {
                            bindings.iter().any(|b| b["HostPort"] == "12780")
                        })
                    })
                });
            if !published {
                continue;
            }
            let Some(project) = relay["Config"]["Labels"]["com.docker.compose.project"].as_str()
            else {
                continue;
            };
            let output = Command::new(engine)
                .args([
                    "ps",
                    "--filter",
                    &format!("label=com.docker.compose.project={project}"),
                    "--filter",
                    "label=com.docker.compose.service=server",
                    "--format",
                    "{{.ID}}",
                ])
                .bounded_output()?;
            if !output.status.success() {
                return Err("Cannot identify published server".into());
            }
            let ids = String::from_utf8(output.stdout)?;
            let ids: Vec<_> = ids.split_whitespace().collect();
            if ids.len() != 1 {
                return Err("Published installation needs exactly one running server; recover it before installing".into());
            }
            let output = Command::new(engine)
                .args(["inspect", ids[0]])
                .bounded_output()?;
            if !output.status.success() {
                return Err("Cannot inspect published server".into());
            }
            let values: Vec<Value> = serde_json::from_slice(&output.stdout)?;
            let server = candidate(values.first().ok_or("Missing server inspection")?, engine)?;
            if !servers
                .iter()
                .any(|s: &Server| s.directory == server.directory && s.project == server.project)
            {
                servers.push(server);
            }
        }
    }
    Ok(servers)
}

pub fn check_fresh_port(endpoint: Option<&str>, tailscale: bool) -> Result<()> {
    let host = if tailscale || endpoint == Some("localhost") {
        "127.0.0.1"
    } else {
        endpoint.unwrap_or("127.0.0.1")
    };
    TcpListener::bind((host, 12780)).map_err(|_| format!("Cannot reserve {host}:12780. An existing server or another application may own it. Update/adopt the existing server with --from; no new identity or trial was created"))?;
    Ok(())
}

pub fn existing_license(directory: &Path, engine: &str) -> Result<Value> {
    if !["podman", "docker"].contains(&engine) {
        return Err("Select the existing server engine".into());
    }
    let project = project(directory)?;
    let output = Command::new(engine)
        .args([
            "ps",
            "--filter",
            &format!("label=com.docker.compose.project={project}"),
            "--filter",
            "label=com.docker.compose.service=server",
            "--format",
            "{{.ID}}",
        ])
        .bounded_output()?;
    if !output.status.success() {
        return Err("Cannot inspect the licensed server".into());
    }
    let ids = String::from_utf8(output.stdout)?;
    let ids: Vec<_> = ids.split_whitespace().collect();
    if ids.len() != 1 {
        return Err(
            "Keeping a license requires exactly one healthy running server for this installation"
                .into(),
        );
    }
    let output = Command::new(engine)
        .args([
            "exec",
            ids[0],
            "node",
            "apps/server/src/entry.mjs",
            "provision",
            "status",
        ])
        .bounded_output()?;
    if !output.status.success() {
        return Err("Cannot verify the existing server license".into());
    }
    let status: Value = serde_json::from_slice(&output.stdout)?;
    let config = fs::read_to_string(directory.join(".env"))?;
    let private = config
        .lines()
        .find_map(|line| line.strip_prefix("VAULTS_TLS_DIR="))
        .ok_or("Existing identity directory is missing")?;
    let identity = fs::read_to_string(Path::new(private).join("installation-id"))?;
    license_identity(&status, identity.trim())
}

pub fn license_identity(status: &Value, identity: &str) -> Result<Value> {
    let license = &status["license"];
    let plan = license["plan"].as_str().unwrap_or_default();
    if status["installationId"] != identity
        || license["mode"] != "active"
        || !["development", "personal", "commercial", "trial"].contains(&plan)
        || license["expiresAt"].as_str().is_none()
        || license["clockState"] == "rollback_detected"
    {
        return Err("The running server must report an active license bound to this installation. No license, trial or server state was changed".into());
    }
    Ok(
        serde_json::json!({"installationId":identity,"plan":plan,"expiresAt":license["expiresAt"],
        "maxActiveUsers":license["maxActiveUsers"]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserving_a_license_requires_active_matching_server_evidence() {
        let status = serde_json::json!({"installationId":"this-machine","license":{
            "mode":"active","plan":"development","expiresAt":"2027-10-20T00:00:00Z",
            "maxActiveUsers":5,"clockState":"trusted"}});
        assert_eq!(
            license_identity(&status, "this-machine").unwrap()["plan"],
            "development"
        );
        assert!(license_identity(&status, "another-machine").is_err());
        for mode in ["missing", "unavailable", "revoked", "locked", "read-only"] {
            let mut changed = status.clone();
            changed["license"]["mode"] = mode.into();
            assert!(license_identity(&changed, "this-machine").is_err());
        }
        let mut changed = status;
        changed["license"]["clockState"] = "rollback_detected".into();
        assert!(license_identity(&changed, "this-machine").is_err());
    }
    #[test]
    fn discovery_requires_matching_bundle_and_project() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        fs::write(
            root.join(".env"),
            "VAULTS_PROJECT=vaults-test-123456abcdef\n",
        )
        .unwrap();
        fs::write(root.join("install.mjs"), "").unwrap();
        let mut value = serde_json::json!({"Config":{"Labels":{
            "com.docker.compose.project.working_dir":root,
            "com.docker.compose.project":"vaults-test-123456abcdef",
            "com.docker.compose.service":"server"}}});
        assert_eq!(
            candidate(&value, "podman").unwrap().project,
            "vaults-test-123456abcdef"
        );
        value["Config"]["Labels"]["com.docker.compose.project"] = "vaults-test-ffffffffffff".into();
        assert!(candidate(&value, "podman").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
