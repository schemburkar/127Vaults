// Real packaged clients in a separately provisioned Omarchy WSL adaptation.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { verifyRelease } from '../../../scripts/release/verify-release.mjs';
import { openDesktopFixtureInspector } from '../support/desktop-fixture-inspector.mjs';

const execute = promisify(execFile);
const [desktopArg, cliArg, installerArg, workArg, distro = 'Vaults-Omarchy-Test'] = process.argv.slice(2);
assert.ok(desktopArg && cliArg && installerArg && workArg, 'Supply desktop, CLI, installer release directories and a new external evidence directory');
assert.match(distro, /^Vaults-Omarchy-[A-Za-z0-9-]+$/);
const work = resolve(workArg), repo = resolve(import.meta.dirname, '../../..');
const rel = relative(repo, work);
assert.ok(rel && (isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')), 'Evidence must be outside the checkout');
await mkdir(work); // Fresh evidence only; do not overwrite an earlier run.
const releases = [];
for (const [product, directory] of [['desktop', desktopArg], ['cli', cliArg], ['installer', installerArg]]) {
  const manifest = await verifyRelease(resolve(directory));
  assert.equal(manifest.platform, 'linux'); assert.equal(manifest.product, product);
  releases.push(manifest);
}
async function wsl(user, args, timeout = 120000) {
  return execute('wsl.exe', ['-d', distro, '-u', user, '--exec', ...args], { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}
const linuxPath = async path => (await wsl('root', ['wslpath', '-a', resolve(path).replaceAll('\\', '/')])).stdout.trim();
const environment = await wsl('omarchy', ['bash', '-c', 'set -eu; cat /etc/os-release; cat /etc/omarchy.conf; git -c safe.directory=/usr/share/omarchy -C /usr/share/omarchy rev-parse HEAD; uname -r; test -S /mnt/wslg/runtime-dir/wayland-0']);
assert.match(environment.stdout, /OMARCHY_WSL2="true"/);
await writeFile(join(work, 'environment.log'), environment.stdout + environment.stderr);
// Mesa supplies the WSLg D3D12 graphics driver absent from the headless profile.
const packages = await wsl('root', ['pacman', '-Syu', '--needed', '--noconfirm', 'webkit2gtk-4.1', 'libsecret', 'fuse2', 'xdg-utils', 'gnome-keyring', 'python', 'mesa'], 600000);
await writeFile(join(work, 'runtime-packages.log'), packages.stdout + packages.stderr);
const fixture = `/home/omarchy/vaults-smoke-${randomUUID()}`;
const app = releases[0].files.find(file => file.name.endsWith('.AppImage'));
const cli = releases[1].files.find(file => file.name.endsWith('.tar.gz'));
const installer = releases[2].files.find(file => file.name.endsWith('.tar.gz'));
assert.ok(app && cli && installer);
const paths = await Promise.all([
  linuxPath(join(desktopArg, app.name)), linuxPath(join(cliArg, cli.name)), linuxPath(join(installerArg, installer.name)),
]);
const script = `#!/bin/bash
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin
fixture=$1
mode=$2
shift 2
if [[ $mode == prepare ]]; then
  mkdir -m 700 "$fixture"
  mkdir "$fixture/cli" "$fixture/installer"
  cp "$1" "$fixture/desktop.AppImage"
  chmod 700 "$fixture/desktop.AppImage"
  tar -xzf "$2" -C "$fixture/cli"
  tar -xzf "$3" -C "$fixture/installer"
  cli_binary=$(find "$fixture/cli" -name 127vaults -type f)
  installer_binary=$(find "$fixture/installer" -name 127vaults-install -type f)
  "$cli_binary" --version
  "$installer_binary" --version
  python - "$fixture" <<'PY'
import json,struct,subprocess,sys,pathlib
host=next(pathlib.Path(sys.argv[1]).joinpath('cli').rglob('127vaults-extension-host'))
payload=json.dumps({'id':1,'action':'sources'}).encode()
reply=subprocess.run([str(host)],input=struct.pack('<I',len(payload))+payload,capture_output=True,check=True).stdout
assert struct.unpack('<I',reply[:4])[0]==len(reply)-4
value=json.loads(reply[4:]);assert value['ok'] and value['id']==1 and value['value']['version']==1
assert not any(row.get('active') for row in value['value']['sources'])
print('Native host framing and empty-source discovery passed')
PY
  exit
fi
export HOME="$fixture/home"
export XDG_CONFIG_HOME="$HOME/config" XDG_DATA_HOME="$HOME/data" XDG_CACHE_HOME="$HOME/cache"
export VAULTS_CONFIG_DIR="$HOME/profile"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$VAULTS_CONFIG_DIR"
if [[ $mode == keyring ]]; then
  printf 'fixture-password' | gnome-keyring-daemon --unlock --components=secrets
  printf 'fixture-value' | secret-tool store --label=127Vaults-WSL-fixture application 127vaults-wsl-fixture
  test "$(secret-tool lookup application 127vaults-wsl-fixture)" = fixture-value
  secret-tool clear application 127vaults-wsl-fixture
  echo 'Secret Service store, lookup and delete passed (disposable profile)'
  exit
fi
export WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:12941
export WAYLAND_DISPLAY=wayland-0
export XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir
if [[ $mode == extract ]]; then export APPIMAGE_EXTRACT_AND_RUN=1; fi
"$fixture/desktop.AppImage" &
app_pid=$!
trap 'kill "$app_pid" 2>/dev/null || true; wait "$app_pid" 2>/dev/null || true' EXIT TERM INT
wait "$app_pid"
`;
await writeFile(join(work, 'guest.sh'), script);
const guestScript = await linuxPath(join(work, 'guest.sh'));
const prepared = await wsl('omarchy', ['bash', guestScript, fixture, 'prepare', ...paths]);
await writeFile(join(work, 'binaries.log'), prepared.stdout + prepared.stderr);
assert.match(prepared.stdout, /Native host framing/);
const keyring = await wsl('omarchy', ['dbus-run-session', '--', 'bash', guestScript, fixture, 'keyring']);
await writeFile(join(work, 'keyring.log'), keyring.stdout + keyring.stderr);
assert.match(keyring.stdout, /store, lookup and delete passed/);
const modes = [];
for (const mode of ['direct', 'extract']) {
  let output = '', inspector;
  const child = spawn('wsl.exe', ['-d', distro, '-u', 'omarchy', '--exec', 'dbus-run-session', '--', 'bash', guestScript, fixture, mode], { windowsHide: true });
  child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => output += bytes);
  try {
    inspector = await openDesktopFixtureInspector('http://127.0.0.1:12941', 'webkit');
    let body = '';
    for (let i = 0; i < 80; i++) {
      body = await inspector.evaluate('document.body.innerText');
      if (body.includes('Unlock 127Vaults')) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(body.includes('Unlock 127Vaults'), 'Packaged desktop unlock screen missing');
    await inspector.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(el=>el.textContent.includes('Register or create an account'));if(!button)throw Error('Setup button missing');button.click();})()`);
    for (let i = 0; i < 80; i++) {
      body = await inspector.evaluate('document.body.innerText');
      if (body.includes('Connect to your private server')) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(body.includes('Connect to your private server'));
    assert.equal(await inspector.evaluate(`document.querySelector('input[aria-label="Private server URL"]').value`), '');
    await writeFile(join(work, `${mode}-ui.txt`), body);
    modes.push(mode);
  } finally {
    if (inspector) {
      await inspector.evaluate("window.__TAURI_INTERNALS__.invoke('plugin:window|close')").catch(() => {});
      await inspector.close();
    }
    // Kill only the test AppImage at this run's unique fixture path.
    await wsl('omarchy', ['pkill', '-f', `^${fixture}/desktop.AppImage$`]).catch(() => {});
    child.kill();
    await writeFile(join(work, `${mode}.log`), output);
  }
}
await writeFile(join(work, 'evidence.json'), JSON.stringify({ date: new Date().toISOString(), distro, fixture, status: 'passed',
  releases: releases.map(({ product, packageVersion, sourceRevision }) => ({ product, packageVersion, sourceRevision })),
  checks: ['verified package checksums', 'CLI and installer startup', 'native host framing', 'Secret Service store/lookup/delete', ...modes.map(mode => `${mode} AppImage WSLg unlock and setup UI`)],
  limitations: ['Unofficial Omarchy WSL adaptation; no native Hyprland validation', 'No account enrollment, offline sync, or browser connector end-to-end test'],
}, null, 2) + '\n');
console.log(`Omarchy WSL package smoke passed. Evidence: ${work}`);
