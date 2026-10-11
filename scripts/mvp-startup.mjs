import { access } from 'node:fs/promises';
import { join } from 'node:path';

// Read-only preflight: never generate or replace an existing server identity.
export async function ensureTlsReady(values, action) {
  const directory = values.VAULTS_TLS_DIR;
  if (!directory) throw Error('VAULTS_TLS_DIR is missing from .env. Complete the TLS setup in docs/release/experimental-development.md.');
  const required = [join(directory, 'live', 'server.crt'), join(directory, 'live', 'server.key'), join(directory, 'ca', values.VAULTS_CA_CERT_FILE || 'ca.crt')];
  const present = await Promise.all(required.map(path => access(path).then(() => true, () => false)));
  if (!present.every(Boolean)) throw Error(`Local TLS files are missing in ${directory}. Run pnpm tls:init -- 127.0.0.1 "${directory}" before pnpm mvp:${action}.`);
}
