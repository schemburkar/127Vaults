// Offline issuer tool. A revocation is bound to one installation and license ID.
import { createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyLicenseRevocationFile } from '../../apps/server/src/license-status.mjs';

export function issueLicenseRevocation({ privateKeyPem, keyId, installationId, licenseId, revokedAt, now = new Date() }) {
  const effectiveRevocation = revokedAt === 'now' ? now : new Date(revokedAt);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(keyId ?? '') || !Number.isFinite(now.getTime())
    || !Number.isFinite(effectiveRevocation.getTime()) || effectiveRevocation.getTime() < now.getTime()) {
    throw Error('Invalid revocation request.');
  }
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw Error('An Ed25519 issuer key is required.');
  const payload = Buffer.from(JSON.stringify({ revocationId: randomUUID(), installationId, licenseId,
    issuedAt: now.toISOString(), revokedAt: effectiveRevocation.toISOString() }));
  const revocation = JSON.stringify({ schemaVersion: 1, keyId, payload: payload.toString('base64url'),
    signature: sign(null, Buffer.concat([Buffer.from('127Vaults license revocation v1\0'), payload]), key).toString('base64url') }) + '\n';
  const publicKeyPem = createPublicKey(key).export({ type: 'spki', format: 'pem' });
  verifyLicenseRevocationFile(revocation, { [keyId]: publicKeyPem }, installationId, licenseId);
  return revocation;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    const options = new Map();
    for (let i = 0; i < args.length; i += 2) {
      if (!args[i]?.startsWith('--') || !args[i + 1] || options.has(args[i])) throw Error('Invalid arguments.');
      options.set(args[i], args[i + 1]);
    }
    const expected = ['--private-key', '--key-id', '--installation-id', '--license-id', '--revoked-at', '--output'];
    if (expected.some(name => !options.has(name)) || [...options.keys()].some(name => !expected.includes(name))) throw Error('Missing or unknown argument.');
    const revocation = issueLicenseRevocation({ privateKeyPem: await readFile(resolve(options.get('--private-key')), 'utf8'),
      keyId: options.get('--key-id'), installationId: options.get('--installation-id'),
      licenseId: options.get('--license-id'), revokedAt: options.get('--revoked-at') });
    await writeFile(resolve(options.get('--output')), revocation, { flag: 'wx', mode: 0o600 });
    process.stdout.write('Signed installation-bound revocation written. Deliver through the operator channel.\n');
  } catch (error) {
    process.stderr.write(`Revocation issuance failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
