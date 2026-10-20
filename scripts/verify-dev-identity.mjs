// Read-only checks before adopting a recovered identity. Never prints key material.
import { readFile } from 'node:fs/promises';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { join } from 'node:path';
import { verifyLicenseFile, licenseStatus } from '../apps/server/src/license-status.mjs';

const [identity, profile, expectedInstallation] = process.argv.slice(2);
if (!identity || !profile || !/^[0-9a-f-]{36}$/.test(expectedInstallation ?? '')) throw Error('Identity, desktop profile and installation UUID are required.');
const pinned = new X509Certificate(await readFile(join(profile, 'installation-ca.pem')));
const ca = new X509Certificate(await readFile(join(identity, 'ca/ca.crt')));
const certificate = new X509Certificate(await readFile(join(identity, 'live/server.crt')));
const key = createPrivateKey(await readFile(join(identity, 'live/server.key')));
const binding = JSON.parse(await readFile(join(profile, 'tenant-binding.json'), 'utf8'));
const restoredInstallation = (await readFile(join(identity, 'installation-id'), 'utf8')).trim();
if (binding.tenant_id !== expectedInstallation || restoredInstallation !== expectedInstallation) throw Error('Recovered identity does not match the enrolled desktop installation.');
if (!ca.raw.equals(pinned.raw)) throw Error('Recovered CA does not match the desktop trust pin.');
if (!certificate.verify(ca.publicKey) || !certificate.checkPrivateKey(key) || !certificate.checkIP('127.0.0.1')) throw Error('Recovered certificate, key or loopback endpoint does not match.');
if (Date.now() < Date.parse(certificate.validFrom) || Date.now() >= Date.parse(certificate.validTo)) throw Error('Recovered server certificate is outside its validity period.');
const sequence = (await readFile(join(identity, 'runtime/licenses/highest-sequence'), 'utf8')).trim();
if (!/^[1-9]\d*$/.test(sequence)) throw Error('Recovered development license sequence is invalid.');
const license = verifyLicenseFile(await readFile(join(identity, `runtime/licenses/${sequence}.json`), 'utf8'),
  JSON.parse(await readFile(join(identity, `runtime/licenses/${sequence}.keys.json`), 'utf8')), expectedInstallation);
if (licenseStatus(license).mode !== 'active') throw Error('Recovered development license is not active.');
console.log('Recovered identity matches the desktop installation, pinned CA, private key and loopback endpoint; signed license is active.');
