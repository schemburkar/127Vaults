// Creates a disposable test issuer key outside the repository.
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = resolve(process.argv[2] ?? '');
if (!process.argv[2] || target === checkout || target.startsWith(checkout + sep)) throw Error('Choose a new private-key path outside the repository.');
const { privateKey } = generateKeyPairSync('ed25519');
await writeFile(target, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
const publicKeysPath = `${target}.keys.json`;
const publicKeys = { mock: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) };
await writeFile(publicKeysPath, JSON.stringify(publicKeys, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
process.stdout.write(`Disposable Ed25519 issuer key written to ${target}. Keep it private.\nPublic key catalogue: ${publicKeysPath}\n`);
