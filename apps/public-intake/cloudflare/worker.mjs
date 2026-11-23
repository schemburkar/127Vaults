import { clientGrant, clientArtifact } from './client-downloads.mjs';
import { compatiblePersonalMajor } from '../../server/src/license-version.mjs';
import { validateRequest } from '../src/validate-request.mjs';
import { validIntakeOrigin } from '../src/intake-origin.mjs';
import { createCloudflareTrialMailer } from '../src/cloudflare-email.mjs';
import { encryptionKey, limiterKey, equal, hash, issuer, signEnvelope, token, from64, verifyLicenseIssuer } from './crypto.mjs';
import { TrialStore, Conflict } from './store.mjs';
import { validateCatalogue, catalogueIdentity, publicArtifact, serverMajor } from './catalogue.mjs';
import { byteRange } from './download.mjs';
import { installerPolicy, installerProtocol } from './installer.mjs';
import { developmentPolicy } from './development.mjs';
import { createOperatorSession, validOperatorSession, revokeOperatorSession, clearOperatorSession } from '../src/operator-session.mjs';
import { notifyNewAccessRequest, notifyRequestVolume, requestAlertsEnabled } from '../src/request-alerts.mjs';
import { BillingError, paidPersonalAccess } from './dodo.mjs';
import { billingWebhook, handleBilling, reconcileBilling, issuePersonalLicense, claimPersonalConversion } from './billing.mjs';
import { handleCustomerPortal, customerCanAccess, customerInstallerGrant, pruneCustomerPortal, manualCustomerMail } from './customer-portal.mjs';
import { resendCustomerEmailEnabled, sendCustomerEmail, pruneCustomerEmail } from './customer-email.mjs';

const day = 86400000;
const activeDevelopment = (record,at) => record?.kind === 'development' && record.state === 'approved'
  && Date.parse(record.entitlementExpiresAt) > at;
