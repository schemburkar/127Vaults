import { validateRequest } from '../src/validate-request.mjs';
import { validIntakeOrigin } from '../src/intake-origin.mjs';
import { createCloudflareTrialMailer } from '../src/cloudflare-email.mjs';
import { encryptionKey, limiterKey, equal, hash, issuer, signEnvelope, token, from64 } from './crypto.mjs';
import { TrialStore, Conflict } from './store.mjs';
import { validateCatalogue, catalogueIdentity, publicArtifact } from './catalogue.mjs';
import { byteRange } from './download.mjs';

const day = 86400000;
// Cache only imported keys, never request-bound D1 sessions, R2 objects or mutable trial state.
const keyCache = new WeakMap(), issuerCache = new WeakMap();
const security = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (status, value, extra = {}) => new Response(JSON.stringify(value), {
  status, headers: { ...security, 'Content-Type': 'application/json; charset=utf-8', ...extra },
});
const attachment = (filename, value) => new Response(value, { headers: { ...security,
  'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${filename}"` } });
class HttpError extends Error { constructor(status, code) { super(code); this.status = status; } }
const fail = (status, code) => { throw new HttpError(status, code); };
async function body(request) {
  if (Number(request.headers.get('content-length')) > 2048) fail(413, 'too_large');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'invalid_request');
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); fail(413, 'too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  let value; try { value = JSON.parse(new TextDecoder().decode(all)); } catch { fail(400, 'invalid_request'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_request');
  return value;
}
const empty = input => { if (Object.keys(input).length) fail(400, 'invalid_request'); };
function summary(record, mailer) {
  return { state: record?.state ?? 'requested', maxUsers: record?.maxUsers, archivedAt: record?.archivedAt ?? null,
    approvedAt: record?.approvedAt, linkExpiresAt: record?.linkExpiresAt, emailState: record?.emailState ?? 'not_sent',
    emailAttemptedAt: record?.emailAttemptedAt, canSendEmail: Boolean(mailer && record?.invitation && !record.emailState),
    canPreviewInvitation: Boolean(record?.invitation), activatedAt: record?.activatedAt,
    expiresAt: record?.expiresAt, installationId: record?.installationId };
}
async function setup(env, now) {
  if (!validIntakeOrigin(env.PUBLIC_INTAKE_ORIGIN) || !/^[A-Za-z0-9_-]{43,128}$/.test(env.OPERATOR_TOKEN ?? '')
    || !/^[A-Za-z0-9_-]{1,40}$/.test(env.TRIAL_ISSUER_KEY_ID ?? '') || !env.DB || !env.ARTIFACTS) throw Error('Configuration incomplete');
  if (!keyCache.has(env)) keyCache.set(env, Promise.all([
    encryptionKey(env.INTAKE_KEY, 'contacts'), encryptionKey(env.INTAKE_KEY, 'trials'), limiterKey(env.INTAKE_KEY),
  ]));
  const [contactKey, trialKey, limits] = await keyCache.get(env);
  return new TrialStore(env.DB, contactKey, trialKey, now, limits);
}
async function release(env) {
  // Catalogue key is pinned in each deployment, never supplied by a visitor.
  const object = await env.ARTIFACTS.get(env.TRIAL_CATALOGUE_KEY);
  if (!object || object.size > 256000) throw Error('Catalogue unavailable');
  const source = await object.text();
  if (!/^[a-f0-9]{64}$/.test(env.TRIAL_CATALOGUE_SHA256 ?? '') || await hash(source) !== env.TRIAL_CATALOGUE_SHA256) throw Error('Catalogue integrity mismatch');
  const catalogue = validateCatalogue(JSON.parse(source));
  const publicKey = catalogue.issuerPublicKeys[env.TRIAL_ISSUER_KEY_ID];
  let cached = issuerCache.get(env);
  if (!cached || cached.publicKey !== publicKey) {
    cached = { publicKey, promise: issuer(env.TRIAL_ISSUER_PRIVATE_KEY, publicKey) }; issuerCache.set(env, cached);
  }
  const signingKey = await cached.promise;
  return { catalogue, publicKey, signingKey, identity: await catalogueIdentity(catalogue) };
}
function mailerFor(env) {
  // Wrangler retains omitted secrets on updates. Removing the sender disables email even if the old token remains.
  if (!env.TRIAL_EMAIL_FROM) return null;
  return createCloudflareTrialMailer({ accountId: env.CF_ACCOUNT_ID,
    apiToken: env.TRIAL_EMAIL_API_TOKEN, from: env.TRIAL_EMAIL_FROM });
}
async function revoke(record, env, signingKey, at) {
  if (record?.license && !record.revocation) {
    const payload = JSON.parse(new TextDecoder().decode(from64(JSON.parse(record.license).payload)));
    record.revocation = await signEnvelope(signingKey, env.TRIAL_ISSUER_KEY_ID, '127Vaults license revocation v1', {
      revocationId: crypto.randomUUID(), installationId: record.installationId, licenseId: payload.licenseId,
      issuedAt: new Date(at).toISOString(), revokedAt: new Date(at).toISOString(),
    });
  }
}
function close(record, at) {
  const next = { ...record, state: 'closed', closedAt: new Date(at).toISOString(), tokenHash: null, ticketHash: null, ticketUntil: 0 };
  delete next.invitation;
  return next;
}
async function dispatch(request, env, now) {
  const url = new URL(request.url), path = url.pathname;
  if (url.origin !== env.PUBLIC_INTAKE_ORIGIN) fail(403, 'forbidden');
  if (!path.startsWith('/api/')) {
    if (!['GET', 'HEAD'].includes(request.method)) fail(405, 'method_not_allowed');
    return env.ASSETS.fetch(request);
  }
  const artifactHead = request.method === 'HEAD' && /^\/api\/trials\/[a-f0-9]{64}\/artifacts\/[a-z0-9-]+$/.test(path);
  if (!['GET', 'POST'].includes(request.method) && !artifactHead) fail(405, 'method_not_allowed');
  if (request.method === 'POST' && (request.headers.get('origin') !== env.PUBLIC_INTAKE_ORIGIN
    || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')) fail(403, 'forbidden');
  const store = await setup(env, now), at = now();
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const bearer = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (path === '/api/waitlist') {
    if (request.method === 'GET') return json(200, { open: true });
    if (!await store.allow('waitlist-ip', ip, 60, 3600000)) fail(429, 'rate_limited');
    const input = validateRequest(await body(request));
    if (!input) fail(400, 'invalid_request');
    if (!await store.allow('waitlist-email', input.email, 3, 3600000)) fail(429, 'rate_limited');
    if (!input.trapped) {
      const { trapped: _, ...contact } = input;
      await store.insert(await hash(token()), { ...contact, receivedAt: new Date(at).toISOString() });
    }
    return json(202, { received: true });
  }
  const admin = path.startsWith('/api/access-admin/');
  if (!admin && !path.startsWith('/api/trials/')) fail(404, 'not_found');
  if (admin && !await equal(bearer, env.OPERATOR_TOKEN)) {
    if (!await store.allow('admin-auth', ip, 20, 3600000)) fail(429, 'rate_limited');
    fail(401, 'access_required');
  }
  // Bound trial guessing and abusive downloads, without exposing contact identifiers in the limiter.
  if (!admin && !await store.allow('trial-ip', ip, 600, 3600000)) fail(429, 'rate_limited');
  const mailer = mailerFor(env);
  if (path === '/api/access-admin/readiness' && request.method === 'GET') {
    const { catalogue } = await release(env);
    const asset = catalogue.artifacts.find(value => value.id === 'server');
    const object = await env.ARTIFACTS.head(asset.objectKey);
    if (!object || object.etag !== asset.etag || object.size !== asset.sizeBytes || object.customMetadata?.sha256 !== asset.sha256) fail(503, 'artifact_changed');
    return json(200, { ready: true, sourceRevision: catalogue.sourceRevision, artifacts: catalogue.artifacts.length });
  }
  if (path === '/api/access-admin/requests' && request.method === 'GET') {
    return json(200, { requests: (await store.list()).filter(row => at - row.receivedAt < 90 * day)
      .map(row => ({ ...row.contact, id: row.id, ...summary(row.trial, mailer) })), emailEnabled: Boolean(mailer),
      sourceRevision: env.TRIAL_SOURCE_REVISION });
  }
  const match = /^\/api\/(access-admin\/requests|trials)\/([a-f0-9]{64})(?:\/(approve|rotate|archive|unarchive|invitation|send-invitation|close|reject|erase|revocation|activate|license|public-keys|ticket|artifacts\/[a-z0-9-]+))?$/.exec(path);
  if (!match) fail(404, 'not_found');
  const [, , id, action] = match;
  const row = await store.get(id); let record = row?.trial;
  const input = request.method === 'POST' ? await body(request) : null;
  if (admin) {
    if (!row?.contact || at - row.receivedAt >= 90 * day) fail(404, 'not_found');
    if (action === 'invitation' && request.method === 'GET' && record?.state === 'approved' && record.invitation) {
      return json(200, { email: row.contact.email, subject: record.invitation.subject, message: record.invitation.text });
    }
    if (action === 'revocation' && request.method === 'GET' && record?.revocation) return attachment('trial-revocation.json', record.revocation);
    if (request.method !== 'POST') fail(405, 'method_not_allowed');
    if (action === 'archive' || action === 'unarchive') {
      empty(input); record = { state: 'requested', ...record, archivedAt: action === 'archive' ? new Date(at).toISOString() : null };
    } else if (action === 'approve' || action === 'rotate') {
      if ((action === 'approve' && record && record.state !== 'requested') || (action === 'rotate' && record?.state !== 'approved')) fail(409, 'state_changed');
      if (action === 'approve') {
        if (!['personal', 'commercial'].includes(row.contact.plan)) fail(409, 'plan_unavailable');
        if (Object.keys(input).join(',') !== 'maxUsers' || !Number.isSafeInteger(input.maxUsers) || input.maxUsers < 1 || input.maxUsers > 100) fail(400, 'invalid_request');
      } else empty(input);
      const { catalogue, identity } = await release(env);
      if (record?.releaseHash && record.releaseHash !== identity) fail(409, 'release_changed_contact_operator');
      const value = token();
      record = { ...record, state: 'approved', maxUsers: record?.maxUsers ?? input.maxUsers,
        approvedAt: record?.approvedAt ?? new Date(at).toISOString(), payment: 'none', trialDays: 10,
        tokenHash: await hash(value), linkExpiresAt: new Date(at + 30 * day).toISOString(),
        ticketHash: null, ticketUntil: 0, sourceRevision: catalogue.sourceRevision, releaseHash: identity };
      const link = `${env.PUBLIC_INTAKE_ORIGIN}/trial.html#${id}.${value}`;
      record.invitation = { subject: 'Your private 10-day 127Vaults trial',
        text: `Your unpaid 127Vaults trial is ready. Open your private link:\n${link}\n\nDownload the server and clients, then activate one server installation. Your 10-day trial starts at activation. No payment or subscription is created. Use fictitious data only. The link is private; please do not forward it.\n\nAfter 10 days, server writes stop under the existing read-only policy; your encrypted data is preserved.` };
      delete record.emailState; delete record.emailAttemptedAt; delete record.emailAttemptId;
      await store.save(row, record);
      return json(200, { ...summary(record, mailer), link, email: row.contact.email, subject: record.invitation.subject, message: record.invitation.text });
    } else if (action === 'send-invitation') {
      empty(input);
      if (!mailer) fail(503, 'email_not_configured');
      const { identity } = await release(env);
      if (record?.state !== 'approved' || !record.invitation || at >= Date.parse(record.linkExpiresAt) || record.releaseHash !== identity) fail(409, 'invitation_unavailable');
      if (record.emailState) fail(409, 'email_already_attempted');
      if (!await store.allow('trial-email', id, 3, 3600000)) fail(429, 'rate_limited');
      const attempt = crypto.randomUUID();
      record = { ...record, emailState: 'sending', emailAttemptId: attempt, emailAttemptedAt: new Date(at).toISOString() };
      await store.save(row, record); // Claim durably before external I/O; never auto-resend an ambiguous attempt.
      let state = 'unknown';
      try { const result = await mailer.sendInvitation({ to: row.contact.email, ...record.invitation });
        if (['accepted', 'queued', 'bounced'].includes(result?.state)) state = result.state;
      } catch { /* An interrupted send remains explicit and cannot be retried automatically. */ }
      const fresh = await store.get(id);
      if (fresh?.trial?.emailAttemptId === attempt && fresh.trial.state === 'approved') {
        try { await store.save(fresh, { ...fresh.trial, emailState: state }); } catch (error) { if (!(error instanceof Conflict)) throw error; }
      }
      return json(200, summary((await store.get(id))?.trial, mailer));
    } else {
      if (!['close', 'reject', 'erase'].includes(action)) fail(404, 'not_found');
      empty(input);
      if (action === 'reject' && record?.license) fail(409, 'close_activated_trial');
      record = { ...record };
      if (record.license && !record.revocation) {
        const { signingKey } = await release(env); await revoke(record, env, signingKey, at);
      }
      record = close(record, at);
      if (action === 'reject') record.state = 'rejected';
    }
    await store.save(row, record, action === 'erase');
    return json(200, { ...summary(record, mailer), hasRevocation: Boolean(record.revocation), installedLicenseUnaffected: Boolean(record.license) });
  }
  if (!record || record.state !== 'approved' || at >= Date.parse(record.linkExpiresAt) || !row.contact || at - row.receivedAt >= 90 * day) fail(404, 'link_unavailable');
  const { catalogue, identity, publicKey, signingKey } = await release(env);
  if (record.releaseHash !== identity) fail(409, 'release_changed_contact_operator');
  const cookie = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith('__Secure-127v-trial='))?.slice('__Secure-127v-trial='.length);
  const ticketValid = action?.startsWith('artifacts/') && ['GET', 'HEAD'].includes(request.method) && record.ticketHash
    && at < record.ticketUntil && await equal(await hash(cookie ?? ''), record.ticketHash);
  if (!ticketValid && (!bearer || !await equal(await hash(bearer), record.tokenHash))) fail(401, 'access_required');
  if (!action && request.method === 'GET') return json(200, { ...summary(record, mailer), trialDays: 10, payment: 'none',
    sourceRevision: catalogue.sourceRevision, artifacts: catalogue.artifacts.map(publicArtifact) });
  if (action === 'ticket' && request.method === 'POST') {
    empty(input); const value = token(); record = { ...record, ticketHash: await hash(value), ticketUntil: at + 300000 };
    await store.save(row, record);
    return json(200, { ready: true }, { 'Set-Cookie': `__Secure-127v-trial=${value}; Path=/api/trials/${id}/artifacts/; Max-Age=300; Secure; HttpOnly; SameSite=Strict` });
  }
  if (action === 'activate' && request.method === 'POST') {
    if (Object.keys(input).join(',') !== 'installationId' || typeof input.installationId !== 'string'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.installationId)) fail(400, 'invalid_request');
    const installationId = input.installationId.toLowerCase();
    if (record.license && record.installationId !== installationId) fail(409, 'already_bound');
    if (!record.license) {
      const issuedAt = new Date(at).toISOString(), expiresAt = new Date(at + 10 * day).toISOString();
      record = { ...record, installationId, activatedAt: issuedAt, expiresAt,
        license: await signEnvelope(signingKey, env.TRIAL_ISSUER_KEY_ID, '127Vaults license v1', {
          licenseId: crypto.randomUUID(), installationId, plan: 'commercial', majorVersion: null,
          maxActiveUsers: record.maxUsers, issuedAt, notBefore: issuedAt, expiresAt, sequence: 1,
        }) };
      await store.save(row, record);
    }
    return json(200, summary(record, mailer));
  }
  if (action === 'license' && request.method === 'GET' && record.license) return attachment('trial-license.json', record.license);
  if (action === 'public-keys' && request.method === 'GET') return attachment('trial-issuer-keys.json', JSON.stringify({ [env.TRIAL_ISSUER_KEY_ID]: publicKey }, null, 2));
  if (action?.startsWith('artifacts/') && ['GET', 'HEAD'].includes(request.method)) {
    const asset = catalogue.artifacts.find(v => v.id === action.slice(10)); if (!asset) fail(404, 'not_found');
    let range;
    try { range = artifactHead ? null : byteRange(request.headers.get('range'), asset.sizeBytes); }
    catch { return json(416, { error: 'invalid_range' }, { 'Content-Range': `bytes */${asset.sizeBytes}` }); }
    // Conditional R2 GET pins the exact upload verified by the deployment script, without hashing an 835 MB file per request.
    const object = artifactHead ? await env.ARTIFACTS.head(asset.objectKey)
      : await env.ARTIFACTS.get(asset.objectKey, { onlyIf: { etagMatches: asset.etag }, ...(range ? { range } : {}) });
    if (!object || (!artifactHead && !('body' in object)) || object.etag !== asset.etag
      || object.size !== asset.sizeBytes || object.customMetadata?.sha256 !== asset.sha256) fail(503, 'artifact_changed');
    return new Response(artifactHead ? null : object.body, { status: range ? 206 : 200, headers: { ...security,
      'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'ETag': `"${asset.etag}"`,
      ...(range ? { 'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${asset.sizeBytes}` } : {}),
      'Content-Length': String(range ? range.length : asset.sizeBytes), 'Content-Disposition': `attachment; filename="${asset.filename}"` } });
  }
  fail(404, 'not_found');
}
export async function handleRequest(request, env, { now = () => Date.now() } = {}) {
  try { return await dispatch(request, env, now); }
  catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    if (error instanceof Conflict) return json(409, { error: 'state_changed' });
    // Never include keys, contact data, links or provider errors in public responses or logs.
    return json(503, { error: 'unavailable' });
  }
}
export async function prune(env, { now = () => Date.now() } = {}) {
  const store = await setup(env, now);
  let signingKey;
  for (const row of await store.expiredContacts()) {
    const record = { ...row.trial };
    if (record.license && !record.revocation) {
      signingKey ??= (await release(env)).signingKey;
      await revoke(record, env, signingKey, now());
    }
    try { await store.save(row, close(record, now()), true); } catch (error) { if (!(error instanceof Conflict)) throw error; }
  }
  await store.pruneLimits();
}
export default { fetch: handleRequest, scheduled: (_event, env, ctx) => ctx.waitUntil(prune(env)) };
