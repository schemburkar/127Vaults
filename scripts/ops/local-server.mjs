// Pinned local installation operations. Container recreation and volume deletion
// are intentionally outside this workflow; history must survive restarts.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { get } from 'node:https';
import { homedir } from 'node:os';
import { checkpointHash } from '../../packages/sync/src/index.mjs';

export function verifyReplicaHistory(replicas, operations, checkpoints) {
  const serverOperations = new Map(operations.map(row => [`${row.vaultId}:${row.cursor}`, row.opId]));
  const serverCheckpoints = new Set(checkpoints.map(row => `${row.vaultId}:${row.hash}`));
  let verifiedOperations = 0, pendingEdits = 0;
  for (const replica of replicas) {
    for (const row of replica.operations || []) {
      if (serverOperations.get(`${replica.vault_id}:${row.cursor}`) !== row.operation.opId) throw Error('Server history mismatch; local replica and pending edits preserved.');
      verifiedOperations++;
    }
    if (replica.checkpoint && !serverCheckpoints.has(`${replica.vault_id}:${checkpointHash(replica.checkpoint)}`)) throw Error('Server checkpoint history mismatch; local data preserved.');
    pendingEdits += replica.pending?.length || 0;
  }
  return { vaults: replicas.length, verifiedOperations, pendingEdits };
}

export function verifyPinnedMounts(actual, expected) {
  const signature = rows => JSON.stringify(rows.map(({ Source, Destination }) => [Source, Destination]).sort());
  if (!expected?.length || signature(actual) !== signature(expected)) throw Error('Pinned server storage changed. Refusing to use a different database or identity.');
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const action = process.argv[2];
  if (!['status', 'restart', 'restore'].includes(action)) throw Error('Use status, restart or restore.');
  const config = JSON.parse(await readFile(join(root, '.tools/local-server.json'), 'utf8'));
  const podman = process.platform === 'win32' ? join(process.env.ProgramFiles || 'C:/Program Files', 'RedHat/Podman/podman.exe') : 'podman';
  function run(args) {
    const result = spawnSync(podman, args, { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    if (result.status !== 0) throw Error(`Podman ${args[0]} failed; existing volumes were preserved.`);
    return result.stdout.trim();
  }
  for (const role of ['database', 'server', 'relay']) {
    const inspected = JSON.parse(run(['inspect', config[role]]))[0];
    verifyPinnedMounts(inspected.Mounts, config.mounts[role]);
  }
  if (action !== 'status') run(['start', config.database]);
  const databaseId = run(['exec', config.database, 'psql', '-U', 'vaults', '-d', 'vaults_experimental', '-At', '-c', 'SELECT id FROM vaults.installation']);
  if (databaseId !== config.installationId) throw Error('Pinned database installation does not match Desktop.');
  const profile = process.env.VAULTS_CONFIG_DIR || join(process.env.APPDATA || join(homedir(), '.config'), '127Vaults');
  const replicaDirectory = join(profile, 'replicas');
  const files = await readdir(replicaDirectory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const replicas = (await Promise.all(files.filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(replicaDirectory, name), 'utf8'))))).filter(replica => replica.tenant_id === databaseId);
  const query = sql => JSON.parse(run(['exec', config.database, 'psql', '-U', 'vaults', '-d', 'vaults_experimental', '-At', '-c', sql]));
  const history = verifyReplicaHistory(replicas,
    query("SELECT coalesce(json_agg(json_build_object('vaultId',vault_id,'cursor',cursor,'opId',encode(operation_id,'hex'))),'[]'::json) FROM vaults.sync_operations"),
    query("SELECT coalesce(json_agg(json_build_object('vaultId',vault_id,'hash',encode(checkpoint_hash,'hex'))),'[]'::json) FROM vaults.sync_checkpoints"));
  if (action === 'restore') {
    if (process.platform === 'win32') {
      // Stop only this checkout's web Vite process, which can otherwise occupy
      // the enrolled origin. Never stop Desktop or arbitrary Node processes.
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine.Contains($env:VAULTS_WEB_VITE_PATH) } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction Stop }"], { windowsHide: true, encoding: 'utf8', env: { ...process.env, VAULTS_WEB_VITE_PATH: join(root, 'apps/web/node_modules/vite/bin/vite.js') } });
      if (result.status !== 0) throw Error('Could not stop the competing web development process.');
    }
    for (const name of config.retiredContainers) {
      if ([config.database, config.server, config.relay].includes(name) || !/^vaults(?:-test-|-acceptance)/.test(name)) throw Error('Invalid retired container.');
      const inspected = JSON.parse(run(['inspect', name]))[0];
      if (inspected.State.Running) run(['stop', '--time', '20', name]);
    }
  }
  if (action !== 'status') {
    run(['start', config.database, config.server]);
    if (action === 'restart') run(['restart', '--time', '20', config.server]);
    run(['start', config.relay]);
  }
  const ca = await readFile(join(config.identity, 'ca/ca.crt'));
  let status;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      status = await new Promise((done, fail) => {
        const request = get(new URL('/api/v1/setup', config.origin), { ca, timeout: 3000 }, response => {
          let body = ''; response.on('data', chunk => { body += chunk; });
          response.on('end', () => { try { if (response.statusCode !== 200) throw Error('Server not ready'); done(JSON.parse(body)); } catch (error) { fail(error); } });
          response.on('error', fail);
        });
        request.on('error', fail); request.on('timeout', () => request.destroy(Error('Server timeout')));
      });
      break;
    } catch (error) { if (attempt === 19 || action === 'status') throw error; await new Promise(done => setTimeout(done, 1000)); }
  }
  const receipt = { action, at: new Date().toISOString(), origin: config.origin, installationId: databaseId, server: config.server, database: config.database, history, status };
  await mkdir(join(root, '.tools/verification/local-server'), { recursive: true });
  await writeFile(join(root, '.tools/verification/local-server', `${Date.now()}-${action}.json`), JSON.stringify(receipt, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(receipt, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
