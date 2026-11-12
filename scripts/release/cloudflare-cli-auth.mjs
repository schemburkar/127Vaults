import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function cloudflareCliEnvironment(env = process.env) {
  if (env.CLOUDFLARE_API_TOKEN) return { ...env };
  const root = env.XDG_CONFIG_HOME || (process.platform === 'win32'
    ? join(env.APPDATA, 'xdg.config') : join(homedir(), '.config'));
  const profile = JSON.parse(await readFile(join(root, 'cloudflare/config/default.json'), 'utf8'));
  if (typeof profile.oauth_token !== 'string' || !/^[\x21-\x7e]{20,4096}$/.test(profile.oauth_token)) {
    throw Error('Cloudflare CLI credentials are unavailable. Sign in with cf auth login.');
  }
  return { ...env, CLOUDFLARE_API_TOKEN: profile.oauth_token };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const env = await cloudflareCliEnvironment();
    const child = spawn(process.execPath, [fileURLToPath(new URL('./set.mjs', import.meta.url)), '--request'],
      { env, stdio: 'inherit', windowsHide: true });
    child.on('error', () => { console.error('Cannot start the release workflow.'); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
  } catch { console.error('Cannot load Cloudflare CLI credentials. Run cf auth whoami or cf auth login, then retry.'); process.exitCode = 1; }
}
