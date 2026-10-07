// Creates a disposable test issuer key outside the repository.
import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = resolve(process.argv[2] ?? '');
if (!process.argv[2] || target === checkout || target.startsWith(checkout + sep)) throw Error('Choose a new private-key path outside the repository.');
const { privateKey } = generateKeyPairSync('ed25519');
await writeFile(target, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
process.stdout.write(`Disposable Ed25519 issuer key written to ${target}. Keep it private.\n`);
