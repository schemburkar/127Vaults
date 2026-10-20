import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';

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
