import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { verifyLicenseFile, verifyLicenseRevocationFile } from '../../server/src/license-status.mjs';
import { encryptionKey, limiterKey, seal, unseal } from '../cloudflare/crypto.mjs';
import { TrialStore } from '../cloudflare/store.mjs';
import { handleRequest, prune } from '../cloudflare/worker.mjs';
import { stageAssets } from '../../../scripts/cloudflare/config.mjs';
import { issueSelfHostedLicense } from '../../../scripts/ops/issue-self-hosted-license.mjs';

const origin = 'https://trial.example.com';
const admin = '/api/access-admin/requests';
const root = fileURLToPath(new URL('../../../', import.meta.url));
async function fixture(t, options = {}) {
  const issuerPrivateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeys = { trial: createPublicKey(issuerPrivateKey).export({ type: 'spki', format: 'pem' }) };
  const operatorToken = randomBytes(32).toString('base64url'), intakeKey = randomBytes(32).toString('hex');
  const archive = 'synthetic private archive', sha256 = createHash('sha256').update(archive).digest('hex');
  const catalogue = { schemaVersion: 1, sourceRevision: 'a'.repeat(40), issuerPublicKeys: publicKeys,
    artifacts: [{ id: 'server', filename: 'server.tar', label: 'Server', sizeBytes: Buffer.byteLength(archive), sha256,
      objectKey: 'releases/test/server.tar', etag: createHash('md5').update(archive).digest('hex') }] };
  const catalogueSource = JSON.stringify(catalogue);
  const bindings = { PUBLIC_INTAKE_ORIGIN: origin, OPERATOR_TOKEN: operatorToken, INTAKE_KEY: intakeKey,
    TRIAL_ISSUER_KEY_ID: 'trial', TRIAL_ISSUER_PRIVATE_KEY: issuerPrivateKey, TRIAL_CATALOGUE_KEY: 'releases/test/catalogue.json',
    TRIAL_SOURCE_REVISION: 'a'.repeat(40), TRIAL_CATALOGUE_SHA256: createHash('sha256').update(catalogueSource).digest('hex'),
    ...(options.bindings ?? {}) };
  const mfOptions = { modules: true, modulesRoot: root, scriptPath: fileURLToPath(new URL('../cloudflare/worker.mjs', import.meta.url)),
    modulesRules: [{ type: 'ESModule', include: ['**/*.mjs'], fallthrough: true }],
    compatibilityDate: '2026-07-01', bindings, d1Databases: ['DB'], r2Buckets: ['ARTIFACTS'],
    ...(options.assetsDirectory ? { assets: { directory: options.assetsDirectory, binding: 'ASSETS',
      routerConfig: { has_user_worker: true, static_routing: { user_worker: ['/api/*'] } },
      assetConfig: { html_handling: 'drop-trailing-slash', not_found_handling: 'none' } } }
      : { serviceBindings: { ASSETS: () => new Response('static website') } }),
    ...(options.outboundService ? { outboundService: options.outboundService } : {}),
    ...(options.persistDirectory ? { d1Persist: join(options.persistDirectory, 'd1'), r2Persist: join(options.persistDirectory, 'r2') } : {}) };
  let mf;
  if (options.cliRuntime) {
    const require = createRequire(import.meta.url);
    const bundled = createRequire(require.resolve('wrangler/package.json'))('miniflare');
    const directory = fileURLToPath(new URL('../cloudflare/', import.meta.url));
    const paths = [mfOptions.scriptPath,
      ...(await readdir(directory)).filter(name => name.endsWith('.mjs') && name !== 'worker.mjs').map(name => join(directory, name)),
      ...['validate-request.mjs', 'intake-origin.mjs', 'cloudflare-email.mjs', 'operator-session.mjs', 'request-alerts.mjs'].map(name => fileURLToPath(new URL(`../src/${name}`, import.meta.url)))];
    mf = new bundled.Miniflare(bundled.convertV4MiniflareOptions({ ...mfOptions, scriptPath: undefined,
      modulesRules: undefined, modules: paths.map(path => ({ type: 'ESModule', path })) }));
  } else mf = new Miniflare(mfOptions);
  let disposed = false;
  const dispose = () => { if (!disposed) { disposed = true; return mf.dispose(); } };
  t.after(dispose);
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('ARTIFACTS');
  const sql = await readFile(new URL('../cloudflare/migrations/0001_trials.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';').map(v => v.trim()).filter(Boolean)) await db.prepare(statement).run();
  const object = await bucket.put('releases/test/server.tar', archive, { customMetadata: { sha256 } });
  assert.equal(object.etag, catalogue.artifacts[0].etag);
  await bucket.put(bindings.TRIAL_CATALOGUE_KEY, catalogueSource);
  const get = (path, token, cookie) => mf.dispatchFetch(origin + path, { headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}),
  } });
  const post = (path, input, token, from = origin) => mf.dispatchFetch(origin + path, { method: 'POST', headers: {
    Origin: from, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(input) });
  const requestInput = { email: 'friend@example.com', plan: 'personal', organization: '', website: '', requestedSeats: 3, consent: true };
  const submit = async (email = requestInput.email) => {
    assert.equal((await post('/api/waitlist', { ...requestInput, email })).status, 202);
    const inbox = await get(admin, operatorToken); assert.equal(inbox.status, 200, await inbox.clone().text());
    return (await inbox.json()).requests.find(row => row.email === email).id;
  };
  const approve = async id => {
    const response = await post(`${admin}/${id}/approve`, { maxUsers: 5 }, operatorToken);
    assert.equal(response.status, 200, await response.clone().text());
    const value = await response.json(); return { ...value, token: value.link.split('.').at(-1), base: `/api/trials/${id}` };
  };
  return { mf, dispose, mfOptions, db, bucket, bindings, operatorToken, intakeKey, publicKeys, catalogue, archive, sha256,
    get, post, submit, approve, requestInput, env: { ...bindings, DB: db, ARTIFACTS: bucket } };
}

