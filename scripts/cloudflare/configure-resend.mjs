import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfig, saveJson } from './config.mjs';

// Configuration only. These commands never contact Resend or send a probe email.
export async function configureResend(action, file, from) {
  if (!['prepare', 'enable', 'disable'].includes(action)) throw Error('Use prepare|enable|disable');
  const config = await loadConfig(file);
  if (!config.sites) throw Error('Customer email requires the separated website deployment');
  const customerEmail = { provider: 'resend', from: from ?? config.customerEmail?.from ?? 'accounts@127vaults.com',
    enabled: action === 'enable', dailyLimit: config.customerEmail?.dailyLimit ?? 90, monthlyLimit: config.customerEmail?.monthlyLimit ?? 2800 };
  const next = validateConfig({ ...config, customerEmail, sites: { ...config.sites, emailLogin: false } }, file);
  if (customerEmail.enabled) {
    const key = (await readFile(join(next.secretsDirectory, 'resend-api-key'), 'utf8')).trim();
    if (!/^re_[A-Za-z0-9_-]{16,200}$/.test(key)) throw Error('Save the sending-only Resend key in the protected secrets directory first');
  }
  await saveJson(file, next);
  return { provider: 'resend', from: customerEmail.from, enabled: customerEmail.enabled, dailyLimit: customerEmail.dailyLimit, monthlyLimit: customerEmail.monthlyLimit,
    networkCalls: 0, emailsSent: 0, nextStep: customerEmail.enabled ? 'Deploy through Publish separated websites' : 'Manual customer delivery remains active' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, file, from] = process.argv.slice(2);
  if (!file) throw Error('Use configure-resend.mjs prepare|enable|disable <private-config.json> [sender-address]');
  console.log(JSON.stringify(await configureResend(action, resolve(file), from)));
}
