import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const format = /^[A-Za-z0-9_-]{3,40}$/;
export function hashPassword(password, salt = randomBytes(32)) {
  if (typeof password !== 'string' || password.length < 16 || password.length > 256) throw new Error('Password must be 16–256 characters.');
  return { salt: salt.toString('base64url'), hash: scryptSync(password, salt, 64).toString('base64url') };
}
export function loadOperators(path, { allowVirtualizedPermissions = false } = {}) {
  if (!path || !existsSync(path)) return [];
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (!allowVirtualizedPermissions && process.platform !== 'win32' && (stat.mode & 0o022) !== 0)) throw new Error('Admin operator file permissions are unsafe.');
  const input = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(input.operators) || input.operators.length < 1 || input.operators.length > 16) throw new Error('Invalid admin operator file.');
  const names = new Set();
  const operators = input.operators.map(item => {
    if (!format.test(item.username) || !['owner', 'admin'].includes(item.role) || names.has(item.username)) throw new Error('Invalid admin operator.');
    const salt = Buffer.from(item.salt ?? '', 'base64url');
    const hash = Buffer.from(item.hash ?? '', 'base64url');
    if (salt.length !== 32 || hash.length !== 64) throw new Error('Invalid admin operator hash.');
    names.add(item.username);
    return { username: item.username, role: item.role, salt, hash };
  });
  if (!operators.some(item => item.role === 'owner')) throw new Error('At least one owner operator is required.');
  return operators;
}
export function verifyPassword(operator, password) {
  if (!operator || typeof password !== 'string' || password.length > 256) return false;
  return timingSafeEqual(scryptSync(password, operator.salt, 64), operator.hash);
}

export function runAdmin(args) {
  const [action, username, destination] = args;
  const password = process.env.VAULTS_ADMIN_SETUP_PASSWORD;
  if (args.length !== 3 || action !== 'init' || !format.test(username ?? '') || !destination || !password) {
    throw new Error('Set VAULTS_ADMIN_SETUP_PASSWORD, then use admin init <username> <new operator-file>. The first operator is an owner.');
  }
  const item = { username, role: 'owner', ...hashPassword(password) };
  writeFileSync(destination, JSON.stringify({ operators: [item] }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(`Created owner operator ${username}. Restart the server to load the operator file.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [username, role, destination] = process.argv.slice(2);
    if (role !== 'owner' || process.argv.length !== 5) throw new Error('Use credentials.mjs <username> owner <new operator-file>.');
    runAdmin(['init', username, destination]);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