test('operator attaches an existing development license without changing identity, expiry or signed bytes',async t=>{
  const f=await fixture(t),id=await f.submit(),installationId=randomUUID();
  const expiresAt=new Date(Date.now()+365*86400000).toISOString();
  const {license}=issueSelfHostedLicense({privateKeyPem:f.bindings.TRIAL_ISSUER_PRIVATE_KEY,keyId:'trial',installationId,
    plan:'development',majorVersion:null,maxActiveUsers:5,sequence:3,expiresAt});
  assert.equal((await f.post(`${admin}/${id}/approve-development`,{license})).status,401);
  assert.equal((await f.post(`${admin}/${id}/approve-development`,{license:'{}'},f.operatorToken)).status,400);
  const response=await f.post(`${admin}/${id}/approve-development`,{license},f.operatorToken);
  assert.equal(response.status,200,await response.clone().text());const a=await response.json();const token=a.link.split('.').at(-1),base=`/api/trials/${id}`;
  assert.equal(a.kind,'development');assert.equal(a.installationId,installationId);assert.equal(a.expiresAt,expiresAt);
  assert.equal(await(await f.get(`${base}/license`,token)).text(),license);
  assert.equal((await f.post(`${base}/activate`,{installationId},token)).status,200);
  assert.equal((await f.post(`${base}/activate`,{installationId:randomUUID()},token)).status,409);
  await f.db.prepare('UPDATE access_requests SET received_at = ? WHERE id = ?').bind(Date.now()-91*86400000,id).run();
  await prune(f.env);assert.equal((await f.get(base,token)).status,200);
  const rotated=await f.post(`${admin}/${id}/rotate`,{},f.operatorToken);assert.equal(rotated.status,200);
  const next=await rotated.json();assert.equal(next.kind,'development');assert.equal(next.expiresAt,expiresAt);
});

test('new development invitations activate the explicitly approved duration, never the trial duration',async t=>{
  const f=await fixture(t),id=await f.submit(),expiresAt=new Date(Date.now()+365*86400000).toISOString();
  const response=await f.post(`${admin}/${id}/approve-development`,{maxUsers:7,expiresAt},f.operatorToken);
  assert.equal(response.status,200);const a=await response.json(),token=a.link.split('.').at(-1),base=`/api/trials/${id}`,installationId=randomUUID();
  assert.equal((await f.post(`${base}/activate`,{installationId},token)).status,200);
  const license=verifyLicenseFile(await(await f.get(`${base}/license`,token)).text(),f.publicKeys,installationId);
  assert.equal(license.plan,'development');assert.equal(license.expiresAt,expiresAt);assert.equal(license.maxActiveUsers,7);
  assert.equal((await(await f.get(base,token)).json()).trialDays,0);
});

