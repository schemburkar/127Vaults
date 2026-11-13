import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
test('PowerShell launcher validates all services and preserves launch commands without opening windows', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), '127vaults launcher '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root,'apps/cli/src'),{recursive:true});
  await mkdir(join(root,'apps/extension/src'),{recursive:true});
  await mkdir(join(root, 'packages/domain/src'), { recursive: true });
  for (const file of ['dev.ps1', 'apps/cli/src/namespace-contract.json', 'scripts/mvp-acceptance.mjs', 'scripts/mvp-startup.mjs', 'scripts/runtime-namespace.mjs', 'scripts/extension-assets.mjs', 'scripts/extension-dev.mjs', 'scripts/namespace.mjs', 'apps/extension/manifest.json', 'apps/extension/popup.html', 'apps/extension/src/background.mjs', 'packages/domain/src/passkey-metadata.mjs','packages/domain/src/connection-help.mjs']) {
    await copyFile(new URL(`../${file}`, import.meta.url), join(root, file));
  }
  const namespaceRoot=join(root,'127Vaults Namespaces/development');
  await mkdir(namespaceRoot,{recursive:true});await writeFile(join(namespaceRoot,'namespace-owner'),'development');
  for (const file of ['live/server.crt', 'live/server.key', 'ca/ca.crt']) {
    const path = join(namespaceRoot, 'server/identity', file);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, 'synthetic startup preflight file');
  }
  await writeFile(join(namespaceRoot,'server.env'), `VAULTS_TLS_DIR=${join(namespaceRoot,'server/identity')}\n`);
  await writeFile(join(root, 'probe.ps1'), `
$ErrorActionPreference = 'Stop'
$calls = [Collections.Generic.List[object]]::new()
function Start-Process { param($FilePath, $WorkingDirectory, $ArgumentList, $WindowStyle, $RedirectStandardOutput, $RedirectStandardError) $calls.Add(@{ executable=$FilePath; cwd=$WorkingDirectory; args=$ArgumentList; style=$WindowStyle; log=$RedirectStandardOutput }) }
& (Join-Path $PSScriptRoot 'dev.ps1') -Check
if ($calls.Count -ne 0) { throw 'Check opened windows' }
& (Join-Path $PSScriptRoot 'dev.ps1')
$calls | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $PSScriptRoot 'calls.json')
`);
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'probe.ps1')], { windowsHide: true,timeout:15000,env:{...process.env,APPDATA:root,XDG_CONFIG_HOME:root,VAULTS_NAMESPACE:'development',VAULTS_MVP_ENV_FILE:join(namespaceRoot,'server.env'),VAULTS_CONFIG_DIR:join(root,'client-profile')} });
  const calls = JSON.parse(await readFile(join(root, 'calls.json'), 'utf8'));
  assert.equal(calls.length, 2);
  for (const call of calls) { assert.equal(call.cwd, root); assert.equal(call.executable, 'powershell.exe');assert.equal(call.style,'Hidden');assert.ok(call.log.startsWith(root)); }
  assert.deepEqual(calls.map(call => call.args.at(-1)), ['pnpm mvp:dev', 'pnpm --filter @127vaults/desktop dev']);
  assert.equal(await readFile(join(namespaceRoot, 'extension/src/shared/passkey-metadata.mjs'), 'utf8'), await readFile(new URL('../packages/domain/src/passkey-metadata.mjs', import.meta.url), 'utf8'));
  await run('powershell.exe', ['-NoProfile', '-File', join(root, 'dev.ps1'), 'extension', '-Check'], { windowsHide: true });
  await assert.rejects(run('powershell.exe', ['-NoProfile', '-File', join(root, 'dev.ps1'), 'web'], { windowsHide: true }));
});
