import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntakeHandler, encryptRequest } from '../src/server.mjs';
import { createTrialHandler, loadTrialArtifacts, pruneAccessRequests, readAccessRequests } from '../src/trials.mjs';
import { licenseStatus, verifyLicenseFile, verifyLicenseRevocationFile } from '../../server/src/license-status.mjs';
import { installLicenseFiles } from '../../../deploy/license-files.mjs';

test('real request → operator approval → private downloads → durable 10-day bound license → expiry and closure', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-trial-'));
  const key = randomBytes(32), operatorToken = randomBytes(32).toString('base64url');
  const issuerPrivateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const issuerPublicKeys = { trial: createPublicKey(issuerPrivateKey).export({ type: 'spki', format: 'pem' }) };
  const dataFile = join(dir, 'requests.jsonl'), file = join(dir, 'server.tar');
  const bytes = 'synthetic approved archive'; await writeFile(file, bytes);
  const catalogue = { schemaVersion: 1, sourceRevision: 'a'.repeat(40), issuerPublicKeys,
    artifacts: [{ id: 'server', filename: 'server.tar', label: 'Server', path: file, sizeBytes: Buffer.byteLength(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex') }] };
  const catalogueFile = join(dir, 'catalogue.json'); await writeFile(catalogueFile, JSON.stringify(catalogue));
  await loadTrialArtifacts(catalogueFile);
  let at = new Date('2026-10-16T10:00:00.000Z');
  const sent = [];
  let emailFailure = false;
  const origin = 'https://127vaults.example';
  const options = { origin, key, dataFile, dataDir: join(dir, 'trials'), operatorToken, issuerPrivateKey,
    issuerKeyId: 'trial', catalogue, now: () => at, mailer: { sendInvitation: async message => {
      sent.push(message); if (emailFailure) throw Error('lost reply'); return { state: 'queued' };
    } } };
  let trials = createTrialHandler(options);
  const waitlist = createIntakeHandler({ origin, key, dataFile });
  const server = createServer((req, res) => req.url === '/api/waitlist' ? waitlist(req, res) : trials(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const get = (path, token, cookie) => fetch(root + path, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
  const post = (path, value, token, requestOrigin = origin) => fetch(root + path, { method: 'POST', headers: {
    Origin: requestOrigin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(value) });
  const admin = '/api/access-admin/requests';
  try {
    assert.equal((await post('/api/waitlist', { email: 'friend@example.com', organization: '', plan: 'personal', requestedSeats: 3, website: '', consent: true })).status, 202);
    assert.equal((await get(admin)).status, 401);
    const inbox = await (await get(admin, operatorToken)).json();
    assert.equal(inbox.requests[0].email, 'friend@example.com');
    assert.equal(inbox.requests[0].requestedSeats, 3);
    const id = inbox.requests[0].id;
    assert.equal((await (await post(`${admin}/${id}/archive`, {}, operatorToken)).json()).state, 'requested');
    assert.ok((await (await get(admin, operatorToken)).json()).requests[0].archivedAt);
    assert.equal((await (await post(`${admin}/${id}/unarchive`, {}, operatorToken)).json()).archivedAt, null);
    assert.equal((await post(`${admin}/${id}/approve`, { maxUsers: 5 }, operatorToken, 'https://other.example')).status, 403);
    const approval = await (await post(`${admin}/${id}/approve`, { maxUsers: 5 }, operatorToken)).json();
    assert.match(approval.message, /unpaid/);
    assert.match(approval.link, /^https:\/\/127vaults.example\/trial.html#/);
    assert.equal((await post(`${admin}/${id}/approve`, { maxUsers: 5 }, operatorToken)).status, 409);
    const token = approval.link.split('.').at(-1), base = `/api/trials/${id}`;
    assert.equal(sent.length, 0); // Approval alone must never email a requester.
    assert.equal((await get(`${admin}/${id}/invitation`)).status, 401);
    assert.equal((await (await get(`${admin}/${id}/invitation`, operatorToken)).json()).message, approval.message);
    assert.equal((await post(`${admin}/${id}/send-invitation`, { to: 'other@example.com' }, operatorToken)).status, 400);
    assert.equal((await post(`${admin}/${id}/send-invitation`, {}, token)).status, 401);
    const emailSent = await (await post(`${admin}/${id}/send-invitation`, {}, operatorToken)).json();
    assert.equal(emailSent.emailState, 'queued'); assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'friend@example.com'); assert.ok(sent[0].text.includes(approval.link));
    assert.equal((await post(`${admin}/${id}/send-invitation`, {}, operatorToken)).status, 409);
    assert.equal((await get(base)).status, 401);
    const view = await (await get(base, token)).json();
    assert.equal(view.payment, 'none'); assert.equal(view.artifacts[0].path, undefined);
    assert.equal(await (await get(`${base}/artifacts/server`, token)).text(), bytes);
    const ticket = await post(`${base}/ticket`, {}, token);
    assert.match(ticket.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/);
    const cookie = ticket.headers.get('set-cookie').split(';')[0];
    assert.equal(await (await get(`${base}/artifacts/server`, null, cookie)).text(), bytes);
    at = new Date(at.getTime() + 2 * 86400000);
    const installationId = randomUUID();
    const activation = await (await post(`${base}/activate`, { installationId }, token)).json();
    assert.equal(activation.expiresAt, '2026-10-28T10:00:00.000Z');
    const firstLicense = await (await get(`${base}/license`, token)).text();
    const license = verifyLicenseFile(firstLicense, issuerPublicKeys, installationId);
    assert.equal(license.maxActiveUsers, 5); assert.equal(licenseStatus(license, at).mode, 'active');
    await post(`${admin}/${id}/archive`, {}, operatorToken);
    assert.equal(await (await get(`${base}/license`, token)).text(), firstLicense);
    await post(`${admin}/${id}/unarchive`, {}, operatorToken);
    const envPath = join(dir, '.env'); await writeFile(envPath, 'VAULTS_PROJECT=trial\n');
    await installLicenseFiles({ runtimeDir: join(dir, 'runtime'), envPath, installationId,
      licenseSource: firstLicense, keySource: JSON.stringify(issuerPublicKeys), now: at });
    assert.match(await readFile(envPath, 'utf8'), /VAULTS_LICENSE_FILE=/);
    trials = createTrialHandler(options); // Process restart uses the same persisted approval and license.
    assert.equal((await post(`${admin}/${id}/send-invitation`, {}, operatorToken)).status, 409);
    assert.equal(sent.length, 1);
    at = new Date(at.getTime() + 86400000);
    assert.equal((await post(`${base}/activate`, { installationId }, token)).status, 200);
    assert.equal(await (await get(`${base}/license`, token)).text(), firstLicense);
    assert.equal((await post(`${base}/activate`, { installationId: randomUUID() }, token)).status, 409);
    assert.equal(licenseStatus(license, new Date(activation.expiresAt)).mode, 'read-only');
    const rotated = await (await post(`${admin}/${id}/rotate`, {}, operatorToken)).json();
    const nextToken = rotated.link.split('.').at(-1);
    emailFailure = true;
    assert.equal((await (await post(`${admin}/${id}/send-invitation`, {}, operatorToken)).json()).emailState, 'unknown');
    assert.equal((await post(`${admin}/${id}/send-invitation`, {}, operatorToken)).status, 409);
    assert.equal(sent.length, 2);
    assert.equal((await get(base, token)).status, 401);
    assert.equal((await get(`${base}/artifacts/server`, null, cookie)).status, 401);
    assert.equal(await (await get(`${base}/license`, nextToken)).text(), firstLicense);
    await writeFile(file, 'tampered approved archive');
    assert.equal((await get(`${base}/artifacts/server`, nextToken)).status, 503);
    const closed = await (await post(`${admin}/${id}/close`, {}, operatorToken)).json();
    assert.equal(closed.hasRevocation, true);
    assert.equal((await get(base, nextToken)).status, 404);
    const revocation = await (await get(`${admin}/${id}/revocation`, operatorToken)).text();
    assert.equal(verifyLicenseRevocationFile(revocation, issuerPublicKeys, installationId, license.licenseId).licenseId, license.licenseId);
    const stored = await readFile(join(dir, 'trials', `${id}.json`), 'utf8');
    assert.ok(!stored.includes(nextToken)); assert.ok(!stored.includes(installationId));
    assert.ok(!(await readFile(dataFile, 'utf8')).includes('friend@example.com'));
    assert.equal((await post(`${admin}/${id}/erase`, {}, operatorToken)).status, 200);
    assert.equal((await readAccessRequests(dataFile, key)).length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('legacy waitlist retention preserves current encrypted records and stable request IDs', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-trial-retention-'));
  const key = randomBytes(32), dataFile = join(dir, 'requests.jsonl');
  try {
    const request = { email: 'old@example.com', organization: '', plan: 'personal', requestedSeats: null };
    const current = encryptRequest({ ...request, email: 'new@example.com' }, key, new Date('2026-10-16T00:00:00Z'));
    await writeFile(dataFile, encryptRequest(request, key, new Date('2026-01-01T00:00:00Z')) + current);
    const before = await readAccessRequests(dataFile, key);
    assert.equal(await pruneAccessRequests({ dataFile, key, now: new Date('2026-10-16T00:00:00Z') }), 1);
    assert.equal((await readAccessRequests(dataFile, key))[0].id, before[1].id);
    assert.equal(await readFile(dataFile, 'utf8'), current);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
