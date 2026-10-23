import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { get } from 'node:https';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export async function ensureRuntimeKeys(directory) {
  const names = ['token.key', 'checkpoint.key'];
  const existing = await Promise.all(names.map(async name => {
    try { return await readFile(join(directory, name)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }));
  if (existing.some(Boolean) && !existing.every(Boolean)) throw Error('Existing server identity is missing a runtime key. Restore the matching identity backup instead of rotating it.');
  for (let index = 0; index < names.length; index++) {
    const path = join(directory, names[index]);
    if (existing[index] && existing[index].length !== 32) throw Error(`${names[index]} must contain exactly 32 bytes.`);
    if (!existing[index]) await writeFile(path, randomBytes(32), { flag: 'wx', mode: 0o600 });
    if (process.platform !== 'win32') await chmod(path, 0o600);
  }
}

export function devConfiguration(values) {
  const port = (name, fallback) => {
    const raw = values[name] ?? String(fallback), number = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isInteger(number) || number < 1025 || number > 65535) throw Error(`Invalid ${name}. Use an unprivileged TCP port.`);
    return number;
  };
  const webPort = port('VAULTS_DEV_WEB_PORT', 12780), apiPort = port('VAULTS_DEV_API_PORT', 12781);
  if (webPort === apiPort) throw Error('Development UI and API ports must differ.');
  const project = values.VAULTS_MVP_PROJECT || 'vaults-acceptance';
  if (!/^vaults-acceptance(?:-[a-z0-9-]{1,40})?$/.test(project)) throw Error('VAULTS_MVP_PROJECT must be vaults-acceptance or a vaults-acceptance-<fixture> name.');
  return { webPort, apiPort, project, origin: `https://127.0.0.1:${webPort}` };
}

// An open TCP port is insufficient: it may belong to an installed server.
// Only reuse the pinned-CA Vite module server, never stop an unrelated listener.
export async function requireDevUi(values, port) {
  const ca = await readFile(join(values.VAULTS_TLS_DIR, 'ca', values.VAULTS_CA_CERT_FILE || 'ca.crt'));
  const valid = await new Promise(resolve => {
    const request = get({ hostname: '127.0.0.1', port, path: '/@vite/client', ca, timeout: 3000 }, response => {
      let text = '';
      response.on('data', chunk => { text = (text + chunk).slice(0, 512000); });
      response.on('end', () => resolve(response.statusCode === 200 && /javascript/.test(response.headers['content-type'] || '') && text.includes('createHotContext')));
      response.on('error', () => resolve(false));
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
  });
  if (!valid) throw Error(`Port ${port} is occupied by a listener that is not the expected HTTPS Vite server. It was preserved. Use free VAULTS_DEV_WEB_PORT and VAULTS_DEV_API_PORT values with a separate fixture environment; do not stop an existing installation to run development checks.`);
}

// Read-only preflight: never generate or replace an existing server identity.
export async function ensureTlsReady(values, action) {
  const directory = values.VAULTS_TLS_DIR;
  if (!directory) throw Error('VAULTS_TLS_DIR is missing from .env. Complete the TLS setup in docs/release/experimental-development.md.');
  const required = [join(directory, 'live', 'server.crt'), join(directory, 'live', 'server.key'), join(directory, 'ca', values.VAULTS_CA_CERT_FILE || 'ca.crt')];
  const failures = (await Promise.all(required.map(async path => {
    try {
      await access(path);
      const info = await stat(path);
      if (!info.isFile()) return `${path} (not a regular file)`;
      if (!info.size) return `${path} (empty file)`;
      return null;
    }
    catch (error) { return `${path} (${error.code || 'unavailable'})`; }
  }))).filter(Boolean);
  if (failures.length) throw Error(`TLS startup preflight failed for pnpm mvp:${action}. Unavailable files:\n${failures.map(path => `- ${path}`).join('\n')}\nCheck VAULTS_TLS_DIR and VAULTS_CA_CERT_FILE in .env and restore matching files from the existing identity backup. Do not initialize a replacement identity for an existing server. For a new installation only, follow docs/release/experimental-development.md.`);
}
