// Manually approved, unpaid private trials. Separate from simulated purchases.
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { seal, unseal } from './mock-selfhost.mjs';
import { withFileLock, createDurableLimit } from './durable-limit.mjs';
import { issueSelfHostedLicense } from '../../../scripts/ops/issue-self-hosted-license.mjs';
import { issueLicenseRevocation } from '../../../scripts/ops/issue-license-revocation.mjs';
import { validIntakeOrigin } from './intake-origin.mjs';
import { verifyLicenseFile } from '../../server/src/license-status.mjs';
import { installerPolicy, installerProtocol } from '../cloudflare/installer.mjs';
import { createOperatorSession, validOperatorSession, clearOperatorSession } from './operator-session.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const idPattern = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const equal = (a, b) => typeof a === 'string' && typeof b === 'string'
  && timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
function json(res, status, value, extra = {}) {
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 2048) throw Error('invalid_request');
  }
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_request');
  return value;
}
function download(res, name, content) {
  res.writeHead(200, { ...headers, 'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="${name}"` });
  res.end(content);
}

// The stable digest also gives legacy encrypted JSONL requests an operator ID.
export async function readAccessRequests(dataFile, key) {
  const source = await readFile(dataFile, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return source.split('\n').filter(Boolean).map(line => ({
    ...unseal(line, key), id: hash(line),
  }));
}

export async function pruneAccessRequests({ dataFile, key, now = new Date() }) {
  await mkdir(dirname(dataFile), { recursive: true, mode: 0o700 });
  return withFileLock(`${dataFile}.lock`, async () => {
    const source = await readFile(dataFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    const lines = source.split('\n').filter(Boolean);
    const kept = lines.filter(line => {
      const received = Date.parse(unseal(line, key).receivedAt);
      if (!Number.isFinite(received)) throw Error('Invalid request date.');
      return now.getTime() - received < 90 * 86400000;
    });
    if (kept.length !== lines.length) {
      const temporary = `${dataFile}.${randomUUID()}.tmp`;
      await writeFile(temporary, kept.length ? kept.join('\n') + '\n' : '', { flag: 'wx', mode: 0o600 });
      await rename(temporary, dataFile);
    }
    return lines.length - kept.length;
  });
}

async function digestHandle(file) {
  const digest = createHash('sha256');
  for await (const chunk of file.createReadStream({ autoClose: false, start: 0 })) digest.update(chunk);
  return digest.digest('hex');
}

// Files stay outside the static root. A catalogue pins the exact approved bytes.
export async function loadTrialArtifacts(catalogueFile) {
  const catalogue = JSON.parse(await readFile(catalogueFile, 'utf8'));
  if (catalogue.schemaVersion !== 1 || !Array.isArray(catalogue.artifacts) || !catalogue.artifacts.length
    || !catalogue.issuerPublicKeys || !/^[a-f0-9]{40,64}$/.test(catalogue.sourceRevision)) throw Error('Invalid trial catalogue.');
  const ids = new Set();
  for (const asset of catalogue.artifacts) {
    if (!/^[a-z0-9-]{1,60}$/.test(asset.id) || ids.has(asset.id) || !isAbsolute(asset.path)
      || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$/.test(asset.filename)
      || typeof asset.label !== 'string' || asset.label.length > 240
      || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 1) throw Error('Invalid trial artifact.');
    ids.add(asset.id);
    const file = await open(asset.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (!(await file.stat()).isFile() || (await file.stat()).size !== asset.sizeBytes
        || await digestHandle(file) !== asset.sha256) throw Error('Trial artifact checksum mismatch.');
    } finally { await file.close(); }
  }
  if (!ids.has('server')) throw Error('The trial requires a server bundle.');
  return catalogue;
}

export function createTrialHandler({ origin, key, dataFile, dataDir, operatorToken,
  issuerPrivateKey, issuerKeyId, catalogue, mailer = null, now = () => new Date(), allowLoopbackHttp = false, minimumInstallerVersion = '0.1.0' }) {
  if (!validIntakeOrigin(origin, allowLoopbackHttp) || key?.length !== 32
    || !dataFile || !dataDir || !/^[A-Za-z0-9_-]{43,128}$/.test(operatorToken ?? '')
    || !/^[A-Za-z0-9_-]{1,40}$/.test(issuerKeyId ?? '')) throw Error('Invalid trial configuration.');
  const issuer = createPrivateKey(issuerPrivateKey);
  if (issuer.asymmetricKeyType !== 'ed25519') throw Error('Ed25519 trial issuer required.');
  const publicKey = createPublicKey(issuer).export({ type: 'spki', format: 'pem' });
  if (catalogue.issuerPublicKeys?.[issuerKeyId] !== publicKey) throw Error('Trial issuer differs from the approved bundle catalogue.');
  const recordKey = createHash('sha256').update(key).update('private-trials-v1').digest();
  const releaseHash = hash(JSON.stringify({ sourceRevision: catalogue.sourceRevision,
    issuerPublicKeys: catalogue.issuerPublicKeys,
    artifacts: catalogue.artifacts.map(({ path: _, ...asset }) => asset) }));
  const pathFor = id => join(dataDir, `${id}.json`);
  const read = async id => unseal(await readFile(pathFor(id), 'utf8'), recordKey);
  async function optional(id) {
    try { return await read(id); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function save(id, value) {
    const temporary = join(dataDir, `${id}.${randomUUID()}.tmp`);
    await writeFile(temporary, seal(value, recordKey), { flag: 'wx', mode: 0o600 });
    await rename(temporary, pathFor(id));
  }
  const allow = createDurableLimit({ directory: join(dataDir, 'request-limits'), now: () => now().getTime() });
  const summary = record => ({ state: record?.state ?? 'requested', maxUsers: record?.maxUsers,
    archivedAt: record?.archivedAt ?? null,
    approvedAt: record?.approvedAt, linkExpiresAt: record?.linkExpiresAt,
    emailState: record?.emailState ?? 'not_sent', emailAttemptedAt: record?.emailAttemptedAt,
    canSendEmail: Boolean(mailer && record?.invitation && !record.emailState),
    canPreviewInvitation: Boolean(record?.invitation),
    activatedAt: record?.activatedAt, expiresAt: record?.expiresAt, installationId: record?.installationId, sourceRevision: record?.sourceRevision, upgradeOfferedAt: record?.upgradeOfferedAt });
  return async (req, res) => {
    try {
      const path = new URL(req.url, origin).pathname;
      if (!path.startsWith('/api/access-admin/') && !path.startsWith('/api/trials/')) return json(res, 404, { error: 'not_found' });
      const admin = path.startsWith('/api/access-admin/');
      const bearer = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(req.headers.authorization ?? '')?.[1];
      if (admin && !equal(bearer, operatorToken) && !await validOperatorSession(req.headers.cookie, operatorToken, Date.now())) {
        if (!await allow('admin-auth', req.socket.remoteAddress ?? 'unknown', 20, 3600000)) return json(res, 429, { error: 'rate_limited' });
        return json(res, 401, { error: 'access_required' });
      }
      if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'method_not_allowed' });
      if (req.method === 'POST' && (req.headers.origin !== origin
        || req.headers['content-type']?.split(';')[0] !== 'application/json')) return json(res, 403, { error: 'forbidden' });
      if (path === '/api/access-admin/session' && req.method === 'POST') {
        if (Object.keys(await body(req)).length) return json(res, 400, { error: 'invalid_request' });
        if (!equal(bearer, operatorToken)) return json(res, 401, { error: 'access_required' });
        return json(res, 200, { signedIn: true }, { 'Set-Cookie': await createOperatorSession(operatorToken, Date.now()) });
      }
      if (path === '/api/access-admin/logout' && req.method === 'POST') {
        if (Object.keys(await body(req)).length) return json(res, 400, { error: 'invalid_request' });
        return json(res, 200, { signedIn: false }, { 'Set-Cookie': clearOperatorSession() });
      }
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      if (path === '/api/access-admin/requests' && req.method === 'GET') {
        const requests = await readAccessRequests(dataFile, key);
        return json(res, 200, { requests: await Promise.all(requests.map(async request => {
          const record = await optional(request.id);
          return { ...request, ...summary(record), updateAvailable: record?.state === 'approved' && record.releaseHash !== releaseHash };
        })), sourceRevision: catalogue.sourceRevision, emailEnabled: Boolean(mailer), emailDryRun: mailer?.mode === 'dry-run' });
      }
      const route = /^\/api\/(access-admin\/requests|trials)\/([a-f0-9]{64})(?:\/(approve|rotate|update-release|archive|unarchive|invitation|send-invitation|close|reject|erase|revocation|activate|license|public-keys|ticket|installer|artifacts\/[a-z0-9-]+))?$/.exec(path);
      if (!route || !idPattern.test(route[2])) return json(res, 404, { error: 'not_found' });
      const [, , id, action] = route;
      // Finish lower-trust body reads before taking a record lock or reading
      // authoritative trial state. A slow sender must not hold this lock.
      const inputBody = req.method === 'POST' ? await body(req) : null;
      const result = await withFileLock(join(dataDir, `${id}.lock`), async () => {
        let record = await optional(id);
        if (admin) {
          const request = (await readAccessRequests(dataFile, key)).find(row => row.id === id);
          if (!request) return json(res, 404, { error: 'not_found' });
          if (action === 'invitation' && req.method === 'GET' && record?.state === 'approved' && record.invitation) {
            return json(res, 200, { email: request.email, subject: record.invitation.subject, message: record.invitation.text });
          }
          if (action === 'revocation' && req.method === 'GET' && record?.revocation) return download(res, 'trial-revocation.json', record.revocation);
          if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
          const input = inputBody;
          if (action === 'archive' || action === 'unarchive') {
            if (Object.keys(input).length) return json(res, 400, { error: 'invalid_request' });
            record = { state: 'requested', ...record, archivedAt: action === 'archive' ? now().toISOString() : null };
            await save(id, record);
            return json(res, 200, summary(record));
          }
          if (action === 'send-invitation') {
            if (Object.keys(input).length) return json(res, 400, { error: 'invalid_request' });
            if (!mailer) return json(res, 503, { error: 'email_not_configured' });
            if (record?.state !== 'approved' || !record.invitation || now().getTime() >= Date.parse(record.linkExpiresAt)
              || record.releaseHash !== releaseHash) return json(res, 409, { error: 'invitation_unavailable' });
            if (record.emailState) return json(res, 409, { error: 'email_already_attempted', emailState: record.emailState });
            if (!await allow('trial-invitation', id, 3, 3600000)) return json(res, 429, { error: 'rate_limited' });
            // Persist before network I/O. A crash or lost provider reply must not auto-send twice.
            record.emailState = 'sending'; record.emailAttemptedAt = now().toISOString();
            await save(id, record);
            try {
              const result = await mailer.sendInvitation({ to: request.email, ...record.invitation });
              record.emailState = ['accepted', 'queued', 'bounced'].includes(result?.state) ? result.state : 'unknown';
            } catch { record.emailState = 'unknown'; }
            await save(id, record);
            return json(res, 200, summary(record));
          }
          if (action === 'approve' || action === 'rotate' || action === 'update-release') {
            if (action === 'approve' && !['personal', 'commercial'].includes(request.plan)) return json(res, 409, { error: 'plan_unavailable' });
            if ((action === 'approve' && record && record.state !== 'requested') || (action !== 'approve' && record?.state !== 'approved')) return json(res, 409, { error: 'state_changed' });
            if (action === 'approve' && (Object.keys(input).join(',') !== 'maxUsers'
              || !Number.isSafeInteger(input.maxUsers) || input.maxUsers < 1 || input.maxUsers > 100)) return json(res, 400, { error: 'invalid_request' });
            if (action !== 'approve' && Object.keys(input).length) return json(res, 400, { error: 'invalid_request' });
            if (action === 'update-release' && record.license) {
              try { verifyLicenseFile(record.license, catalogue.issuerPublicKeys, record.installationId); }
              catch { return json(res, 409, { error: 'license_issuer_changed' }); }
            }
            const token = randomBytes(32).toString('base64url');
            record = { ...record, state: 'approved', maxUsers: record?.maxUsers ?? input.maxUsers,
              approvedAt: record?.approvedAt ?? now().toISOString(), payment: 'none', trialDays: 10,
              tokenHash: hash(token), linkExpiresAt: new Date(now().getTime() + 30 * 86400000).toISOString(),
              ticketHash: null, ticketUntil: 0,
              sourceRevision: action === 'update-release' ? catalogue.sourceRevision : record?.sourceRevision ?? catalogue.sourceRevision,
              releaseHash: action === 'update-release' ? releaseHash : record?.releaseHash ?? releaseHash };
            const link = `${origin}/trial.html?open=1#${id}.${token}`;
            record.invitation = { subject: 'Your private 10-day 127Vaults trial',
              text: `Your unpaid 127Vaults trial is ready. Open your private link:\n${link}\n\nDownload the server and clients, then activate one server installation. Your 10-day trial starts at activation. No payment or subscription is created. Use fictitious data only. The link is private; please do not forward it.\n\nAfter 10 days, server writes stop under the existing read-only policy; your encrypted data is preserved.` };
            delete record.emailState; delete record.emailAttemptedAt;
            if (action === 'update-release') record.upgradeOfferedAt = now().toISOString();
            if (action === 'update-release') record.invitation = { subject: 'Updated 127Vaults packages for your existing installation',
              text: `Updated packages are available:\n${link}\n\nBack up and upgrade your existing installation. Do not initialize replacement keys or a new database. Your installation binding, signed license and trial expiry are unchanged. This does not start another trial. Use fictitious data only.` };
            await save(id, record);
            return json(res, 200, { ...summary(record), link, email: request.email,
              subject: record.invitation.subject, message: record.invitation.text });
          }
          if (!['close', 'reject', 'erase'].includes(action) || Object.keys(input).length) return json(res, 400, { error: 'invalid_request' });
          if (action === 'reject' && record?.license) return json(res, 409, { error: 'close_activated_trial' });
          if (record?.license && !record.revocation) {
            const payload = JSON.parse(Buffer.from(JSON.parse(record.license).payload, 'base64url'));
            record.revocation = issueLicenseRevocation({ privateKeyPem: issuerPrivateKey, keyId: issuerKeyId,
              installationId: record.installationId, licenseId: payload.licenseId, revokedAt: 'now', now: now() });
          }
          record = { ...record, state: action === 'reject' ? 'rejected' : 'closed', closedAt: now().toISOString(), tokenHash: null };
          delete record.invitation;
          await save(id, record);
          if (action === 'erase') {
            await withFileLock(`${dataFile}.lock`, async () => {
              const lines = (await readFile(dataFile, 'utf8')).split('\n').filter(Boolean).filter(line => hash(line) !== id);
              const temp = `${dataFile}.${randomUUID()}.tmp`;
              await writeFile(temp, lines.length ? lines.join('\n') + '\n' : '', { flag: 'wx', mode: 0o600 });
              await rename(temp, dataFile);
            });
          }
          return json(res, 200, { ...summary(record), hasRevocation: Boolean(record.revocation),
            installedLicenseUnaffected: Boolean(record.license) });
        }
        if (!record || record.state !== 'approved' || now().getTime() >= Date.parse(record.linkExpiresAt)) return json(res, 404, { error: 'link_unavailable' });
        // A new deployment cannot silently replace the artifacts approved for this request.
        if (record.releaseHash !== releaseHash) return json(res, 409, { error: 'release_changed_contact_operator' });
        const cookiePath = `/api/trials/${id}/artifacts/`;
        const cookieName = origin.startsWith('https:') ? '__Secure-127v-trial' : '127v-trial-local';
        const ticket = (req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
        const ticketValid = action?.startsWith('artifacts/') && req.method === 'GET'
          && record.ticketHash && equal(hash(ticket ?? ''), record.ticketHash) && now().getTime() < record.ticketUntil;
        if (!ticketValid && (!bearer || !equal(hash(bearer), record.tokenHash))) return json(res, 401, { error: 'access_required' });
        const installerVersion = req.headers['x-127vaults-installer-version'];
        if ((action === 'installer' || installerVersion !== undefined) && !installerPolicy(installerVersion, minimumInstallerVersion)) return json(res, 426, { error: 'installer_update_required' });
        if (action === 'installer' && req.method === 'GET') return json(res, 200, {
          protocolVersion: installerProtocol, minimumInstallerVersion,
          installationId: record.installationId ?? null, sourceRevision: catalogue.sourceRevision,
          artifacts: catalogue.artifacts.map(({ path: _, ...asset }) => asset),
        });
        if (!action && req.method === 'GET') return json(res, 200, { ...summary(record), trialDays: 10, payment: 'none',
          sourceRevision: catalogue.sourceRevision, artifacts: catalogue.artifacts.map(({ path: _, ...asset }) => asset) });
        if (action === 'ticket' && req.method === 'POST') {
          if (Object.keys(inputBody).length) return json(res, 400, { error: 'invalid_request' });
          const value = randomBytes(32).toString('base64url');
          record.ticketHash = hash(value); record.ticketUntil = now().getTime() + 5 * 60000;
          await save(id, record);
          const secure = origin.startsWith('https:');
          return json(res, 200, { ready: true }, { 'Set-Cookie': `${secure ? '__Secure-127v-trial' : '127v-trial-local'}=${value}; Path=${cookiePath}; Max-Age=300; ${secure ? 'Secure; ' : ''}HttpOnly; SameSite=Strict` });
        }
        if (action === 'activate' && req.method === 'POST') {
          const input = inputBody;
          if (Object.keys(input).join(',') !== 'installationId' || !uuid.test(input.installationId)) return json(res, 400, { error: 'invalid_request' });
          const installationId = input.installationId.toLowerCase();
          if (record.license && record.installationId !== installationId) return json(res, 409, { error: 'already_bound' });
          if (!record.license) {
            record.installationId = installationId; record.activatedAt = now().toISOString();
            record.expiresAt = new Date(now().getTime() + 10 * 86400000).toISOString();
            record.license = issueSelfHostedLicense({ privateKeyPem: issuerPrivateKey, keyId: issuerKeyId,
              installationId, plan: 'commercial', majorVersion: null, maxActiveUsers: record.maxUsers,
              sequence: 1, expiresAt: record.expiresAt, now: now() }).license;
            await save(id, record);
          }
          return json(res, 200, summary(record));
        }
        if (action === 'license' && req.method === 'GET' && record.license) return download(res, 'trial-license.json', record.license);
        if (action === 'public-keys' && req.method === 'GET') return download(res, 'trial-issuer-keys.json', JSON.stringify({ [issuerKeyId]: publicKey }, null, 2));
        if (action?.startsWith('artifacts/') && req.method === 'GET') {
          const asset = catalogue.artifacts.find(row => row.id === action.slice(10));
          if (!asset) return json(res, 404, { error: 'not_found' });
          return { asset };
        }
        return json(res, 404, { error: 'not_found' });
      });
      // Release the record lock before hashing/streaming multi-GB server bundles.
      if (result?.asset) {
        const asset = result.asset;
        const file = await open(asset.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size !== asset.sizeBytes || await digestHandle(file) !== asset.sha256) return json(res, 503, { error: 'artifact_changed' });
          res.writeHead(200, { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': asset.sizeBytes,
            'Content-Disposition': `attachment; filename="${asset.filename}"` });
          await pipeline(file.createReadStream({ autoClose: false, start: 0 }), res);
        } finally { await file.close(); }
      }
    } catch {
      if (res.headersSent) res.destroy();
      else json(res, 503, { error: 'unavailable' });
    }
  };
}
