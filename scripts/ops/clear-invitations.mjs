import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../cloudflare/config.mjs';
export async function clearInvitations(api, email, confirm = false, checkpoint = async () => {}) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Supply an exact email address.');
  const matches = (await api('/api/access-admin/requests')).requests.filter(row => row.email?.toLowerCase() === email.toLowerCase());
  // Billing must be handled separately; never cancel subscriptions through cleanup.
  const protectedRows = matches.filter(row => row.billing || row.billingStatus || row.kind === 'personal-purchase' || row.convertedPurchaseId);
  const eligible = matches.filter(row => !protectedRows.includes(row));
  const result = { email, confirmed: confirm, matched: matches.length, preservedBilling: protectedRows.map(row => ({ id: row.id, invitationAvailable: Boolean(row.canPreviewInvitation), linkExpiresAt: row.linkExpiresAt })), erased: [] };
  await checkpoint(result);
  if (confirm) for (const row of eligible) {
    if (!/^[a-f0-9]{64}$/.test(row.id)) throw Error('Invalid request identifier');
    await api(`/api/access-admin/requests/${row.id}/erase`, {});
    result.erased.push(row.id);
    await checkpoint(result);
  }
  result.remaining = confirm ? (await api('/api/access-admin/requests')).requests.filter(row => row.email?.toLowerCase() === email.toLowerCase()).length : matches.length;
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1];
  if (!args.includes('--email') || !args.includes('--output')) throw Error('Use --email EXACT --output PRIVATE-RECEIPT [--confirm] [--config FILE]');
  const config = await loadConfig(args.includes('--config') ? value('--config') : '.cloudflare-deploy/config.json');
  const token = (await readFile(join(config.secretsDirectory, 'operator-token'), 'utf8')).trim();
  const origin = config.sites?.adminOrigin ?? config.origin;
  const api = async (path, body) => {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error' });
    if (!response.ok) throw Error(`Admin operation failed (${response.status}).`);
    return response.json();
  };
  const output = resolve(value('--output'));
  await mkdir(resolve(output, '..'), { recursive: true, mode: 0o700 });
  // Reserve the receipt before any mutation; retries never overwrite prior evidence.
  await writeFile(output, JSON.stringify({ status: 'started', at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  const result = await clearInvitations(api, value('--email'), args.includes('--confirm'), async result => writeFile(output, JSON.stringify({ status: 'in-progress', ...result }, null, 2))); 
  await writeFile(output, JSON.stringify({ ...result, at: new Date().toISOString(), transport: 'admin erase; no customer email' }, null, 2));
  console.log(JSON.stringify({ matched: result.matched, erased: result.erased.length, remaining: result.remaining, receipt: output }));
}
