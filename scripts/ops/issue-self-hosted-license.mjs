// Offline operator tool. Keep the issuer private key outside this repository and customer bundles.
import { createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyLicenseFile } from '../../apps/server/src/license-status.mjs';

export function issueSelfHostedLicense({ privateKeyPem, keyId, installationId, plan, majorVersion,
  maxActiveUsers, sequence, expiresAt, now = new Date() }) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(keyId ?? '') || !['personal', 'commercial'].includes(plan)
    || !Number.isSafeInteger(sequence) || sequence < 1 || !Number.isSafeInteger(maxActiveUsers)
    || maxActiveUsers < 1 || maxActiveUsers > 100000 || !Number.isFinite(now.getTime())
    || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime()) throw Error('Invalid license request.');
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw Error('An Ed25519 issuer key is required.');
  const issuedAt = now.toISOString();
  const payload = { licenseId: randomUUID(), installationId, plan,
    majorVersion: plan === 'personal' ? majorVersion : null, maxActiveUsers, issuedAt,
    notBefore: issuedAt, expiresAt: new Date(expiresAt).toISOString(), sequence };
  const bytes = Buffer.from(JSON.stringify(payload));
  const license = JSON.stringify({ schemaVersion: 1, keyId, payload: bytes.toString('base64url'),
    signature: sign(null, Buffer.concat([Buffer.from('127Vaults license v1\0'), bytes]), key).toString('base64url') }) + '\n';
  const publicKeyPem = createPublicKey(key).export({ type: 'spki', format: 'pem' });
  verifyLicenseFile(license, { [keyId]: publicKeyPem }, installationId);
  return { license, publicKeys: JSON.stringify({ [keyId]: publicKeyPem }, null, 2) + '\n' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    const options = new Map();
    for (let i = 0; i < args.length; i += 2) {
      if (!args[i]?.startsWith('--') || !args[i + 1] || options.has(args[i])) throw Error('Invalid arguments.');
      options.set(args[i], args[i + 1]);
    }
    const expected = ['--private-key', '--key-id', '--installation-id', '--plan', '--major-version',
      '--max-users', '--sequence', '--expires', '--output', '--public-keys-output'];
    if (expected.some(name => !options.has(name)) || [...options.keys()].some(name => !expected.includes(name))) throw Error('Missing or unknown argument.');
    const privateKeyPem = await readFile(resolve(options.get('--private-key')), 'utf8');
    const result = issueSelfHostedLicense({ privateKeyPem, keyId: options.get('--key-id'),
      installationId: options.get('--installation-id'), plan: options.get('--plan'),
      majorVersion: options.get('--major-version') === 'none' ? null : Number(options.get('--major-version')),
      maxActiveUsers: Number(options.get('--max-users')), sequence: Number(options.get('--sequence')),
      expiresAt: options.get('--expires') });
    await writeFile(resolve(options.get('--output')), result.license, { flag: 'wx', mode: 0o600 });
    await writeFile(resolve(options.get('--public-keys-output')), result.publicKeys, { flag: 'wx', mode: 0o600 });
    process.stdout.write('Signed license and issuer public key file written. Deliver only after manual approval.\n');
  } catch (error) {
    process.stderr.write(`License issuance failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
