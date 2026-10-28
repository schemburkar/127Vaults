import { readFile, rename, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const pending = new Map();
// Share a single refresh among concurrent status, sync, and seat checks.
export async function subscriptionLicense({ configFile, stateFile, installationId, keys, original,
  verify, verifyRevocation, now = Date.now(), fetcher = fetch }) {
  const identity = `${stateFile}:${installationId}`;
  if (pending.has(identity)) return pending.get(identity);
  const work = guardedRefresh(); pending.set(identity, work);
  try { return await work; } finally { pending.delete(identity); }
  async function guardedRefresh() {
    const lock = `${stateFile}.lock`;
    try { await writeFile(lock, '', { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (error.code === 'EEXIST') return refresh(false); throw error; }
    try { return await refresh(true); } finally { await rm(lock, { force: true }); }
  }
  async function refresh(network) {
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    const url = new URL(config.refreshUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !/^\/api\/billing\/[a-f0-9]{64}\/refresh$/.test(url.pathname)
      || !/^[A-Za-z0-9_-]{43}$/.test(config.refreshToken)) throw Error('invalid_subscription_configuration');
    let saved;
    try { saved = JSON.parse(await readFile(stateFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const base = verify(original, keys, installationId);
    let current = original;
    if (saved?.license) {
      const prior = verify(saved.license, keys, installationId);
      if (prior.sequence > base.sequence) current = saved.license;
    }
    let revocation = saved?.revocation ?? null;
    if (revocation) verifyRevocation(revocation, keys, installationId);
    if (!network || (saved?.checkedAt <= now && now - saved.checkedAt < 15 * 60000)) return { license: current, revocation };
    try {
      const response = await fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${config.refreshToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ installationId }) });
      if (!response.ok) throw Error('subscription_refresh_unavailable');
      const result = await response.json();
      if (typeof result.license !== 'string' || result.license.length > 8192) throw Error('invalid_subscription_license');
      const accepted = verify(result.license, keys, installationId), prior = verify(current, keys, installationId);
      if (accepted.sequence < prior.sequence || (accepted.sequence === prior.sequence && result.license !== current)) throw Error('subscription_rollback');
      if (result.revocation) { verifyRevocation(result.revocation, keys, installationId, accepted.licenseId); revocation = result.revocation; }
      else if (revocation && verifyRevocation(revocation, keys, installationId).licenseId !== accepted.licenseId) revocation = null;
      const next = { license: result.license, checkedAt: now, revocation };
      const staged = join(dirname(stateFile), `.subscription-${crypto.randomUUID()}.tmp`);
      await writeFile(staged, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      await rename(staged, stateFile);
      return { license: result.license, revocation };
    } catch {
      // Outages cannot extend expiry. Retry at most once per minute while preserving the last signed entitlement.
      const staged = `${stateFile}.${crypto.randomUUID()}.tmp`;
      await writeFile(staged, JSON.stringify({ license: current, revocation, checkedAt: now - 14 * 60000 }), { mode: 0o600, flag: 'wx' });
      await rename(staged, stateFile);
      return { license: current, revocation };
    }
  }
}
