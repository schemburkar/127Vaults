import { access, stat, lstat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { get } from 'node:https';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { homedir } from 'node:os';

export const desktopProfile = () => process.env.VAULTS_CONFIG_DIR || join(process.env.APPDATA || join(homedir(), '.config'), '127Vaults');
export async function ensureDevOriginIsolated(origin, profile = desktopProfile(), identity) {
  let trust;
  try { trust = await readFile(join(profile, 'trust.conf'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const address = /^url=(.+)$/m.exec(trust)?.[1]?.trim();
  if (address && new URL(address).origin === origin) {
    const error=Error('This address belongs to an enrolled Desktop profile. Development startup cannot replace its server or history, even when the port is free. Restart the pinned server with node scripts/ops/local-server.mjs restart. Use independent development ports, identity and database for a new fixture.');
    error.code='DEV_ORIGIN_ENROLLED';throw error;
  }
  if (identity) {
    try {
      const binding = JSON.parse(await readFile(join(profile, 'tenant-binding.json'), 'utf8'));
      const installation = (await readFile(join(identity, 'installation-id'), 'utf8')).trim();
      if (installation === binding.tenant_id) throw Error('Development fixtures must use an independent identity and database. This identity belongs to the enrolled Desktop installation.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

// Read-only selection. A recorded installation may be restarted, never rebuilt or adopted implicitly.
export async function devStartupPlan({origin,root,identity,profile=desktopProfile(),allowPinned=true}) {
  try {await ensureDevOriginIsolated(origin,profile,identity);return {mode:'fixture',origin};}
  catch(error) {if(error.code!=='DEV_ORIGIN_ENROLLED'||!allowPinned)throw error;}
  let pinned;
  try {pinned=JSON.parse(await readFile(join(root,'.tools/local-server.json'),'utf8'));}
  catch {throw Error('Desktop trusts this address, but its recorded local server is unavailable. Preserve Desktop trust and restore .tools/local-server.json, or use an independent fixture address and identity. No server was changed.');}
  if(pinned.origin!==origin || !isAbsolute(pinned.identity??'') || !/^[a-f0-9-]{36}$/.test(pinned.installationId??'') ||
     !['database','server','relay'].every(role=>/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(pinned[role]??'') && Array.isArray(pinned.mounts?.[role]) && pinned.mounts[role].length))
    throw Error('The recorded local server does not match this Desktop address. Existing trust, data and listeners were preserved. Review the recorded installation before restarting it.');
  const trust=await readFile(join(profile,'trust.conf'),'utf8');
  const expected=/^ca_sha256=([a-f0-9]{64})\r?$/m.exec(trust)?.[1];
  const ca=await readFile(join(pinned.identity,'ca/ca.crt'));
  const activeCa=await readFile(join(profile,'installation-ca.pem'));
  const digest=createHash('sha256').update(ca).digest('hex');
  if(createHash('sha256').update(activeCa).digest('hex')!==digest)throw Error('The recorded server certificate differs from Desktop trust. Restore the matching server identity; trust was not replaced.');
  let bound=false;
  try {
    const binding=JSON.parse(await readFile(join(profile,'tenant-binding.json'),'utf8'));
    if(binding.tenant_id!==pinned.installationId)throw Error('The recorded installation differs from Desktop history. Existing data and trust were preserved.');
    bound=true;
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  // Older local profiles can retain stale display metadata. Require both the active
  // pinned certificate and durable tenant binding; never rewrite either trust file.
  if(expected!==digest&&!bound)throw Error('Desktop certificate metadata is inconsistent and no matching history binding is available. Restore matching trust before restarting.');
  return {mode:'pinned',origin,legacyFingerprint:expected!==digest};
}

export async function ensureRuntimeKeys(directory) {
  const names = ['token.key', 'checkpoint.key'];
  const existing = await Promise.all(names.map(async name => {
    try {
      const path=join(directory,name),info=await lstat(path);
      if(!info.isFile()||info.isSymbolicLink())throw Error('Runtime keys must be regular files without redirects.');
      return await readFile(path);
    }
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

export async function ensureRuntimeSecret(directory,name,value) {
  const path=join(directory,name);
  let info;
  try{info=await lstat(path);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(info) {
    if(!info.isFile()||info.isSymbolicLink())throw Error('Runtime secrets must be regular files without redirects.');
    if((await readFile(path,'utf8')).trim()!==value)throw Error('Existing runtime secret differs from namespace configuration; restore the matching configuration or rotate explicitly.');
  }else await writeFile(path,value,{flag:'wx',mode:0o600});
  if(process.platform!=='win32')await chmod(path,0o600);
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
  if (!/^(?:vaults-acceptance(?:-[a-z0-9-]{1,40})?|vaults-development|vaults-test-[a-z0-9-]{1,40})$/.test(project)) throw Error('VAULTS_MVP_PROJECT must be vaults-acceptance or a vaults-acceptance-<fixture> name.');
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
