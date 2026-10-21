use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use vaults_installer::Result;

pub fn parse_id(value: &str) -> std::result::Result<String, String> {
    let value = value.trim();
    if value.len() == 32 && value.bytes().all(|b| (b'a'..=b'p').contains(&b)) {
        Ok(value.to_owned())
    } else {
        Err("Copy the extension ID: exactly 32 lowercase letters a–p".into())
    }
}

fn parse_ids(value: &str) -> std::result::Result<Vec<String>, String> {
    value.split(',').map(parse_id).collect()
}

fn discover_host(candidates: &[PathBuf]) -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "127vaults-extension-host.exe"
    } else {
        "127vaults-extension-host"
    };
    for directory in candidates {
        if let Ok(found) = crate::archive::find(directory, name) {
            return Some(found.join(name));
        }
    }
    #[cfg(windows)]
    {
        // Desktop's receipt points to its setup package; NSIS owns the actual path.
        let output = Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command",
            "$p=(Get-Item 'HKCU:\\Software\\127Vaults\\127Vaults Desktop' -ErrorAction SilentlyContinue).GetValue(''); if($p){Write-Output (Join-Path $p '127vaults-extension-host.exe')}"]).output().ok()?;
        let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
        if path.is_file() {
            return Some(path);
        }
    }
    #[cfg(not(windows))]
    for path in [
        "/usr/bin/127vaults-extension-host",
        "/usr/local/bin/127vaults-extension-host",
    ] {
        if Path::new(path).is_file() {
            return Some(PathBuf::from(path));
        }
    }
    None
}

fn windows_registration_script() -> String {
    format!(
        "param([string]$IdsCsv,[string]$HostPath)\n& {{\n{}\n}} -ExtensionIds ($IdsCsv.Split(',')) -HostBinary $HostPath -Browser Both\nif(!$?){{throw 'Connector registration failed'}}\nforeach($browser in @('Microsoft\\Edge','Google\\Chrome')){{\n$key='HKCU:\\Software\\'+$browser+'\\NativeMessagingHosts\\com.127vaults.connector'\n$p=(Get-Item -LiteralPath $key -ErrorAction Stop).GetValue('')\n$m=Get-Content -LiteralPath $p -Raw | ConvertFrom-Json\nif($m.path -ne $HostPath){{throw 'Connector registration path mismatch'}}\nforeach($id in $IdsCsv.Split(',')){{if($m.allowed_origins -notcontains ('chrome-extension://'+$id+'/')){{throw 'Extension ID registration mismatch'}}}}\n}}\n",
        include_str!("../../extension/install-native-host.ps1")
    )
}

fn ps_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn register_windows_outside_caller(
    script: &Path,
    ids: &[String],
    host: &Path,
    root: &Path,
) -> Result<()> {
    let result = root.join(format!("connector-result-{}.json", uuid::Uuid::new_v4()));
    let result_literal = ps_literal(&result.to_string_lossy());
    let work = format!(
        r#"$ErrorActionPreference='Stop'
try {{
& {} -IdsCsv {} -HostPath {}
if(!$?){{throw 'Connector registration failed'}}
$resultJson='{{"ok":true}}'
}} catch {{
$resultJson=(@{{ok=$false;error=$_.Exception.Message}} | ConvertTo-Json)
}}
$resultPath={}
[IO.File]::WriteAllText(($resultPath+'.tmp'), $resultJson)
[IO.File]::Move(($resultPath+'.tmp'), $resultPath)"#,
        ps_literal(&script.to_string_lossy()),
        ps_literal(&ids.join(",")),
        ps_literal(&host.to_string_lossy()),
        result_literal
    );
    // WMI starts the registration outside a packaged caller's inherited registry view.
    let launch = format!(
        r"$ErrorActionPreference='Stop'
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes({}))
$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{{CommandLine=('powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand '+$encoded)}}
if($r.ReturnValue -ne 0){{throw 'Cannot start Windows connector registration'}}
$deadline=[DateTime]::UtcNow.AddSeconds(30)
while(!(Test-Path -LiteralPath {})){{if([DateTime]::UtcNow -gt $deadline){{throw 'Connector registration timed out'}};Start-Sleep -Milliseconds 100}}
",
        ps_literal(&work),
        result_literal
    );
    let status = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command"])
        .arg(launch)
        .status()?;
    if !status.success() {
        return Err("Windows connector setup failed; rerun from a normal Windows terminal".into());
    }
    let value: serde_json::Value = serde_json::from_slice(&fs::read(&result)?)?;
    fs::remove_file(result)?;
    if value["ok"] != true {
        return Err(format!(
            "Connector registration failed: {}",
            value["error"].as_str().unwrap_or("unknown error")
        )
        .into());
    }
    Ok(())
}

