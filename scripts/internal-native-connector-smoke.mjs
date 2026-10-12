import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, unlink, mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Browser/native API acceptance only. No popup/form automation or default vault reads.
if (process.platform !== 'win32') throw Error('This fixture currently supports Windows Edge.');
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--extension', '--host', '--profile', '--work', '--server-id'].includes(key) || !value || options[key]) throw Error('Supply --extension, --host, --profile, --work and --server-id.');
  options[key] = value;
}
for (const key of ['--extension', '--host', '--profile', '--work', '--server-id']) if (!options[key]) throw Error('All fixture arguments are required.');
const serverId = options['--server-id'];
assert.match(serverId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const profile = resolve(options['--profile']), extension = resolve(options['--extension']), work = resolve(options['--work']);
const device = await readFile(join(profile, 'device.conf'), 'utf8');
assert.ok(device.includes(`server_id=${serverId}\n`) && device.includes('username=owner_127\n'), 'Only the explicitly selected fictitious owner profile is accepted.');
const checkout = resolve(import.meta.dirname, '..'), rel = relative(checkout, work);
if (!rel || !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) throw Error('Fixture workspace must be outside the checkout.');
await mkdir(work); // Refuse reuse; every run preserves its own evidence.
const host = join(work, '127vaults-extension-host.exe'), manifest = join(work, 'com.127vaults.connector.json');
await copyFile(resolve(options['--host']), host);
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const pointer = join(homedir(), '.127vaults-active');
const key = 'HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.127vaults.connector';
const ps = source => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], {
  encoding: 'utf8', windowsHide: true, env: { ...process.env, VAULTS_FIXTURE_HOST_KEY: key, VAULTS_FIXTURE_HOST_MANIFEST: manifest },
}).trim();
const oldPointer = await readFile(pointer).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
const oldRegistry = JSON.parse(ps("$p=$env:VAULTS_FIXTURE_HOST_KEY; if(Test-Path -LiteralPath $p){$k=Get-Item -LiteralPath $p; @{present=$true;value=$k.GetValue('')}|ConvertTo-Json -Compress}else{@{present=$false;value=$null}|ConvertTo-Json -Compress}"));
await writeFile(join(work, 'prior-registration.json'), JSON.stringify(oldRegistry, null, 2) + '\n');
if (oldPointer !== null) await writeFile(join(work, 'prior-profile-pointer.txt'), oldPointer);
let context, native, registered = false, pointerChanged = false;
try {
  await writeFile(pointer, profile + '\n'); pointerChanged = true;
  context = await chromium.launchPersistentContext(join(work, 'browser'), {
    executablePath: process.env.VAULTS_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ignoreDefaultArgs: ['--disable-extensions'], headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  assert.match(id, /^[a-p]{32}$/);
  await writeFile(manifest, JSON.stringify({ name: 'com.127vaults.connector', description: 'Fictitious internal acceptance', path: host, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] }));
  registered = true; // Restore even if registry mutation reports an uncertain result.
  ps("$null=New-Item -Path $env:VAULTS_FIXTURE_HOST_KEY -Force; Set-Item -LiteralPath $env:VAULTS_FIXTURE_HOST_KEY -Value $env:VAULTS_FIXTURE_HOST_MANIFEST");
  native = request => worker.evaluate(request => new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative('com.127vaults.connector');
    const timer = setTimeout(() => { port.disconnect(); reject(Error('Native fixture timeout')); }, 10000);
    port.onMessage.addListener(response => { clearTimeout(timer); port.disconnect(); resolve(response); });
    port.onDisconnect.addListener(() => { clearTimeout(timer); if (chrome.runtime.lastError) reject(Error(chrome.runtime.lastError.message)); });
    port.postMessage({ id: 1, ...request });
  }), request);
  const sources = await native({ action: 'sources' }); assert.equal(sources.ok, true);
  assert.ok(sources.value.sources.some(row => row.id === 'cli' && row.active));
  const siteOrigin = 'https://offline-remote.invalid';
  const listed = await native({ action: 'list', source: 'cli', siteOrigin });
  assert.equal(listed.ok, true); assert.ok(listed.value.length > 0);
  const { vaultId, itemId, entryId } = listed.value[0];
  const selected = { source: 'cli', vaultId, itemId, entryId };
  const got = await native({ action: 'get', ...selected, siteOrigin });
  assert.equal(got.ok, true); assert.ok(got.value.password === 'api010-fiction-secret', 'Fictitious credential mismatch.');
  assert.equal((await native({ action: 'get', ...selected, siteOrigin: 'https://wrong-origin.invalid' })).ok, false);
  assert.equal((await native({ action: 'item-update', source: 'cli' })).ok, false);
  assert.equal((await native({ action: 'lock', source: 'cli' })).ok, true);
  assert.equal((await native({ action: 'get', ...selected, siteOrigin })).ok, false);
  await writeFile(join(work, 'evidence.json'), JSON.stringify({ id: randomUUID(), date: new Date().toISOString(), status: 'passed', scope: 'Installed Edge extension and packaged native-host API; fictitious profile only', checks: ['sources', 'list/get', 'wrong-origin refusal', 'generic-write refusal', 'lock clearing'], limitations: ['No visible popup/form-fill acceptance.', 'Offline status requires the operator to stop only the fixture server before running.'] }, null, 2) + '\n');
  console.log('Installed Edge/native-host fixture passed source/read/origin/write/lock checks.');
} finally {
  try {
    if (native) await native({ action: 'lock', source: 'cli' }).catch(() => {});
    if (context) await context.close();
  }
  finally {
    try {
      if (pointerChanged) { if (oldPointer === null) await unlink(pointer); else await writeFile(pointer, oldPointer); }
    } finally {
      if (registered) {
        if (oldRegistry.present) {
          if (oldRegistry.value === null) ps("$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.127vaults.connector',$true); try{$k.DeleteValue('', $false)}finally{$k.Dispose()}");
          else { process.env.VAULTS_FIXTURE_OLD_VALUE = oldRegistry.value; ps("Set-Item -LiteralPath $env:VAULTS_FIXTURE_HOST_KEY -Value $env:VAULTS_FIXTURE_OLD_VALUE"); }
        } else ps("Remove-Item -LiteralPath $env:VAULTS_FIXTURE_HOST_KEY -Force");
      }
    }
  }
  console.log('Original CLI pointer and native-host registration restored.');
}