test('installer authenticates entitled releases and enforces a server-controlled version floor', async t => {
  const f = await fixture(t, { bindings: { INSTALLER_MIN_VERSION: '0.2.0' } });
  const a = await f.approve(await f.submit());
  const request = (action, version, token = a.token) => f.mf.dispatchFetch(`${origin}${a.base}/${action}`, {
    headers: { Authorization: `Bearer ${token}`, ...(version ? { 'X-127Vaults-Installer-Version': version } : {}) },
  });
  assert.equal((await request('installer', '0.2.0', 'x'.repeat(43))).status, 401);
  assert.equal((await request('installer')).status, 426);
  assert.equal((await request('installer', '0.1.0')).status, 426);
  assert.equal((await request('artifacts/server', '0.1.0')).status, 426);
  const response = await request('installer', '0.2.0');
  assert.equal(response.status, 200);
  const plan = await response.json();
  assert.equal(plan.protocolVersion, 1);
  assert.equal(plan.minimumInstallerVersion, '0.2.0');
  assert.equal(plan.installationId, null);
  assert.equal(plan.artifacts[0].sha256, f.sha256);
  assert.equal(plan.artifacts[0].objectKey, undefined);
  const id = randomUUID();
  const blockedActivation = await f.mf.dispatchFetch(`${origin}${a.base}/activate`, { method: 'POST', headers: {
    Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}`, 'X-127Vaults-Installer-Version': '0.1.0',
  }, body: JSON.stringify({ installationId: id }) });
  assert.equal(blockedActivation.status, 426);
  assert.equal((await (await request('installer', '0.2.0')).json()).installationId, null);
  assert.equal((await f.post(`${a.base}/activate`, { installationId: id }, a.token)).status, 200);
  assert.equal((await (await request('installer', '0.2.0')).json()).installationId, id);
  // Legacy browser downloads retain their normal authenticated flow.
  assert.equal((await f.get(`${a.base}/artifacts/server`, a.token)).status, 200);
});

test('Cloudflare runtime: request, approval, R2 cookie download, compatible license, rotation and closure', async t => {
  const f = await fixture(t);
  assert.equal(await (await f.get('/')).text(), 'static website');
  assert.equal((await f.get(admin)).status, 401);
  assert.equal((await f.get('/api/access-admin/readiness')).status, 401);
  const readiness = await f.get('/api/access-admin/readiness', f.operatorToken);
  assert.equal(readiness.status, 200, await readiness.clone().text());
  assert.equal((await readiness.json()).ready, true);
  assert.equal((await f.post('/api/waitlist', f.requestInput, null, 'https://evil.example')).status, 403);
  const id = await f.submit(), a = await f.approve(id);
  assert.equal((await f.post(`${admin}/${id}/approve`, { maxUsers: 5 }, f.operatorToken)).status, 409);
  assert.equal((await f.get(a.base)).status, 401);
  const view = await (await f.get(a.base, a.token)).json();
  assert.equal(view.artifacts[0].objectKey, undefined); assert.equal(view.artifacts[0].etag, undefined);
  assert.equal(view.artifacts[0].sha256, f.sha256);
  assert.equal(await (await f.get(`${a.base}/artifacts/server`, a.token)).text(), f.archive);
  const ticket = await f.post(`${a.base}/ticket`, {}, a.token);
  assert.match(ticket.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/);
  const cookie = ticket.headers.get('set-cookie').split(';')[0];
  assert.equal(await (await f.get(`${a.base}/artifacts/server`, null, cookie)).text(), f.archive);
  const installationId = randomUUID();
  const activation = await f.post(`${a.base}/activate`, { installationId }, a.token);
  assert.equal(activation.status, 200, await activation.clone().text());
  const dates = await activation.json(); assert.equal(Date.parse(dates.expiresAt) - Date.parse(dates.activatedAt), 10 * 86400000);
  const license = await (await f.get(`${a.base}/license`, a.token)).text();
  const payload = verifyLicenseFile(license, f.publicKeys, installationId); assert.equal(payload.maxActiveUsers, 5);
  assert.equal((await f.post(`${a.base}/activate`, { installationId: randomUUID() }, a.token)).status, 409);
  assert.equal((await f.post(`${a.base}/activate`, { installationId }, a.token)).status, 200);
  assert.equal(await (await f.get(`${a.base}/license`, a.token)).text(), license);
  const archived = await f.post(`${admin}/${id}/archive`, {}, f.operatorToken); assert.equal(archived.status, 200);
  assert.equal((await (await f.get(admin, f.operatorToken)).json()).requests[0].state, 'approved');
  const rotate = await (await f.post(`${admin}/${id}/rotate`, {}, f.operatorToken)).json();
  const nextToken = rotate.link.split('.').at(-1);
  assert.equal((await f.get(a.base, a.token)).status, 401);
  assert.equal((await f.get(`${a.base}/artifacts/server`, null, cookie)).status, 401);
  assert.equal(await (await f.get(`${a.base}/license`, nextToken)).text(), license);
  await f.bucket.put(f.catalogue.artifacts[0].objectKey, 'changed bytes', { customMetadata: { sha256: f.sha256 } });
  assert.equal((await f.get(`${a.base}/artifacts/server`, nextToken)).status, 503);
  assert.equal((await f.post(`${admin}/${id}/close`, {}, f.operatorToken)).status, 200);
  assert.equal((await f.get(a.base, nextToken)).status, 404);
  const revocation = await (await f.get(`${admin}/${id}/revocation`, f.operatorToken)).text();
  verifyLicenseRevocationFile(revocation, f.publicKeys, installationId, payload.licenseId);
  const saved = await f.db.prepare('SELECT * FROM access_requests WHERE id = ?').bind(id).first();
  assert.ok(!saved.contact.includes('friend@example.com')); assert.ok(!saved.trial.includes(installationId));
  assert.ok(!saved.trial.includes(nextToken));
  assert.equal((await f.post(`${admin}/${id}/erase`, {}, f.operatorToken)).status, 200);
  assert.equal((await f.db.prepare('SELECT contact FROM access_requests WHERE id = ?').bind(id).first()).contact, null);
  assert.equal((await (await f.get(admin, f.operatorToken)).json()).requests.length, 0);
});

test('D1 concurrency: one approval, one installation binding, stale writes refused, limiter atomic', async t => {
  const f = await fixture(t), id = await f.submit();
  const approvals = await Promise.all(Array.from({ length: 5 }, () => f.post(`${admin}/${id}/approve`, { maxUsers: 3 }, f.operatorToken)));
  assert.equal(approvals.filter(r => r.status === 200).length, 1);
  assert.ok(approvals.every(r => [200, 409].includes(r.status)));
  const a = await approvals.find(r => r.status === 200).json(), token = a.link.split('.').at(-1), base = `/api/trials/${id}`;
  const installations = [randomUUID(), randomUUID()];
  const activations = await Promise.all(installations.map(installationId => f.post(`${base}/activate`, { installationId }, token)));
  assert.equal(activations.filter(r => r.status === 200).length, 1);
  assert.equal(activations.filter(r => r.status === 409).length, 1);
  const contactKey = await encryptionKey(f.intakeKey, 'contacts'), trialKey = await encryptionKey(f.intakeKey, 'trials');
  const store = new TrialStore(f.db, contactKey, trialKey, () => Date.now(), await limiterKey(f.intakeKey));
  const stale = await store.get(id), fresh = await store.get(id);
  await store.save(fresh, { ...fresh.trial, state: 'closed' });
  await assert.rejects(store.save(stale, { ...stale.trial, state: 'approved' }), /state_changed/);
  const limits = await Promise.all(Array.from({ length: 12 }, () => store.allow('atomic-test', 'same-ip', 3, 3600000)));
  assert.equal(limits.filter(Boolean).length, 3);
});

test('retention closes old links and erases contact while retaining compatible signed revocation', async t => {
  const f = await fixture(t), id = await f.submit(), a = await f.approve(id), installationId = randomUUID();
  await f.post(`${a.base}/activate`, { installationId }, a.token);
  const license = verifyLicenseFile(await (await f.get(`${a.base}/license`, a.token)).text(), f.publicKeys, installationId);
  await f.db.prepare('UPDATE access_requests SET received_at = ? WHERE id = ?').bind(Date.now() - 91 * 86400000, id).run();
  await prune(f.env);
  const row = await f.db.prepare('SELECT * FROM access_requests WHERE id = ?').bind(id).first();
  assert.equal(row.contact, null);
  const record = await unseal(row.trial, await encryptionKey(f.intakeKey, 'trials'), `trial:${id}`);
  assert.equal(record.state, 'closed'); assert.equal(record.invitation, undefined);
  verifyLicenseRevocationFile(record.revocation, f.publicKeys, installationId, license.licenseId);
});

test('encrypted records bind ciphertext to both record ID and purpose', async () => {
  const key = await encryptionKey(randomBytes(32).toString('hex'), 'contacts');
  const envelope = await seal({ email: 'private@example.com' }, key, 'contact:a');
  await assert.rejects(unseal(envelope, key, 'contact:b'));
  assert.equal((await unseal(envelope, key, 'contact:a')).email, 'private@example.com');
});

test('Worker email claims survive concurrent sends, ambiguous replies and closure during provider I/O', { timeout: 15000 }, async t => {
  let announce, finish;
  let reached = new Promise(resolve => { announce = resolve; });
  let gate = new Promise(resolve => { finish = resolve; });
  let sent = 0, ambiguous = false, recipient = 'friend@example.com';
  const f = await fixture(t, { bindings: { CF_ACCOUNT_ID: 'a'.repeat(32),
    TRIAL_EMAIL_FROM: 'trials@example.com', TRIAL_EMAIL_API_TOKEN: 'x'.repeat(32) },
    outboundService: async request => {
      sent++; announce();
      assert.equal(request.url, `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/email/sending/send`);
      const message = await request.json(); assert.equal(message.to, recipient);
      assert.equal(message.from, 'trials@example.com'); assert.match(message.text, /trial\?open=1#/);
      await gate;
      return Response.json(ambiguous ? { success: false } : { success: true, result: { queued: [recipient] } });
    } });
  const id = await f.submit(), a = await f.approve(id);
  const pending = f.post(`${admin}/${id}/send-invitation`, {}, f.operatorToken);
  await Promise.race([reached, pending.then(async response => { throw Error(`Email finished before provider: ${response.status} ${await response.text()}`); })]);
  assert.equal((await f.post(`${admin}/${id}/send-invitation`, {}, f.operatorToken)).status, 409);
  assert.equal((await f.post(`${admin}/${id}/close`, {}, f.operatorToken)).status, 200);
  finish(); assert.equal((await pending).status, 200); assert.equal(sent, 1);
  const row = (await (await f.get(admin, f.operatorToken)).json()).requests[0];
  assert.equal(row.state, 'closed'); assert.equal(row.canPreviewInvitation, false);
  assert.equal((await f.get(a.base, a.token)).status, 404);

  const next = await f.submit('second@example.com'); await f.approve(next);
  // A provider error is still recorded before returning, and never authorizes automatic retries.
  reached = new Promise(resolve => { announce = resolve; });
  gate = Promise.resolve(); ambiguous = true; recipient = 'second@example.com';
  const response = await f.post(`${admin}/${next}/send-invitation`, {}, f.operatorToken);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).emailState, 'unknown');
  assert.equal((await f.post(`${admin}/${next}/send-invitation`, {}, f.operatorToken)).status, 409);
  recipient = 'third@example.com'; ambiguous = false;
  const third = await f.submit(recipient); await f.approve(third);
  const queued = await f.post(`${admin}/${third}/send-invitation`, {}, f.operatorToken);
  assert.equal((await queued.json()).emailState, 'queued');
});

test('Worker validation refuses oversized and malformed input, honeypots, wrong methods and stale releases', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/api/waitlist', { ...f.requestInput, email: 'invalid' })).status, 400);
  assert.equal((await f.post('/api/waitlist', { ...f.requestInput, organization: 'x'.repeat(3000) })).status, 413);
  assert.equal((await f.post('/api/waitlist', { ...f.requestInput, website: 'bot' })).status, 202);
  assert.equal((await (await f.get(admin, f.operatorToken)).json()).requests.length, 0);
  assert.equal((await f.mf.dispatchFetch(origin + '/api/waitlist', { method: 'DELETE' })).status, 405);
  const id = await f.submit(), a = await f.approve(id);
  const store = new TrialStore(f.db, await encryptionKey(f.intakeKey, 'contacts'), await encryptionKey(f.intakeKey, 'trials'));
  const row = await store.get(id); await store.save(row, { ...row.trial, releaseHash: 'b'.repeat(64) });
  assert.equal((await f.get(a.base, a.token)).status, 200);
  assert.equal((await f.post(`${admin}/${id}/rotate`, {}, f.operatorToken)).status, 200);
  await f.bucket.put(f.bindings.TRIAL_CATALOGUE_KEY, JSON.stringify({ ...f.catalogue, sourceRevision: 'b'.repeat(40) }));
  assert.equal((await f.get(a.base, a.token)).status, 503);
  assert.equal((await f.get('/api/access-admin/readiness', f.operatorToken)).status, 503);
  // Unactivated contact erasure/closure must not depend on an available release bucket.
  assert.equal((await f.post(`${admin}/${id}/close`, {}, f.operatorToken)).status, 200);
  assert.equal((await f.post(`${admin}/${id}/erase`, {}, f.operatorToken)).status, 200);
});

test('operator can offer client-only updates without renewing or rebinding an activated trial', async t => {
  const f=await fixture(t),id=await f.submit(),a=await f.approve(id),installationId=randomUUID();
  assert.equal((await f.post(`${a.base}/activate`,{installationId},a.token)).status,200);
  const license=await (await f.get(`${a.base}/license`,a.token)).text();
  const store=new TrialStore(f.db,await encryptionKey(f.intakeKey,'contacts'),await encryptionKey(f.intakeKey,'trials'));
  const row=await store.get(id),expiresAt=row.trial.expiresAt;
  await store.save(row,{...row.trial,releaseHash:'b'.repeat(64)});
  const inbox = await (await f.get(admin, f.operatorToken)).json();
  assert.equal(inbox.requests[0].sourceRevision, inbox.sourceRevision);
  assert.equal(inbox.requests[0].updateAvailable, true);
  assert.equal((await f.post(`${admin}/${id}/update-release`,{})).status,401);
  const update=await f.post(`${admin}/${id}/update-release`,{},f.operatorToken);
  assert.equal(update.status,200,await update.clone().text());
  const data=await update.json(),replacement=data.link.split('.').at(-1);
  assert.equal(data.expiresAt,expiresAt);assert.equal(data.installationId,installationId);
  assert.equal(data.sourceRevision,'a'.repeat(40));
  assert.equal((await f.get(a.base,a.token)).status,401);
  assert.equal(await (await f.get(`${a.base}/license`,replacement)).text(),license);
  assert.equal((await (await f.get(admin,f.operatorToken)).json()).requests[0].updateAvailable,false);
});

test('removing email sender disables sending despite a retained Worker secret', async t => {
  const f = await fixture(t, { bindings: { TRIAL_EMAIL_API_TOKEN: 'x'.repeat(32) } });
  const id = await f.submit(); await f.approve(id);
  const inbox = await (await f.get(admin, f.operatorToken)).json();
  assert.equal(inbox.emailEnabled, false);
  assert.equal((await f.post(`${admin}/${id}/send-invitation`, {}, f.operatorToken)).status, 503);
});

test('private installer downloads support authorized resume and HEAD without bypassing closure', async t => {
  const f = await fixture(t), id = await f.submit(), a = await f.approve(id);
  const download = (method, range, token = a.token) => f.mf.dispatchFetch(origin + a.base + '/artifacts/server', {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(range ? { Range: range } : {}) },
  });
  assert.equal((await download('HEAD', null, '')).status, 401);
  const info = await download('HEAD'); assert.equal(info.status, 200); assert.equal(await info.text(), '');
  assert.equal(info.headers.get('content-length'), String(f.archive.length));
  const part = await download('GET', 'bytes=3-10'); assert.equal(part.status, 206);
  assert.equal(await part.text(), f.archive.slice(3, 11));
  assert.equal(part.headers.get('content-range'), `bytes 3-10/${f.archive.length}`);
  const suffix = await download('GET', 'bytes=-5'); assert.equal(await suffix.text(), f.archive.slice(-5));
  const rest = await download('GET', 'bytes=5-'); assert.equal(await rest.text(), f.archive.slice(5));
  for (const range of ['bytes=999-', 'bytes=8-3', 'bytes=0-1,3-4', 'bytes=-0', 'items=0-1']) {
    const bad = await download('GET', range); assert.equal(bad.status, 416);
    assert.equal(bad.headers.get('content-range'), `bytes */${f.archive.length}`);
  }
  await f.post(`${admin}/${id}/close`, {}, f.operatorToken);
  assert.equal((await download('GET', 'bytes=3-10')).status, 404);
  assert.equal((await download('HEAD')).status, 404);
});

test('actual static asset routing serves public HTML and modules while API and excluded files remain protected', async t => {
  const directory = await mkdtemp(join(tmpdir(), '127v-worker-assets-'));
  const assets = join(directory, 'site'); await stageAssets(assets);
  const f = await fixture(t, { assetsDirectory: assets });
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const path of ['/', '/get-started', '/access-admin', '/trial', '/trial.mjs', '/site.css']) {
    const response = await f.get(path); assert.equal(response.status, 200, path);
  }
  for (const [from, to] of [['/index.html', '/'], ['/pricing.html', '/pricing'], ['/pricing/', '/pricing'], ['/trial.html', '/trial']]) {
    const response = await f.mf.dispatchFetch(origin + from, { redirect: 'manual' }); assert.equal(response.status, 307, from);
    assert.equal(new URL(response.headers.get('location'), origin).pathname, to);
  }
  for (const path of ['/build-pages.mjs', '/availability.test.mjs', '/README.md', '/mock-checkout.html', '/customer-account.html', '/issuer.pem']) {
    assert.equal((await f.get(path)).status, 404, path);
  }
  assert.equal((await f.get(admin)).status, 401);
  const id = await f.submit(); assert.ok(id); // API routing still invokes the authenticated Worker.
});

test('durable D1/R2 state survives a fresh Worker runtime without issuing another license', async t => {
  const directory = await mkdtemp(join(tmpdir(), '127v-worker-restart-'));
  const f = await fixture(t, { persistDirectory: directory }), id = await f.submit(), a = await f.approve(id);
  const installationId = randomUUID(); await f.post(`${a.base}/activate`, { installationId }, a.token);
  const license = await (await f.get(`${a.base}/license`, a.token)).text();
  await f.dispose();
  const restarted = new Miniflare(f.mfOptions); t.after(() => restarted.dispose());
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { headers: { Authorization: `Bearer ${a.token}` } };
  assert.equal(await (await restarted.dispatchFetch(origin + a.base + '/license', options)).text(), license);
  assert.equal(await (await restarted.dispatchFetch(origin + a.base + '/artifacts/server', options)).text(), f.archive);
  const again = await restarted.dispatchFetch(origin + a.base + '/activate', { method: 'POST', headers: {
    Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}`,
  }, body: JSON.stringify({ installationId }) });
  assert.equal(again.status, 200);
  assert.equal(await (await restarted.dispatchFetch(origin + a.base + '/license', options)).text(), license);
});

