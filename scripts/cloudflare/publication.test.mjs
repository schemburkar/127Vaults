import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicArtifact, validateCatalogue } from '../../apps/public-intake/cloudflare/catalogue.mjs';
import { auditPublication, scanPayload, secretPatterns } from './publication.mjs';
import { readPublicAsset } from './config.mjs';
import { uploadArtifacts } from './artifacts.mjs';

function catalogue() {
  return { schemaVersion: 1, sourceRevision: 'a'.repeat(40), issuerPublicKeys: {
    trial: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }),
  }, artifacts: [{ id: 'server', filename: 'server.tar', label: 'Server', sizeBytes: 1, sha256: 'b'.repeat(64),
    objectKey: 'releases/test/server.tar', etag: 'c'.repeat(32) }] };
}

test('catalogues reject private keys, extra configuration fields and sensitive artifact filenames', () => {
  const value = catalogue(); validateCatalogue(value);
  assert.throws(() => validateCatalogue({ ...value, issuerPrivateKey: 'must-not-upload' }), /Invalid catalogue/);
  assert.throws(() => validateCatalogue({ ...value, artifacts: [{ ...value.artifacts[0], operatorToken: 'must-not-forward' }] }), /Invalid artifact/);
  const privateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => validateCatalogue({ ...value, issuerPublicKeys: { trial: privateKey } }), /Invalid catalogue/);
  for (const filename of ['issuer.pem', 'token.key', 'requests.json', 'intake-secret.json', 'trial-license.json', 'backup.zip']) {
    assert.throws(() => validateCatalogue({ ...value, artifacts: [{ ...value.artifacts[0], filename }] }), /Invalid artifact/);
  }
  assert.equal(publicArtifact({ ...value.artifacts[0], privateNotes: 'never forward' }).privateNotes, undefined);
});

test('publication scans find configured credentials across stream boundaries and redact their errors', async () => {
  const secret = 'synthetic-sensitive-token-123456789', patterns = secretPatterns({ OPERATOR_TOKEN: secret }, {});
  const chunks = [Buffer.from('safe bytes' + secret.slice(0, 12)), Buffer.from(secret.slice(12) + 'safe bytes')];
  await assert.rejects(scanPayload(chunks, patterns), error => {
    assert.match(error.message, /Publication blocked/); assert.ok(!error.message.includes(secret)); return true;
  });
  const privateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  await assert.rejects(scanPayload([Buffer.from(privateKey)], []), /Publication blocked/);
  await assert.rejects(scanPayload([Buffer.from(JSON.stringify({ key: privateKey }))], []), /Publication blocked/);
  await assert.rejects(scanPayload([Buffer.from(JSON.stringify({ key: privateKey }))], secretPatterns({ key: privateKey }, {})), /Publication blocked/);
  await scanPayload([Buffer.from('Public code can mention -----BEGIN PRIVATE KEY----- without containing key material')], []);
});

test('public release catalogue must stay empty and public files cannot contain private key material', async () => {
  const privateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  await assert.rejects(auditPublication({ artifacts: [] }, {}, { environment: {}, readAsset: async name => Buffer.from(name === 'releases.json'
    ? JSON.stringify({ schemaVersion: 1, releases: [{ url: 'https://unapproved.example/file' }] }) : 'safe') }), /empty public release/);
  await assert.rejects(auditPublication({ artifacts: [] }, {}, { environment: {}, readAsset: async () => Buffer.from(privateKey) }), /Publication blocked/);
});

test('static publication refuses symlinks instead of following them to an external private file', async t => {
  const directory = await mkdtemp(join(tmpdir(), '127v-publication-link-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'site'), outside = join(directory, 'private'); await mkdir(source); await mkdir(outside);
  await writeFile(join(outside, 'site.css'), 'private bytes');
  // A Windows directory junction does not require Developer Mode/admin privileges.
  const alias = join(source, 'site.css'); await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await assert.rejects(readPublicAsset('site.css', source), /not a regular/);
  } finally { await unlink(alias); }
  await writeFile(join(source, 'site.css'), 'safe'); assert.equal((await readPublicAsset('site.css', source)).toString(), 'safe');
  await mkdir(join(source, 'trial.mjs')); await assert.rejects(readPublicAsset('trial.mjs', source), /not a regular/);
});

test('R2 uploader rejects unapproved catalogue fields before any network request', async () => {
  const value = catalogue(); let calls = 0;
  const { objectKey: _, etag: __, ...artifact } = value.artifacts[0];
  await assert.rejects(uploadArtifacts({ bucket: 'private', releaseId: 'trial',
    client: { send() { calls++; throw Error('network should not run'); } },
    catalogue: { ...value, artifacts: [{ ...artifact, path: '/synthetic/server.tar', privateNotes: 'do not upload' }] } }), /Invalid artifact/);
  assert.equal(calls, 0);
});
