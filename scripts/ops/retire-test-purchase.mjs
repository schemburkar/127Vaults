import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../cloudflare/config.mjs';
import { cloudflareApi } from '../cloudflare/api.mjs';
import { encryptionKey, seal, unseal } from '../../apps/public-intake/cloudflare/crypto.mjs';
export function retireTestPurchase(contact, trial, email, now = new Date().toISOString()) {
  if (contact?.email?.toLowerCase() !== email.toLowerCase() || trial?.billing?.mode !== 'test_mode'
    || trial.kind !== 'personal-purchase' || trial.license || trial.installationId)
    throw Error('Cleanup requires an exact matching, unactivated test-mode purchase.');
  const next = { ...trial, state: 'closed', closedAt: now, tokenHash: null, ticketHash: null, ticketUntil: 0 };
  delete next.invitation;
  return next;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
  for (const name of ['--email', '--request-id', '--output']) if (!args.includes(name) || !option(name)) throw Error('Use --email EMAIL --request-id ID --output PRIVATE-RECEIPT [--confirm]');
  const id = option('--request-id'); if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid request ID');
  const config = await loadConfig('.cloudflare-deploy/config.json'), api = await cloudflareApi(config);
  const databases = await api(`/accounts/${config.accountId}/d1/database`);
  const matching = databases.filter(v => v.name === config.databaseName);
  if (matching.length !== 1) throw Error('Database must match uniquely');
  const query = async (sql, params = []) => {
    const results = await api(`/accounts/${config.accountId}/d1/database/${matching[0].uuid}/query`, { method: 'POST', body: { sql, params } });
    if (results.length !== 1 || !results[0].success) throw Error('Database operation failed');
    return results[0];
  };
  const rows = (await query('SELECT * FROM access_requests WHERE id = ?', [id])).results;
  if (rows.length !== 1) throw Error('Request not found');
  const row = rows[0], master = (await readFile(join(config.secretsDirectory, 'intake-key'), 'utf8')).trim();
  const contact = await unseal(row.contact, await encryptionKey(master, 'contacts'), `contact:${id}`);
  const trialKey = await encryptionKey(master, 'trials'), trial = await unseal(row.trial, trialKey, `trial:${id}`);
  const next = retireTestPurchase(contact, trial, option('--email'));
  const output = resolve(option('--output')); await mkdir(resolve(output, '..'), {recursive:true,mode:0o700});
  const receipt = { requestId:id, mode:trial.billing.mode, confirmed:args.includes('--confirm'), status:'prepared', encryptedBefore:row, providerSubscriptionUnchanged:true, paymentHistoryPreserved:true, at:new Date().toISOString() };
  await writeFile(output, JSON.stringify(receipt,null,2), {flag:'wx',mode:0o600});
  if (args.includes('--confirm')) {
    const encrypted = await seal(next, trialKey, `trial:${id}`);
    const result = await query('UPDATE access_requests SET contact = NULL, trial = ?, version = version + 1 WHERE id = ? AND version = ? AND contact = ?', [encrypted,id,row.version,row.contact]);
    if (result.meta.changes !== 1) throw Error('Record changed concurrently; inspect receipt');
    const after = (await query('SELECT contact, trial, version FROM access_requests WHERE id = ?', [id])).results[0];
    const saved = await unseal(after.trial,trialKey,`trial:${id}`);
    if (after.contact !== null || saved.state !== 'closed' || saved.tokenHash !== null || saved.invitation || JSON.stringify(saved.billing) !== JSON.stringify(trial.billing)) throw Error('Cleanup verification failed');
    receipt.status = 'verified';
    await writeFile(output, JSON.stringify(receipt,null,2));
  }
  console.log(JSON.stringify({requestId:id,status:receipt.status,mode:receipt.mode,receipt:output}));
}