test('expired download tickets and invitation links cannot authorize a new request', async t => {
  const f = await fixture(t), id = await f.submit(), a = await f.approve(id);
  const response = await f.post(`${a.base}/ticket`, {}, a.token), cookie = response.headers.get('set-cookie').split(';')[0];
  const download = new Request(origin + a.base + '/artifacts/server', { headers: { Cookie: cookie } });
  assert.equal((await handleRequest(download, f.env, { now: () => Date.now() + 6 * 60000 })).status, 401);
  const expired = new Request(origin + a.base, { headers: { Authorization: `Bearer ${a.token}` } });
  assert.equal((await handleRequest(expired, f.env, { now: () => Date.now() + 31 * 86400000 })).status, 404);
});

test('the runtime bundled with the deployment CLI accepts the same D1/R2 and license flow', async t => {
  const f = await fixture(t, { cliRuntime: true }), id = await f.submit(), a = await f.approve(id);
  const installationId = randomUUID();
  assert.equal((await f.post(`${a.base}/activate`, { installationId }, a.token)).status, 200);
  const license = await (await f.get(`${a.base}/license`, a.token)).text();
  assert.equal(verifyLicenseFile(license, f.publicKeys, installationId).maxActiveUsers, 5);
  assert.equal(await (await f.get(`${a.base}/artifacts/server`, a.token)).text(), f.archive);
});