pub fn setup(
    root: &Path,
    directory: &Path,
    supplied_ids: &[String],
    supplied_host: Option<&Path>,
    candidates: &[PathBuf],
    interactive: bool,
) -> Result<()> {
    cliclack::note(
        "Connect your browser extension",
        format!(
            "Open edge://extensions or chrome://extensions. Enable Developer mode, choose Load unpacked, and select {}. Copy the ID shown under 127Vaults. For both browsers, provide both IDs separated by commas.",
            directory.display()
        ),
    )?;
    let ids = if supplied_ids.is_empty() {
        if !interactive {
            return Err("Extension files are installed, but connector setup is unfinished. Rerun interactively or provide --extension-ids ID (and --extension-host PATH if needed)".into());
        }
        let input: String = cliclack::input("Extension ID shown in your browser")
            .validate(|value: &String| parse_ids(value).map(|_| ()))
            .interact()?;
        parse_ids(&input)?
    } else {
        supplied_ids
            .iter()
            .map(|id| parse_id(id))
            .collect::<std::result::Result<Vec<_>, _>>()?
    };
    let host = supplied_host
        .map(Path::to_owned)
        .or_else(|| discover_host(candidates));
    let host = match host {
        Some(path) => path,
        None if interactive => {
            let value: String = cliclack::input("Path to the installed 127vaults-extension-host executable (install Desktop or CLI first)").interact()?;
            PathBuf::from(value.trim())
        }
        None => {
            return Err(
                "Install Desktop or CLI, or provide --extension-host PATH to its native connector"
                    .into(),
            );
        }
    };
    if !host.is_file() {
        return Err("Native connector executable does not exist".into());
    }
    let host = fs::canonicalize(host)?;
    #[cfg(windows)]
    let host = PathBuf::from(
        host.to_string_lossy()
            .strip_prefix(r"\\?\")
            .unwrap_or(&host.to_string_lossy()),
    );
    if cfg!(windows) {
        let script = root.join("setup-extension-connector.ps1");
        fs::write(&script, windows_registration_script())?;
        register_windows_outside_caller(&script, &ids, &host, root)?;
    } else {
        let script = root.join("setup-extension-connector.sh");
        fs::write(
            &script,
            include_str!("../../extension/install-native-host.sh"),
        )?;
        crate::prerequisites::run(Command::new("bash").arg(script).arg(&host).args(&ids))?;
    }
    cliclack::log::success("Extension IDs registered with the local connector")?;
    if interactive && !cliclack::confirm("Unlock Desktop or CLI, reopen the browser popup, and check that it detects your client. Is it connected?").interact()? {
        return Err("Extension setup is unfinished. Correct the connection and rerun the installer; installed files are preserved".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn windows_registration_launcher_handles_paths_and_reports_failure() {
        let directory =
            std::env::temp_dir().join(format!("vaults setup's {}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let script = directory.join("fixture.ps1");
        let marker = directory.join("marker.txt");
        fs::write(
            &script,
            "param([string]$IdsCsv,[string]$HostPath)\n[IO.File]::WriteAllText($HostPath,$IdsCsv)",
        )
        .unwrap();
        let ids = vec!["eopolmaibhpjknmjddngfkkebejnmboo".to_owned()];
        let success = register_windows_outside_caller(&script, &ids, &marker, &directory);
        let received = fs::read_to_string(&marker);
        fs::write(&script, "throw 'deliberate fixture failure'").unwrap();
        let failure = register_windows_outside_caller(&script, &ids, &marker, &directory);
        fs::remove_dir_all(directory).unwrap();
        assert!(success.is_ok(), "{success:?}");
        assert_eq!(received.unwrap(), ids[0]);
        assert!(
            failure
                .unwrap_err()
                .to_string()
                .contains("deliberate fixture failure")
        );
    }

    #[cfg(windows)]
    #[test]
    fn registers_and_verifies_ids_in_isolated_registry_keys() {
        let id = uuid::Uuid::new_v4().simple().to_string();
        let directory = std::env::temp_dir().join(format!("vaults-extension-test-{id}"));
        fs::create_dir(&directory).unwrap();
        let host = directory.join("127vaults-extension-host.exe");
        fs::write(&host, b"registration fixture; never executed").unwrap();
        let key = format!(r"HKCU:\Software\127Vaults\InstallerTests\{id}");
        let script = directory.join("register.ps1");
        // Run the real registration/verification logic without touching browser keys.
        fs::write(
            &script,
            windows_registration_script().replace(r"HKCU:\Software\", &format!("{key}\\")),
        )
        .unwrap();
        let status = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&script)
            .arg("-IdsCsv")
            .arg("eopolmaibhpjknmjddngfkkebejnmboo,pbikmbchaligkhgjodbeomhfmkpooald")
            .arg("-HostPath")
            .arg(&host)
            .status()
            .unwrap();
        let manifest = fs::read(directory.join("com.127vaults.connector.json"));
        let cleanup = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command"])
            .arg(format!("Remove-Item -LiteralPath '{key}' -Recurse -Force"))
            .status()
            .unwrap();
        fs::remove_dir_all(directory).unwrap();
        assert!(status.success());
        assert!(cleanup.success());
        let manifest: serde_json::Value = serde_json::from_slice(&manifest.unwrap()).unwrap();
        assert_eq!(manifest["allowed_origins"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn validates_browser_ids_without_accepting_urls_or_script_arguments() {
        assert_eq!(
            parse_ids(" eopolmaibhpjknmjddngfkkebejnmboo,pbikmbchaligkhgjodbeomhfmkpooald ")
                .unwrap()
                .len(),
            2
        );
        for input in [
            "",
            "abc",
            "Eopolmaibhpjknmjddngfkkebejnmboo",
            "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
            "chrome-extension://eopolmaibhpjknmjddngfkkebejnmboo/",
            "a; whoami",
            "eopolmaibhpjknmjddngfkkebejnmboo,",
        ] {
            assert!(parse_ids(input).is_err(), "{input}");
        }
    }
}
