import { runWrangler } from './deploy.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Keep authentication material inside this process; never print provider responses or tokens.
export async function cloudflareApi(config, { run = runWrangler, fetchImpl = fetch, access = false } = {}) {
  const scoped = access ? process.env.CLOUDFLARE_ACCESS_API_TOKEN || await readFile(join(config.secretsDirectory, 'cloudflare-access-token'), 'utf8')
    .then(value => value.trim()).catch(error => { if (error.code === 'ENOENT') return ''; throw error; }) : '';
  const credential = scoped || process.env.CLOUDFLARE_API_TOKEN || JSON.parse(await run(['auth', 'token', '--json'], config, { capture: true })).token;
  if (!credential) throw Error('Cloudflare authentication is required');
  return async (path, { method = 'GET', body } = {}) => {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
      method, headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    const value = await response.json();
    if (!response.ok || !value.success) throw Error(`Cloudflare ${method} ${path.replace(config.accountId, 'ACCOUNT')} failed (${response.status}; codes ${(value.errors ?? []).map(v => v.code).join(',')})`);
    return value.result;
  };
}