test('operator key exchange survives refresh via scoped cookie and refuses cross-origin renewal', async t => {
  const f = await fixture(t);
  const response = await f.post('/api/access-admin/session', {}, f.operatorToken);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await f.get(admin, undefined, cookie)).status, 200);
  assert.equal((await f.get(admin, undefined, cookie + 'broken')).status, 401);
  assert.equal((await f.post('/api/access-admin/session', {}, f.operatorToken, 'https://other.example')).status, 403);
  const renew = await f.mf.dispatchFetch(origin + '/api/access-admin/session', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' });
  assert.equal(renew.status, 401);
  const logout = await f.mf.dispatchFetch(origin + '/api/access-admin/logout', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

test('fixed-recipient request alerts are durable, contain only a review summary, and fail without losing the request', async t => {
  const f = await fixture(t); let sent = [], fail = false;
  const env = { ...f.env, REQUEST_ALERT_TO: 'ops@example.com', REQUEST_ALERT_FROM: 'requests@trial.example.com',
    REQUEST_ALERTS: { send: async message => { sent.push(message); if (fail) throw Error('private-provider-error'); return { messageId: 'synthetic-accepted' }; } } };
  const submit = input => handleRequest(new Request(origin + '/api/waitlist', { method: 'POST', headers: {
    Origin: origin, 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.10' }, body: JSON.stringify(input) }), env);
  const response = await submit(f.requestInput); assert.equal(response.status, 202);
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'ops@example.com');
  assert.ok(sent[0].text.includes(f.requestInput.email)); assert.ok(sent[0].text.includes(origin + '/access-admin'));
  assert.ok(!sent[0].text.includes(f.operatorToken)); assert.doesNotMatch(sent[0].text, /\/trial(?:\.html)?(?:\?|#)/);
  let inbox = (await (await f.get(admin, f.operatorToken)).json()).requests;
  assert.equal(inbox[0].requestAlertState, 'accepted');
  await submit({ ...f.requestInput, website: 'bot trap' }); assert.equal(sent.length, 1);
  fail = true;
  assert.equal((await submit({ ...f.requestInput, email: 'another@example.com' })).status, 202);
  inbox = (await (await f.get(admin, f.operatorToken)).json()).requests;
  assert.equal(inbox.find(row => row.email === 'another@example.com').requestAlertState, 'unconfirmed');
  assert.equal(inbox.length, 2);
});

test('a request alert cannot overwrite a concurrent approval or resend an ambiguous attempt', async t => {
  const f=await fixture(t);let announce,finish,sends=0;
  const reached=new Promise(resolve=>{announce=resolve}),gate=new Promise(resolve=>{finish=resolve});
  const env={...f.env,REQUEST_ALERT_TO:'ops@example.com',REQUEST_ALERT_FROM:'requests@trial.example.com',REQUEST_ALERTS:{send:async()=>{sends++;announce();await gate;return{messageId:'synthetic'}}}};
  const pending=handleRequest(new Request(origin+'/api/waitlist',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(f.requestInput)}),env);
  await reached;
  const row=(await(await f.get(admin,f.operatorToken)).json()).requests[0];
  await f.approve(row.id);finish();assert.equal((await pending).status,202);
  const after=(await(await f.get(admin,f.operatorToken)).json()).requests[0];
  assert.equal(after.state,'approved');assert.equal(after.requestAlertState,'accepted');
  const store=new TrialStore(f.db,await encryptionKey(f.intakeKey,'contacts'),await encryptionKey(f.intakeKey,'trials'));
  const {notifyNewAccessRequest}=await import('../src/request-alerts.mjs');
  await notifyNewAccessRequest(env,store,row.id,f.requestInput,Date.now());
  assert.equal(sends,1);
});


test('existing links follow latest entitled major, retain license, and never cross majors', async t => {
  const f = await fixture(t), id = await f.submit(), a = await f.approve(id), installationId = randomUUID();
  await f.post(`${a.base}/activate`, { installationId }, a.token);
  const license = await (await f.get(`${a.base}/license`, a.token)).text();
  const swap = async catalogue => {
    const source = JSON.stringify(catalogue);
    await f.bucket.put(f.bindings.TRIAL_CATALOGUE_KEY, source);
    f.env.TRIAL_CATALOGUE_SHA256 = createHash('sha256').update(source).digest('hex');
  };
  const get = path => handleRequest(new Request(origin + path, { headers: { Authorization: `Bearer ${a.token}` } }), f.env);
  const patch = { ...f.catalogue, sourceRevision: 'c'.repeat(40), serverMajorVersion: 0 };
  await swap(patch);
  assert.equal((await (await get(a.base)).json()).sourceRevision, patch.sourceRevision);
  assert.equal(await (await get(`${a.base}/license`)).text(), license);
  assert.equal(await (await get(`${a.base}/artifacts/server`)).text(), f.archive);
  assert.equal((await get(a.base.replace(id, 'f'.repeat(64)))).status, 404);
  const oldSource = JSON.stringify(patch), oldKey = 'releases/major-0/catalogue.json';
  await f.bucket.put(oldKey, oldSource);
  await swap({ ...f.catalogue, serverMajorVersion: 1, sourceRevision: 'd'.repeat(40), previousMajors: [
    { majorVersion: 0, objectKey: oldKey, sha256: createHash('sha256').update(oldSource).digest('hex') }
  ] });
  assert.equal((await (await get(a.base)).json()).sourceRevision, patch.sourceRevision);
  assert.equal(await (await get(`${a.base}/license`)).text(), license);
  await swap({ ...f.catalogue, serverMajorVersion: 2 });
  const blocked = await get(a.base);
  assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error, 'licensed_major_unavailable');
  // A major-1 entitlement follows major-1 while major-2 is the default catalogue.
  const store = new TrialStore(f.db, await encryptionKey(f.intakeKey, 'contacts'), await encryptionKey(f.intakeKey, 'trials'));
  const row = await store.get(id); await store.save(row, { ...row.trial, serverMajorVersion: 1 });
  const v1 = { ...f.catalogue, serverMajorVersion: 1, sourceRevision: 'e'.repeat(40) }, source = JSON.stringify(v1);
  await f.bucket.put('releases/major-1/catalogue.json', source);
  await swap({ ...f.catalogue, serverMajorVersion: 2, previousMajors: [{ majorVersion: 1,
    objectKey: 'releases/major-1/catalogue.json', sha256: createHash('sha256').update(source).digest('hex') }] });
  assert.equal((await (await get(a.base)).json()).sourceRevision, v1.sourceRevision);
  await f.bucket.put('releases/major-1/catalogue.json', JSON.stringify({ ...v1, serverMajorVersion: 2 }));
  assert.equal((await get(a.base)).status, 503);
});


test('new major-1 approvals pin major 1 and rotation cannot upgrade entitlement', async t => {
  const f = await fixture(t), id = await f.submit();
  const swap = async catalogue => {
    const source = JSON.stringify(catalogue); await f.bucket.put(f.bindings.TRIAL_CATALOGUE_KEY, source);
    f.env.TRIAL_CATALOGUE_SHA256 = createHash('sha256').update(source).digest('hex');
  };
  const post = (path, input) => handleRequest(new Request(origin + path, { method: 'POST', headers: {
    Authorization: `Bearer ${f.operatorToken}`, Origin: origin, 'Content-Type': 'application/json'
  }, body: JSON.stringify(input) }), f.env);
  const v1 = { ...f.catalogue, serverMajorVersion: 1 };
  await swap(v1);
  const approval = await post(`${admin}/${id}/approve`, { maxUsers: 2 });
  assert.equal(approval.status, 200);
  const a = await approval.json(); assert.equal(a.serverMajorVersion, 1);
  const source = JSON.stringify(v1), objectKey = 'releases/v1/catalogue.json'; await f.bucket.put(objectKey, source);
  await swap({ ...f.catalogue, serverMajorVersion: 2, previousMajors: [{ majorVersion: 1, objectKey,
    sha256: createHash('sha256').update(source).digest('hex') }] });
  const rotated = await post(`${admin}/${id}/rotate`, {});
  assert.equal(rotated.status, 200); assert.equal((await rotated.json()).serverMajorVersion, 1);
  await swap({ ...f.catalogue, serverMajorVersion: 2 });
  assert.equal((await post(`${admin}/${id}/update-release`, {})).status, 409);
});


test('operator session opens release review and downloads without creating or activating a trial', async t => {
  const retiredKey = randomBytes(32).toString('base64url');
  const f = await fixture(t, { bindings: { REVIEWER_TOKEN: retiredKey, REVIEWER_ACCESS_ENABLED: 'true' } });
  assert.equal((await f.get('/api/access-admin/releases')).status, 401);
  assert.equal((await f.get('/api/access-admin/releases', retiredKey)).status, 401);
  assert.equal((await f.post('/api/access-admin/session', {}, retiredKey)).status, 401);
  const login = await f.post('/api/access-admin/session', {}, f.operatorToken);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const metadata = await (await f.get('/api/access-admin/releases', null, cookie)).json();
  assert.equal(metadata.canDownload, true); assert.equal(metadata.artifacts[0].objectKey, undefined);
  assert.equal(await (await f.get('/api/access-admin/releases/artifacts/server', null, cookie)).text(), f.archive);
  assert.equal((await f.get('/api/access-admin/releases/artifacts/server')).status, 401);
  const expired = await handleRequest(new Request(origin + '/api/access-admin/releases', { headers: { Cookie: cookie } }), f.env,
    { now: () => Date.now() + 3601000 });
  assert.equal(expired.status, 401);
  assert.equal((await (await f.get(admin, f.operatorToken)).json()).requests.length, 0);
});


test('self-service replacement request revokes old license; owner issues a new binding without renewal', async t => {
  const reviewer = randomBytes(32).toString('base64url');
  const f = await fixture(t, { bindings: { REVIEWER_TOKEN: reviewer, REVIEWER_ACCESS_ENABLED: 'true' } }), id = await f.submit(), a = await f.approve(id);
  const oldId = randomUUID(), newId = randomUUID();
  const request = { installationId: newId, reason: 'Lost server identity in a test machine failure', retired: true };
  assert.equal((await f.post(`${a.base}/replacement-request`, request, a.token)).status, 409);
  await f.post(`${a.base}/activate`, { installationId: oldId }, a.token);
  const original = verifyLicenseFile(await (await f.get(`${a.base}/license`, a.token)).text(), f.publicKeys, oldId);
  assert.equal((await f.post(`${a.base}/replacement-request`, { ...request, retired: false }, a.token)).status, 400);
  assert.equal((await f.post(`${a.base}/replacement-request`, { ...request, installationId: oldId }, a.token)).status, 409);
  assert.equal((await f.post(`${a.base}/replacement-request`, request)).status, 401);
  let alerts = 0;
  f.env.REQUEST_ALERT_TO = 'operator@example.com'; f.env.REQUEST_ALERT_FROM = 'requests@trial.example.com';
  f.env.REQUEST_ALERTS = { send: async message => { alerts++; assert.equal(message.to, 'operator@example.com');
    assert.match(message.subject, /replacement license requested/); assert.ok(!message.text.includes(a.token)); return { messageId: 'replacement-test' }; } };
  const requested = await handleRequest(new Request(origin + a.base + '/replacement-request', { method: 'POST',
    headers: { Authorization: `Bearer ${a.token}`, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(request) }), f.env);
  assert.equal(alerts, 1);
  assert.equal(requested.status, 202);
  assert.equal((await requested.json()).replacementRequest.installationId, newId);
  assert.equal((await f.post(`${a.base}/replacement-request`, request, a.token)).status, 409);
  assert.equal((await f.get(`${a.base}/license`, a.token)).status, 409);
  assert.equal((await f.post(`${a.base}/activate`, { installationId: oldId }, a.token)).status, 409);
  const revocation = await (await f.get(`${a.base}/replacement-revocation`, a.token)).text();
  verifyLicenseRevocationFile(revocation, f.publicKeys, oldId, original.licenseId);
  assert.equal((await f.post(`${admin}/${id}/replace-installation`, { installationId: newId, retired: true }, reviewer)).status, 401);
  assert.equal((await f.post(`${admin}/${id}/replace-installation`, { installationId: randomUUID(), retired: true }, f.operatorToken)).status, 400);
  const expiredApproval = await handleRequest(new Request(origin + admin + '/' + id + '/replace-installation', { method: 'POST',
    headers: { Authorization: `Bearer ${f.operatorToken}`, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId: newId, retired: true }) }), f.env, { now: () => Date.parse(original.expiresAt) + 1000 });
  assert.equal(expiredApproval.status, 409); assert.equal((await expiredApproval.json()).error, 'license_expired');
  const issued = await f.post(`${admin}/${id}/replace-installation`, { installationId: newId, retired: true }, f.operatorToken);
  assert.equal(issued.status, 200, await issued.clone().text());
  const state = await issued.json(); assert.equal(state.installationId, newId); assert.equal(state.replacementCount, 1);
  assert.equal(state.replacementRequest, null); assert.equal(state.expiresAt, original.expiresAt);
  const next = verifyLicenseFile(await (await f.get(`${a.base}/license`, a.token)).text(), f.publicKeys, newId);
  assert.equal(next.expiresAt, original.expiresAt); assert.equal(next.maxActiveUsers, original.maxActiveUsers);
  assert.equal(next.plan, original.plan); assert.equal(next.majorVersion, original.majorVersion);
  assert.equal(next.sequence, original.sequence + 1); assert.notEqual(next.licenseId, original.licenseId);
  assert.equal((await f.post(`${a.base}/activate`, { installationId: oldId }, a.token)).status, 409);
  assert.equal(await (await f.get(`${a.base}/replacement-revocation`, a.token)).text(), revocation);
  assert.equal(await (await f.get(`${admin}/${id}/revocation`, f.operatorToken)).text(), revocation);
  const invitation = await (await f.get(`${admin}/${id}/invitation`, f.operatorToken)).json();
  assert.match(invitation.message, /replacement license/i); assert.ok(invitation.message.includes(a.token));
  const future = Date.parse(original.expiresAt) + 1000;
  const expiredRequest = await handleRequest(new Request(origin + a.base + '/replacement-request', { method: 'POST',
    headers: { Authorization: `Bearer ${a.token}`, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, installationId: randomUUID() }) }), f.env, { now: () => future });
  assert.equal(expiredRequest.status, 409); assert.equal((await expiredRequest.json()).error, 'license_expired');
});
