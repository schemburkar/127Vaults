// Use a fresh internal server bundle and a private address assigned to this host.
// No email provider, customer credentials or operating-system CA changes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verifyPrivateAdmin(identity, address, password) {
  const ca = await readFile(join(identity, 'ca/ca.crt'));
  const vault = `https://${address}:12780`;
  const admin = 'https://127.0.0.1:12781';
  const certificate = new X509Certificate(await readFile(join(identity, 'live/server.crt')));
  assert.equal(certificate.checkIP(address), address);
  assert.equal(certificate.checkIP('127.0.0.1'), '127.0.0.1');
  const call = (origin, path, { body, headers = {} } = {}) => new Promise((done, fail) => {
    const req = request(origin + path, { ca, method: body ? 'POST' : 'GET', headers, timeout: 5000 }, response => {
      let content = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { content += chunk; });
      response.on('end', () => done({ status: response.statusCode, headers: response.headers, content }));
      response.on('error', fail);
    });
    req.on('error', fail);
    req.on('timeout', () => req.destroy(new Error('Fixture request timed out.')));
    req.end(body);
  });
  assert.equal((await call(vault, '/api/v1/setup')).status, 200);
  assert.equal((await call(vault, '/admin/')).status, 403);
  assert.equal((await call(vault, '/api/admin/session')).status, 403);
  assert.equal((await call(admin, '/admin/')).status, 200);
  assert.equal((await call(admin, '/api/v1/setup')).status, 404);
  assert.equal((await call(admin, '/api/admin/session', { headers: { origin: vault } })).status, 403);
  const signedIn = await call(admin, '/api/admin/session', {
    body: JSON.stringify({ username: 'fixtureowner', password }),
    headers: { origin: admin, 'content-type': 'application/json' },
  });
  assert.equal(signedIn.status, 200);
  assert.equal(JSON.parse(signedIn.content).vaultOrigin, vault);
  assert.ok(signedIn.headers['set-cookie']);
  console.log(JSON.stringify({ ok: true, pinnedTls: true, lanVault: true, hostAdmin: true, adminDeniedOnVault: true }));
}

async function main() {
  const [bundleArg, address] = process.argv.slice(2);
  if (!bundleArg || !address || process.argv.length !== 4 || !/^[\d.]+$/.test(address) || address.startsWith('127.')) {
    throw Error('Use node scripts/private-admin-smoke.mjs <fresh bundle> <host private LAN IPv4>.');
  }
  const bundle = resolve(bundleArg);
  if (existsSync(join(bundle, '.env'))) throw Error('Use an uninitialized fixture bundle.');
  const identity = await mkdtemp(join(tmpdir(), 'vaults-private-admin-fixture-'));
  const password = 'fixture-only-local-admin-password';
  const run = (args, env = process.env) => execFileSync(process.execPath, ['server.mjs', ...args], {
    cwd: bundle, env, stdio: 'inherit', timeout: 180_000, windowsHide: true
  });
  const install = (action, ...args) => run(['install', action, '--private-dir', identity, ...args]);
  let configured = false;
  try {
    install('init', '--endpoint', address);
    configured = true;
    run(['admin', 'init', 'fixtureowner', join(identity, 'runtime/admin-operators.json')],
      { ...process.env, VAULTS_ADMIN_SETUP_PASSWORD: password });
    install('start');
    await verifyPrivateAdmin(identity, address, password);
  } finally {
    if (configured || existsSync(join(bundle, '.env'))) install('stop');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
