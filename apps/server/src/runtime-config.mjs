import { lstatSync, readFileSync } from 'node:fs';

const fail = message => { throw new Error(message); };

export function readSecretFile(path, label, pattern, { allowVirtualizedPermissions = false } = {}) {
  if (!path) fail(`${label} file is required.`);
  let stat;
  let bytes;
  try {
    stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} file must be a regular file.`);
    if (!allowVirtualizedPermissions && process.platform !== 'win32' && (stat.mode & 0o022) !== 0) fail(`${label} file permissions are too broad.`);
    bytes = readFileSync(path);
  } catch (error) {
    if (error?.message?.startsWith(label)) throw error;
    fail(`${label} file must be readable.`);
  }
  if (bytes.includes(0)) fail(`${label} file is malformed.`);
  const value = bytes.toString('utf8').replace(/\r?\n$/, '');
  if (!value || !pattern.test(value)) fail(`${label} file is malformed.`);
  return value;
}

export function runtimeDatabaseConfig(env = process.env) {
  const options = { allowVirtualizedPermissions: env.VAULTS_ALLOW_VIRTUALIZED_SECRET_PERMISSIONS === '1' };
  const password = readSecretFile(env.VAULTS_DATABASE_PASSWORD_FILE, 'Database password', /^[a-f0-9]{64}$/, options);
  return { host: env.VAULTS_DATABASE_HOST ?? 'database', port: Number(env.VAULTS_DATABASE_PORT ?? 5432),
    database: env.VAULTS_DATABASE_NAME ?? 'vaults_experimental', user: env.VAULTS_DATABASE_USER ?? 'vaults', password };
}

export function readinessToken(env = process.env) {
  return readSecretFile(env.VAULTS_READINESS_TOKEN_FILE, 'Readiness token', /^[a-f0-9]{64}$/,
    { allowVirtualizedPermissions: env.VAULTS_ALLOW_VIRTUALIZED_SECRET_PERMISSIONS === '1' });
}