const activeExtension = (record,at) => record?.state === 'approved' && record.extendedAt && Date.parse(record.expiresAt) > at;
const retained = (row,at) => at - row.receivedAt < 90 * day || Boolean(row.trial?.billing) || activeDevelopment(row.trial,at) || activeExtension(row.trial,at);
const installationUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
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
    approvedAt: record?.approvedAt, kind: record?.kind ?? 'trial', entitlementExpiresAt: record?.entitlementExpiresAt,
    linkExpiresAt: record?.linkExpiresAt, emailState: record?.emailState ?? 'not_sent',
    emailAttemptedAt: record?.emailAttemptedAt, canSendEmail: Boolean(mailer && record?.invitation && !record.emailState && !record.replacementRequest
      && (mailer.provider !== 'resend' || record.kind !== 'development')),
    canResendEmail: Boolean(mailer && record?.invitation && record.emailState && !record.replacementRequest && !['sending', 'claimed', 'unknown', 'unconfirmed'].includes(record.emailState) && (mailer.provider !== 'resend' || record.kind !== 'development')),
    canPreviewInvitation: Boolean(record?.invitation), activatedAt: record?.activatedAt,
    serverMajorVersion: record?.state === 'approved' ? entitledMajor(record) : undefined,
    expiresAt: record?.expiresAt, installationId: record?.installationId, sourceRevision: record?.sourceRevision, upgradeOfferedAt: record?.upgradeOfferedAt,
    replacementRequest: record?.replacementRequest ? { installationId: record.replacementRequest.installationId, requestedAt: record.replacementRequest.requestedAt, reason: record.replacementRequest.reason } : null,
    replacementCount: record?.replacementCount ?? 0,
    billingStatus: record?.billing?.status ?? null, billingMode: record?.billing?.mode ?? null, billingPaidThrough: record?.billing?.paidThrough ?? null, billingLastCheckedAt: record?.billing?.lastCheckedAt ?? null,
    requestAlertState: record?.requestAlertState, requestAlertAttemptedAt: record?.requestAlertAttemptedAt };
}
async function setup(env, now) {
  if (!validIntakeOrigin(env.PUBLIC_INTAKE_ORIGIN, env.LOCAL_SITE_PREVIEW === '1') || (env.SITE_SURFACE !== 'customer' && !/^[A-Za-z0-9_-]{43,128}$/.test(env.OPERATOR_TOKEN ?? ''))
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
// All pre-entitlement trial records were issued for experimental server major 0.
const entitledMajor = record => record?.serverMajorVersion ?? 0;
async function entitledRelease(env, record) {
  const current = await release(env), major = entitledMajor(record);
  let selected = current;
  const matches = candidate => record?.kind === 'personal-purchase' ? compatiblePersonalMajor(major, candidate) : candidate === major;
  if (!matches(serverMajor(current.catalogue))) {
    const channel = current.catalogue.previousMajors?.slice().sort((a, b) => b.majorVersion - a.majorVersion).find(v => matches(v.majorVersion));
    if (!channel) fail(409, 'licensed_major_unavailable');
    selected = await release({ ...env, TRIAL_CATALOGUE_KEY: channel.objectKey, TRIAL_CATALOGUE_SHA256: channel.sha256 });
    if (!matches(serverMajor(selected.catalogue))) fail(503, 'catalogue_major_mismatch');
  }
  if (record?.license && !await verifyLicenseIssuer(record.license, selected.catalogue.issuerPublicKeys)) fail(409, 'license_issuer_changed');
  return selected;
}
function mailerFor(env) {
  if (env.CUSTOMER_EMAIL_PROVIDER === 'resend') return resendCustomerEmailEnabled(env) ? { provider: 'resend' } : null;
  // Wrangler retains omitted secrets on updates. Removing the sender disables email even if the old token remains.
  if (!env.TRIAL_EMAIL_FROM) return null;
  return createCloudflareTrialMailer({ accountId: env.CF_ACCOUNT_ID,
    apiToken: env.TRIAL_EMAIL_API_TOKEN, from: env.TRIAL_EMAIL_FROM });
}
export function customerInvitation(invitation, env) {
  if (!invitation || !env.CUSTOMER_ORIGIN || !env.PUBLIC_SITE_ORIGIN) return invitation;
  return { ...invitation, text: invitation.text.replace(/https:\/\/[^\s]+/g, value => {
    try {
      const url = new URL(value);
      if (url.origin !== env.PUBLIC_SITE_ORIGIN || !['/trial', '/trial.html'].includes(url.pathname)) return value;
      return env.CUSTOMER_ORIGIN + url.pathname + url.search + url.hash;
    } catch { return value; }
  }) };
}
async function sendResendInvitation(env, store, row, record, at, resendId = null) {
  if (!resendCustomerEmailEnabled(env) || record?.kind === 'development' || !record?.invitation) return { state: 'suppressed' };
  const current = await store.get(row.id);
  if (!current?.contact || current.trial?.state !== 'approved' || current.trial?.tokenHash !== record.tokenHash
    || current.trial?.invitation?.text !== record.invitation.text) return { state: 'suppressed' };
  const invitation = customerInvitation(record.invitation, env);
  const result = await sendCustomerEmail(env, store, { requestId: row.id, event: await hash(JSON.stringify(invitation)) + (resendId ? ':' + resendId : ''), purpose: 'invitation',
    message: { to: row.contact.email, ...invitation }, recordKind: record.kind });
  if (result.state !== 'already_attempted' && result.state !== 'suppressed') {
    const fresh = await store.get(row.id);
    if (fresh?.contact && fresh.trial?.tokenHash === record.tokenHash && fresh.trial?.invitation?.text === record.invitation.text) {
      try { await store.save(fresh, { ...fresh.trial, emailState: result.state, emailAttemptedAt: resendId ? record.emailAttemptedAt : new Date(at).toISOString() }); }
      catch (error) { if (!(error instanceof Conflict)) throw error; }
    }
  }
  return result;
}
async function notifyInvitation(env, store, row, record, at, schedule) {
  const pending = sendResendInvitation(env, store, row, record, at).catch(() => {});
  if (schedule) schedule(pending); else await pending;
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
async function serveArtifact(env, asset, request) {
    let range;
    try { range = request.method === 'HEAD' ? null : byteRange(request.headers.get('range'), asset.sizeBytes); }
    catch { return json(416, { error: 'invalid_range' }, { 'Content-Range': `bytes */${asset.sizeBytes}` }); }
    // Conditional R2 GET pins the exact upload verified by the deployment script, without hashing an 835 MB file per request.
    const object = request.method === 'HEAD' ? await env.ARTIFACTS.head(asset.objectKey)
      : await env.ARTIFACTS.get(asset.objectKey, { onlyIf: { etagMatches: asset.etag }, ...(range ? { range } : {}) });
    if (!object || (request.method !== 'HEAD' && !('body' in object)) || object.etag !== asset.etag
      || object.size !== asset.sizeBytes || object.customMetadata?.sha256 !== asset.sha256) fail(503, 'artifact_changed');
    return new Response(request.method === 'HEAD' ? null : object.body, { status: range ? 206 : 200, headers: { ...security,
      'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'ETag': `"${asset.etag}"`,
      ...(range ? { 'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${asset.sizeBytes}` } : {}),
      'Content-Length': String(range ? range.length : asset.sizeBytes), 'Content-Disposition': `attachment; filename="${asset.filename}"` } });
}
async function dispatch(request, env, now, schedule) {
  const url = new URL(request.url), path = url.pathname;
  const customerOrigin = env.CUSTOMER_ORIGIN ?? env.PUBLIC_INTAKE_ORIGIN;
  if (!validIntakeOrigin(customerOrigin, env.LOCAL_SITE_PREVIEW === '1')) fail(503, 'unavailable');
  if (url.origin !== env.PUBLIC_INTAKE_ORIGIN) fail(403, 'forbidden');
  // Check the site's API boundary before authentication or storage access.
  if (path.startsWith('/api/') && env.SITE_SURFACE) {
    const allowed = env.SITE_SURFACE === 'admin' ? path.startsWith('/api/access-admin/')
      : env.SITE_SURFACE === 'customer' ? path.startsWith('/api/trials/') || path.startsWith('/api/billing/') || path.startsWith('/api/customer/')
      : env.SITE_SURFACE === 'public' ? path === '/api/waitlist' : false;
    if (!allowed) fail(404, 'not_found');
  }
  if (!path.startsWith('/api/')) {
    if (!['GET', 'HEAD'].includes(request.method)) fail(405, 'method_not_allowed');
    return env.ASSETS.fetch(request);
  }
  const artifactHead = request.method === 'HEAD' && (/^\/api\/trials\/[a-f0-9]{64}\/(?:artifacts|client-artifacts)\/[a-z0-9-]+$/.test(path) || /^\/api\/access-admin\/releases\/artifacts\/[a-z0-9-]+$/.test(path));
  if (path === '/api/billing/webhook' && request.method === 'POST') {
    const store = await setup(env, now);
    return json(200, await billingWebhook(request, env, store, release, now(), fetch, schedule));
  }
  if (!['GET', 'POST'].includes(request.method) && !artifactHead) fail(405, 'method_not_allowed');
  const machineRefresh = !request.headers.has('origin') && /^\/api\/billing\/[a-f0-9]{64}\/(?:refresh|client-link)$/.test(path);
  if (request.method === 'POST' && ((!machineRefresh && request.headers.get('origin') !== env.PUBLIC_INTAKE_ORIGIN)
    || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')) fail(403, 'forbidden');
  const store = await setup(env, now), at = now();
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const bearer = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const portal = await handleCustomerPortal(request, env, store, at);
  if (portal) return portal;
  if (path === '/api/waitlist') {
    if (request.method === 'GET') return json(200, { open: true });
    if (!await store.allow('waitlist-ip', ip, 60, 3600000)) fail(429, 'rate_limited');
    const input = validateRequest(await body(request));
    if (!input) fail(400, 'invalid_request');
    if (!await store.allow('waitlist-email', input.email, 3, 3600000)) fail(429, 'rate_limited');
    if (!input.trapped) {
      const { trapped: _, ...contact } = input;
      const id = await hash(token());
      await store.insert(id, { ...contact, receivedAt: new Date(at).toISOString() });
      if (requestAlertsEnabled(env)) {
        const alert = notifyNewAccessRequest(env, store, id, contact, at).catch(() => {});
        if (schedule) schedule(alert); else await alert;
      }
    }
    return json(202, { received: true });
  }
  const admin = path.startsWith('/api/access-admin/');
  if (!admin && !path.startsWith('/api/trials/') && !path.startsWith('/api/billing/')) fail(404, 'not_found');
  const operatorSessions = store.operatorSessions();
  const operatorCookie = request.headers.get('cookie');
  const operatorAuthorized = admin && (await equal(bearer, env.OPERATOR_TOKEN) || await validOperatorSession(operatorCookie, env.OPERATOR_TOKEN, at, operatorSessions));
  if (admin && !operatorAuthorized) {
    if (!await store.allow('admin-auth', ip, 20, 3600000)) fail(429, 'rate_limited');
    fail(401, 'access_required');
  }
  if (path === '/api/access-admin/customer-mail' && request.method === 'GET') return json(200, await manualCustomerMail(env, store, at));
  if (path === '/api/access-admin/email-status' && request.method === 'GET') return json(200, {
    provider: env.CUSTOMER_EMAIL_PROVIDER ?? 'manual', enabled: resendCustomerEmailEnabled(env),
    mode: env.CUSTOMER_EMAIL_MODE ?? 'manual', dailyLimit: Number(env.CUSTOMER_EMAIL_DAILY_LIMIT ?? 90),
    monthlyLimit: Number(env.CUSTOMER_EMAIL_MONTHLY_LIMIT ?? 2800),
  });
  const billing = await handleBilling(request, env, store, release, at, operatorAuthorized);
  if (billing !== null) return json(200, billing);
  if (path === '/api/access-admin/session' && request.method === 'POST') {
    empty(await body(request));
    if (!await equal(bearer, env.OPERATOR_TOKEN)) fail(401, 'access_required');
    return json(200, { signedIn: true }, { 'Set-Cookie': await createOperatorSession(env.OPERATOR_TOKEN, at, operatorSessions) });
  }
  if (path === '/api/access-admin/logout' && request.method === 'POST') {
    empty(await body(request));
    await revokeOperatorSession(operatorCookie, env.OPERATOR_TOKEN, at, operatorSessions);
    return json(200, { signedIn: false }, { 'Set-Cookie': clearOperatorSession() });
  }
  // Bound trial guessing and abusive downloads, without exposing contact identifiers in the limiter.
  if (!admin && !await store.allow('trial-ip', ip, 600, 3600000)) fail(429, 'rate_limited');
  const mailer = mailerFor(env);
  if (path === '/api/access-admin/releases' && request.method === 'GET') {
    const { catalogue } = await release(env);
    return json(200, { canDownload: true, serverMajorVersion: serverMajor(catalogue),
      sourceRevision: catalogue.sourceRevision, artifacts: catalogue.artifacts.map(publicArtifact) });
  }
  const releaseAsset = /^\/api\/access-admin\/releases\/artifacts\/([a-z0-9-]+)$/.exec(path);
  if (releaseAsset && ['GET', 'HEAD'].includes(request.method)) {
    const { catalogue } = await release(env), asset = catalogue.artifacts.find(v => v.id === releaseAsset[1]);
    if (!asset) fail(404, 'not_found');
    return serveArtifact(env, asset, request);
  }
  if (path === '/api/access-admin/readiness' && request.method === 'GET') {
    const { catalogue } = await release(env);
    const asset = catalogue.artifacts.find(value => value.id === 'server');
    const object = await env.ARTIFACTS.head(asset.objectKey);
    if (!object || object.etag !== asset.etag || object.size !== asset.sizeBytes || object.customMetadata?.sha256 !== asset.sha256) fail(503, 'artifact_changed');
    return json(200, { ready: true, sourceRevision: catalogue.sourceRevision, artifacts: catalogue.artifacts.length });
  }
  if (path === '/api/access-admin/requests' && request.method === 'GET') {
    const { catalogue } = await release(env);
    const requests = await Promise.all((await store.list()).filter(row => row.trial?.kind !== 'personal-signup' && retained(row,at)).map(async row => {
      let updateAvailable = false, downloadAvailable = false;
      if (row.trial?.state === 'approved') {
        try {
          const selected = await entitledRelease(env, row.trial);
          downloadAvailable = true; updateAvailable = row.trial.releaseHash !== selected.identity;
        } catch (error) { if (!(error instanceof HttpError)) throw error; }
      }
      const notifications = env.CUSTOMER_EMAIL_STORAGE === '1' || env.CUSTOMER_EMAIL_PROVIDER === 'resend'
        ? (await store.db.prepare('SELECT purpose, state FROM customer_email_receipts WHERE request_id = ? ORDER BY rowid DESC').bind(row.id).all()).results : [];
      return { ...row.contact, id: row.id, ...summary(row.trial, mailer), updateAvailable, downloadAvailable,
        customerNotifications: Object.fromEntries([...notifications].reverse().map(({purpose, state}) => [purpose, state])) };
    }));
    return json(200, { permissions: { download: true, manageInstallations: true, approveDevelopment:true }, requests, emailEnabled: Boolean(mailer),
      automaticCustomerEmail: resendCustomerEmailEnabled(env),
      sourceRevision: catalogue.sourceRevision, requestAlertsEnabled: requestAlertsEnabled(env) });
  }
  const match = /^\/api\/(access-admin\/requests|trials)\/([a-f0-9]{64})(?:\/(approve|approve-development|extend|rotate|update-release|archive|unarchive|invitation|send-invitation|resend-invitation|extend-link|close|reject|erase|revocation|replacement-request|replace-installation|replacement-revocation|activate|license|subscription|public-keys|ticket|installer|client-installer|client-artifacts\/[a-z0-9-]+|artifacts\/[a-z0-9-]+))?$/.exec(path);
  if (!match) fail(404, 'not_found');
  const [, , id, action] = match;
  const row = await store.get(id); let record = row?.trial;
  const input = request.method === 'POST' ? await body(request) : null;
  if (!admin && (action==='client-installer'||action?.startsWith('client-artifacts/'))) {
    if (!['GET','HEAD'].includes(request.method)) fail(405,'method_not_allowed');
    if (!row?.contact||!retained(row,at)||!await clientGrant(record,bearer,at)) fail(401,'client_link_unavailable');
    if (!await store.allow('client-downloads',ip,120,3600000)) fail(429,'rate_limited');
    const version=request.headers.get('X-127Vaults-Installer-Version');
    if(version!==null&&!installerPolicy(version,env.INSTALLER_MIN_VERSION??'0.1.0')) fail(426,'installer_update_required');
    const {catalogue}=await entitledRelease(env,record);
    const artifacts=catalogue.artifacts.filter(clientArtifact);
    if (action==='client-installer') return json(200,{protocolVersion:1,sourceRevision:catalogue.sourceRevision,installationId:null,clientOnly:true,artifacts:artifacts.map(publicArtifact)});
    const asset=artifacts.find(v=>v.id===action.slice('client-artifacts/'.length));
    if (!asset) fail(404,'not_found');
    return serveArtifact(env,asset,request);
  }
  if (admin) {
    if (!row?.contact || !retained(row,at)) fail(404, 'not_found');
    if (record?.convertedPurchaseId && request.method === 'POST' && !['archive', 'unarchive'].includes(action)) fail(409, 'converted_installation');
    if (record?.billing && ['approve', 'approve-development', 'extend', 'close', 'reject', 'erase'].includes(action)) fail(409, 'manage_billing_subscription');
    if (action === 'invitation' && request.method === 'GET' && record?.state === 'approved' && record.invitation) {
      const invitation = customerInvitation(record.invitation, env);
      return json(200, { ...summary(record, mailer), email: row.contact.email, subject: invitation.subject, message: invitation.text });
    }
    if (action === 'revocation' && request.method === 'GET' && (record?.revocation || record?.previousRevocation)) return attachment('trial-revocation.json', record.revocation ?? record.previousRevocation);
    if (request.method !== 'POST') fail(405, 'method_not_allowed');
    if (action === 'archive' || action === 'unarchive') {
      empty(input); record = { state: 'requested', ...record, archivedAt: action === 'archive' ? new Date(at).toISOString() : null };
    } else if (action === 'approve-development') {
      if (row.contact.plan === 'support') fail(409, 'plan_unavailable');
      if (record && record.state !== 'requested') fail(409,'state_changed');
      const {catalogue,identity} = await release(env);
      let policy;
      try {policy = await developmentPolicy(input,catalogue.issuerPublicKeys,at);} catch {fail(400,'invalid_development_policy');}
      const value = token();
      const link = `${customerOrigin}/trial?open=1#${id}.${value}`;
      record = {...policy,state:'approved',approvedAt:new Date(at).toISOString(),payment:'none',trialDays:0,
        serverMajorVersion:serverMajor(catalogue),tokenHash:await hash(value),linkExpiresAt:new Date(at+30*day).toISOString(),
        ticketHash:null,ticketUntil:0,sourceRevision:catalogue.sourceRevision,releaseHash:identity,
        invitation:{subject:'Your 127Vaults development access',text:`Development access is ready:\n${link}\n\nUse the normal installer to install or update this development server. Development license expiry: ${policy.entitlementExpiresAt}. Preserve existing server identity and data. No payment or 10-day trial is created.`}};
      await store.save(row,record);
      return json(200,{...summary(record,mailer),link,email:row.contact.email,subject:record.invitation.subject,message:record.invitation.text});
    } else if (action === 'approve' || action === 'rotate' || action === 'update-release') {
      if ((action === 'approve' && record && record.state !== 'requested') || (action !== 'approve' && record?.state !== 'approved')) fail(409, 'state_changed');
      if (action === 'approve') {
        if (!['personal', 'commercial'].includes(row.contact.plan)) fail(409, 'plan_unavailable');
        if (Object.keys(input).join(',') !== 'maxUsers' || !Number.isSafeInteger(input.maxUsers) || input.maxUsers < 1 || input.maxUsers > 100) fail(400, 'invalid_request');
      } else empty(input);
      const { catalogue, identity } = action === 'approve' ? await release(env) : await entitledRelease(env, record);
      if (action === 'update-release' && record.license && !await verifyLicenseIssuer(record.license, catalogue.issuerPublicKeys)) fail(409, 'license_issuer_changed');
      const value = token();
      record = { ...record, state: 'approved', maxUsers: record?.maxUsers ?? input.maxUsers,
        approvedAt: record?.approvedAt ?? new Date(at).toISOString(), payment: 'none', trialDays: record?.kind === 'development' ? 0 : 10, serverMajorVersion: record?.serverMajorVersion ?? (action === 'approve' ? serverMajor(catalogue) : entitledMajor(record)),
        tokenHash: await hash(value), linkExpiresAt: new Date(at + 30 * day).toISOString(),
        ticketHash: null, ticketUntil: 0, sourceRevision: catalogue.sourceRevision, releaseHash: identity };
      // A query forces document navigation even from a legacy trial page whose
      // script predates fragment-change handling. It contains no credentials.
      const link = `${customerOrigin}/trial?open=1#${id}.${value}`;
      record.invitation = { subject: 'Your private 10-day 127Vaults trial',
        text: `Your unpaid 127Vaults trial is ready. Open your private link:\n${link}\n\nDownload the server and clients, then activate one server installation. Your 10-day trial starts at activation. No payment or subscription is created. Use fictitious data only. The link is private; please do not forward it.\n\nAfter 10 days, server writes stop under the existing read-only policy; your encrypted data is preserved.` };
      delete record.emailState; delete record.emailAttemptedAt; delete record.emailAttemptId;
      if (action === 'update-release') record.upgradeOfferedAt = new Date(at).toISOString();
      if (action === 'update-release') record.invitation = { subject: 'Updated 127Vaults packages for your existing installation',
        text: `Updated packages are available:\n${link}\n\nBack up and upgrade your existing installation. Do not initialize replacement keys or a new database. Your installation binding, signed license and trial expiry are unchanged. This does not start another trial. Use fictitious data only.` };
      if (record.kind === 'development') record.invitation = {subject:'Your 127Vaults development access',
        text:`Development packages are available:\n${link}\n\nDevelopment license expiry: ${record.entitlementExpiresAt}. Preserve your existing installation, license, data and backup key. No trial activation is required for an already bound server.`};
      await store.save(row, record);
      await notifyInvitation(env, store, row, record, at, schedule);
      return json(200, { ...summary(record, mailer), link, email: row.contact.email, subject: record.invitation.subject, message: record.invitation.text });
    } else if (action === 'extend-link') {
      if (record?.state !== 'approved' || !record.invitation || !record.tokenHash || record.revocation || record.replacementRequest) fail(409, 'invitation_unavailable');
      if (Object.keys(input).sort().join(',') !== 'days,expectedLinkExpiresAt' || !Number.isSafeInteger(input.days) || input.days < 1 || input.days > 60) fail(400, 'invalid_request');
      if (input.expectedLinkExpiresAt !== record.linkExpiresAt) fail(409, 'state_changed');
      await entitledRelease(env, record);
      const nextLinkExpiry = Math.max(at, Date.parse(record.linkExpiresAt)) + input.days * day;
      const retentionEnd = record.billing ? Infinity : Math.max(row.receivedAt + 90 * day,
        Date.parse(record.entitlementExpiresAt) || 0, record.extendedAt ? Date.parse(record.expiresAt) || 0 : 0);
      if (nextLinkExpiry > retentionEnd) fail(409, 'link_retention_limit');
      record = { ...record, linkExpiresAt: new Date(nextLinkExpiry).toISOString() };
      await store.save(row, record);
      return json(200, summary(record, mailer));
    } else if (action === 'extend') {
      if (record?.state !== 'approved' || record.kind === 'development' || !record.license || record.replacementRequest || record.revocation) fail(409, 'extension_unavailable');
      if (Object.keys(input).sort().join(',') !== 'days,expectedExpiresAt' || !Number.isSafeInteger(input.days) || input.days < 1 || input.days > 60) fail(400, 'invalid_request');
      if (input.expectedExpiresAt !== record.expiresAt) fail(409, 'state_changed');
      const { signingKey, catalogue } = await entitledRelease(env, record);
      if (!await verifyLicenseIssuer(record.license, catalogue.issuerPublicKeys)) fail(409, 'license_issuer_changed');
      const old = JSON.parse(new TextDecoder().decode(from64(JSON.parse(record.license).payload)));
      const expiresAt = new Date(Math.max(at, Date.parse(record.expiresAt)) + input.days * day).toISOString();
      const issuedAt = new Date(at).toISOString();
      const license = await signEnvelope(signingKey, env.TRIAL_ISSUER_KEY_ID, '127Vaults license v1', {
        ...old, licenseId: crypto.randomUUID(), issuedAt, notBefore: issuedAt, expiresAt, sequence: old.sequence + 1,
      });
      const value = token(), link = customerOrigin + '/trial?open=1#' + id + '.' + value;
      record = { ...record, license, expiresAt, extendedAt: issuedAt,
        tokenHash: await hash(value), linkExpiresAt: new Date(Math.max(Date.parse(expiresAt), at + 30 * day)).toISOString(), ticketHash: null, ticketUntil: 0,
        invitation: { subject: 'Your 127Vaults trial has been extended', text: 'Your trial has been extended until ' + expiresAt + '. Open your private link:\n' + link + '\n\nDownload the updated license and install it on your existing server to apply the extension. Keep the existing installation, data and keys. Your user limit and major-version access are unchanged.' } };
      delete record.emailState; delete record.emailAttemptedAt; delete record.emailAttemptId;
      await store.save(row, record);
      await notifyInvitation(env, store, row, record, at, schedule);
      return json(200, { ...summary(record, mailer), link, email: row.contact.email, subject: record.invitation.subject, message: record.invitation.text });
    } else if (action === 'replace-installation') {
      if (record?.state !== 'approved' || !record.license || !record.replacementRequest) fail(409, 'replacement_unavailable');
      if (Object.keys(input).sort().join(',') !== 'installationId,retired' || input.retired !== true
        || input.installationId !== record.replacementRequest.installationId) fail(400, 'invalid_request');
      if (at >= Date.parse(record.expiresAt)) fail(409, 'license_expired');
      const { signingKey, catalogue } = await entitledRelease(env, record);
      if (!await verifyLicenseIssuer(record.license, catalogue.issuerPublicKeys)) fail(409, 'license_issuer_changed');
      const old = JSON.parse(new TextDecoder().decode(from64(JSON.parse(record.license).payload)));
      const installedAt = new Date(at).toISOString();
      const license = await signEnvelope(signingKey, env.TRIAL_ISSUER_KEY_ID, '127Vaults license v1', {
        ...old, licenseId: crypto.randomUUID(), installationId: input.installationId, issuedAt: installedAt,
        notBefore: installedAt, sequence: old.sequence + 1,
      });
      record = { ...record, installationId: input.installationId, license,
        replacementCount: (record.replacementCount ?? 0) + 1, replacedAt: installedAt,
        previousRevocation: record.revocation, replacementHistory: [...(record.replacementHistory ?? []), { installationId: old.installationId, licenseId: old.licenseId, license: record.license, revokedAt: record.replacementRequest.requestedAt, replacedAt: installedAt, revocation: record.revocation }], ticketHash: null, ticketUntil: 0 };
      delete record.revocation; delete record.replacementRequest;
      delete record.emailState; delete record.emailAttemptedAt; delete record.emailAttemptId;
      if (record.invitation) {
        const link = /https:\/\/[^\s]+#[a-f0-9]{64}\.[A-Za-z0-9_-]{43}/.exec(record.invitation.text)?.[0];
        if (!link) fail(409, 'invitation_unavailable');
        record.invitation = { subject: 'Your replacement 127Vaults license is ready',
          text: `Your replacement license is ready. Open your private link:\n${link}\n\nDownload the replacement license and install it on the approved replacement server. Your original expiry, user limit and major-version access are unchanged. Retire the previous server. Its signed revocation is available from your private page; apply it there if reachable. This does not start another trial. Reissuing a license does not recover lost encrypted vault data.` };
      }
     } else if (action === 'send-invitation' || action === 'resend-invitation') {
      const resending = action === 'resend-invitation';
      if (resending) {
        if (Object.keys(input).join(',') !== 'expectedEmailAttemptedAt') fail(400, 'invalid_request');
        if (!record?.emailState || input.expectedEmailAttemptedAt !== (record.emailAttemptedAt ?? null)) fail(409, 'state_changed');
        if (['sending', 'claimed', 'unknown', 'unconfirmed'].includes(record.emailState)) fail(409, 'email_already_attempted');
      } else empty(input);
      if (!mailer) fail(503, 'email_not_configured');
      await entitledRelease(env, record);
      if (record?.state !== 'approved' || !record.invitation || record.replacementRequest || at >= Date.parse(record.linkExpiresAt)) fail(409, 'invitation_unavailable');
      if (mailer.provider === 'resend' && record.kind === 'development') fail(409, 'manual_delivery_only');
      if (mailer.provider !== 'resend' && !await store.allow('trial-email', id, 3, 3600000)) fail(429, 'rate_limited');
      if (resending) {
        if (!await store.allow('trial-manual-resend', id, 3, 3600000)) fail(429, 'rate_limited');
        record = { ...record, emailState: 'sending', emailAttemptedAt: new Date(Math.max(at, (Date.parse(record.emailAttemptedAt) || 0) + 1)).toISOString(), manualResendId: crypto.randomUUID() };
        await store.save(row, record);
      }
      if (mailer.provider === 'resend') {
        if (record.kind === 'development') fail(409, 'manual_delivery_only');
        await sendResendInvitation(env, store, row, record, at, resending ? record.manualResendId : null);
        const fresh = await store.get(row.id);
        return json(200, summary(fresh.trial, mailer));
      }
      if (record.emailState && !resending) fail(409, 'email_already_attempted');
      const attempt = crypto.randomUUID();
      record = { ...record, emailState: 'sending', emailAttemptId: attempt, emailAttemptedAt: resending ? record.emailAttemptedAt : new Date(at).toISOString() };
      await store.save(row, record); // Claim durably before external I/O; never auto-resend an ambiguous attempt.
      let state = 'unknown';
      try { const result = await mailer.sendInvitation({ to: row.contact.email, ...customerInvitation(record.invitation, env) });
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
    if (action === 'erase' && env.CUSTOMER_EMAIL_STORAGE === '1') await store.db.prepare('DELETE FROM customer_email_receipts WHERE request_id = ?').bind(row.id).run();
    if (action === 'erase' && env.INTAKE_PROTECTION === '1') await store.db.prepare('DELETE FROM intake_activity WHERE request_id = ?').bind(row.id).run();
    if (action === 'replace-installation') await notifyInvitation(env, store, row, record, at, schedule);
    if (['close', 'reject'].includes(action) && record.kind !== 'development') {
      const pending = sendCustomerEmail(env, store, { requestId: row.id, event: `${action}:${record.closedAt}`, purpose: 'access',
        recordKind: record.kind, message: { to: row.contact.email, subject: 'Your 127Vaults access request has changed',
          text: `Your access request has been ${action === 'reject' ? 'declined' : 'closed'}. Contact your inviter if you need assistance.\n\nThis notice does not remove vault data or remotely stop an offline server.` } }).catch(() => {});
      if (schedule) schedule(pending); else await pending;
    }
    return json(200, { ...summary(record, mailer), hasRevocation: Boolean(record.revocation), installedLicenseUnaffected: action !== 'replace-installation' && Boolean(record.license) });
  }
  const portalAuthorized = await customerCanAccess(request, env, store, row, at);
  const installerGrant = env.CUSTOMER_PORTAL_ENABLED === '1' && await customerInstallerGrant(row, bearer, at);
  if (!record || record.state !== 'approved' || (!portalAuthorized && !installerGrant && at >= Date.parse(record.linkExpiresAt)) || !row.contact || !retained(row,at)) fail(404, 'link_unavailable');
  const personalPurchase = record.kind === 'personal-purchase';
  if (personalPurchase && !paidPersonalAccess(record, at)) fail(403, 'payment_required');
  const { catalogue, publicKey, signingKey } = await entitledRelease(env, record);
  const cookie = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith('__Secure-127v-trial='))?.slice('__Secure-127v-trial='.length);
  const ticketValid = action?.startsWith('artifacts/') && ['GET', 'HEAD'].includes(request.method) && record.ticketHash
    && at < record.ticketUntil && await equal(await hash(cookie ?? ''), record.ticketHash);
  if (!ticketValid && !portalAuthorized && !installerGrant && (!bearer || !await equal(await hash(bearer), record.tokenHash))) fail(401, 'access_required');
  const installerVersion = request.headers.get('X-127Vaults-Installer-Version');
  if ((action === 'installer' || installerVersion !== null)
    && !installerPolicy(installerVersion, env.INSTALLER_MIN_VERSION ?? '0.1.0')) fail(426, 'installer_update_required');
  if (action === 'installer' && request.method === 'GET') return json(200, {
    protocolVersion: installerProtocol, minimumInstallerVersion: env.INSTALLER_MIN_VERSION ?? '0.1.0',
    ...(personalPurchase ? { subscription: true } : {}),
    installationId: record.installationId ?? null, sourceRevision: catalogue.sourceRevision,
    artifacts: catalogue.artifacts.map(publicArtifact),
  });
  if (!action && request.method === 'GET') return json(200, { ...summary(record, mailer), billingAvailable: Boolean(record.billing), personalPurchase,
    conversionInstallationId: record.conversionInstallationId ?? null,
    trialDays: personalPurchase || record.kind === 'development' ? 0 : 10, payment: record.billing?.status ?? 'none',
    sourceRevision: catalogue.sourceRevision, artifacts: catalogue.artifacts.map(publicArtifact) });
  if (action === 'ticket' && request.method === 'POST') {
    empty(input); const value = token(); record = { ...record, ticketHash: await hash(value), ticketUntil: at + 300000 };
    await store.save(row, record);
    return json(200, { ready: true }, { 'Set-Cookie': `__Secure-127v-trial=${value}; Path=/api/trials/${id}/artifacts/; Max-Age=300; Secure; HttpOnly; SameSite=Strict` });
  }
  if (action === 'replacement-revocation' && request.method === 'GET' && (record.revocation || record.previousRevocation)) {
    return attachment('replaced-license-revocation.json', record.revocation ?? record.previousRevocation);
  }
  if (action === 'replacement-request' && request.method === 'POST') {
    if (record.convertedPurchaseId) fail(409, 'converted_installation');
    if (Object.keys(input).sort().join(',') !== 'installationId,reason,retired' || input.retired !== true
      || !installationUuid.test(input.installationId ?? '') || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) fail(400, 'invalid_request');
    if (!record.license || !record.installationId || input.installationId.toLowerCase() === record.installationId) fail(409, 'replacement_unavailable');
    if (at >= Date.parse(record.expiresAt)) fail(409, 'license_expired');
    if (record.replacementRequest) fail(409, 'replacement_pending');
    await revoke(record, env, signingKey, at);
    record = { ...record, replacementRequest: { installationId: input.installationId.toLowerCase(),
      reason: input.reason.trim(), retired: true, requestedAt: new Date(at).toISOString() }, replacementAlertAttemptedAt: null, ticketHash: null, ticketUntil: 0 };
    await store.save(row, record);
    if (requestAlertsEnabled(env)) {
      const alert = notifyNewAccessRequest(env, store, id, row.contact, at, { replacement: true }).catch(() => {});
      if (schedule) schedule(alert); else await alert;
    }
    return json(202, summary(record, mailer));
  }
  if (record.replacementRequest && ['activate', 'license'].includes(action)) fail(409, 'replacement_pending');
  if (action === 'activate' && request.method === 'POST') {
    if (Object.keys(input).join(',') !== 'installationId' || typeof input.installationId !== 'string'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.installationId)) fail(400, 'invalid_request');
    const installationId = input.installationId.toLowerCase();
    if (record.license && record.installationId !== installationId) fail(409, 'already_bound');
    if (!record.license) {
      if (record.conversionSourceId) {
        record = { ...record, conversionSequence: await claimPersonalConversion(store, row, installationId) };
      }
      const issuedAt = new Date(at).toISOString();
      const expiresAt = personalPurchase ? record.billing.paidThrough
        : record.kind === 'development' ? record.entitlementExpiresAt : new Date(at + 10 * day).toISOString();
      if (Date.parse(expiresAt) <= at) fail(409,'license_expired');
      record = { ...record, installationId, activatedAt: issuedAt, expiresAt };
      if (personalPurchase) {
        const refreshToken = token();
        record.billing = { ...record.billing, issuedOrderId: record.billing.orderId, refreshToken, refreshHash: await hash(refreshToken) };
      }
      record.license = personalPurchase ? await issuePersonalLicense(record, signingKey, env.TRIAL_ISSUER_KEY_ID, at)
        : await signEnvelope(signingKey, env.TRIAL_ISSUER_KEY_ID, '127Vaults license v1', {
          licenseId: crypto.randomUUID(), installationId, plan: record.kind === 'development' ? 'development' : 'commercial', majorVersion: null,
          maxActiveUsers: record.maxUsers, issuedAt, notBefore: issuedAt, expiresAt, sequence: 1,
        });
      await store.save(row, record);
    }
    return json(200, { ...summary(record, mailer), ...(personalPurchase ? {
      billingAvailable: true, personalPurchase: true, conversionInstallationId: record.conversionInstallationId ?? null,
    } : {}) });
  }
  if (action === 'license' && request.method === 'GET' && record.license) return attachment('trial-license.json', record.license);
  if (action === 'subscription' && request.method === 'GET' && personalPurchase && record.license && !record.revocation) {
    return attachment('subscription.json', JSON.stringify({ refreshToken: record.billing.refreshToken,
      refreshUrl: `${customerOrigin}/api/billing/${id}/refresh` }));
  }
  if (action === 'public-keys' && request.method === 'GET') return attachment('trial-issuer-keys.json', JSON.stringify({ [env.TRIAL_ISSUER_KEY_ID]: publicKey }, null, 2));
  if (action?.startsWith('artifacts/') && ['GET', 'HEAD'].includes(request.method)) {
    const asset = catalogue.artifacts.find(v => v.id === action.slice(10)); if (!asset) fail(404, 'not_found');
    return serveArtifact(env, asset, request);
  }
  fail(404, 'not_found');
}
export async function handleRequest(request, env, options = {}) {
  const now = options.now ?? (() => Date.now());
  try { return await dispatch(request, env, now, typeof options.waitUntil === 'function' ? promise => options.waitUntil(promise) : null); }
  catch (error) {
    if (error instanceof HttpError || error instanceof BillingError) return json(error.status, { error: error.message });
    if (error instanceof Conflict) return json(409, { error: 'state_changed' });
    // Never include keys, contact data, links or provider errors in public responses or logs.
    return json(503, { error: 'unavailable' });
  }
}
export async function prune(env, { now = () => Date.now() } = {}) {
  const store = await setup(env, now);
  let signingKey;
  let afterId='',closed=0;
  while(closed<100){
    const rows=await store.expiredContacts(100,afterId);
    if(!rows.length)break;
    for (const row of rows) {
    afterId=row.id;
    if (row.trial?.billing || activeDevelopment(row.trial,now()) || activeExtension(row.trial,now())) continue;
    const record = { ...row.trial };
    if (record.license && !record.revocation) {
      signingKey ??= (await release(env)).signingKey;
      await revoke(record, env, signingKey, now());
    }
    try { await store.save(row, close(record, now()), true); } catch (error) { if (!(error instanceof Conflict)) throw error; }
    closed++;if(closed>=100)break;
    }
    if(rows.length<100)break;
  }
  await store.pruneLimits();
  await store.db.prepare('DELETE FROM operator_sessions WHERE expires_at <= ?').bind(now()).run();
  if (env.CUSTOMER_PORTAL_ENABLED === '1') await pruneCustomerPortal(store, now(),
    env.CUSTOMER_MANUAL_MAIL === '1' || env.CUSTOMER_EMAIL_PROVIDER === 'resend' || env.CLOUD_CUSTOMER_PILOT_MANUAL_LOGIN === '1');
  await pruneCustomerEmail(env, store, now());
  if (env.INTAKE_PROTECTION === '1') await store.db.batch([
    store.db.prepare('DELETE FROM intake_challenges WHERE expires_at <= ?').bind(now()),
    store.db.prepare('DELETE FROM intake_browsers WHERE next_at <= ?').bind(now() - day),
    store.db.prepare('DELETE FROM intake_activity WHERE received_at <= ?').bind(now() - Number(env.INTAKE_VOLUME_WINDOW_MS)),
  ]);
}
export async function reconcile(env, { now = () => Date.now() } = {}) {
  return reconcileBilling(env, await setup(env, now), release, now());
}
export async function notifyAccessRequest(env, id) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid request identifier');
  const store = await setup(env, () => Date.now()), row = await store.get(id);
  if (row?.contact) {
    const tasks = [notifyNewAccessRequest(env, store, id, row.contact, Date.now()), notifyRequestVolume(env, store, Date.now())];
    // Only newly submitted requests get receipts. Enabling a provider never backfills old contacts.
    if (Date.now() - row.receivedAt < day && row.contact.plan !== 'support' && row.trial?.kind !== 'development') tasks.push(sendCustomerEmail(env, store, {
      requestId: id, event: 'request-received', purpose: 'signup', recordKind: row.trial?.kind,
      message: { to: row.contact.email, subject: 'We received your 127Vaults access request',
        text: `Your ${row.contact.plan} access request has been received and is waiting for review.\n\nOnce approved, you’ll receive private downloads for an unpaid 10-day self-hosted trial. Your trial starts when you activate your server; no card or subscription is required. We will email your private invitation once your access is approved.\n\nCustomer portal: ${env.CUSTOMER_ORIGIN ?? env.PUBLIC_SITE_ORIGIN}\n\nThis receipt does not approve access, start a trial, or create a paid subscription. If you did not submit this request, you can ignore this email.` },
    }));
    await Promise.allSettled(tasks);
  }
}
export default { fetch: handleRequest, scheduled: (_event, env, ctx) => ctx.waitUntil(Promise.all([prune(env), reconcile(env)])) };
