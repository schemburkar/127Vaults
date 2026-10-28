import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptionKey, unseal } from '../../apps/public-intake/cloudflare/crypto.mjs';

export async function readLocalMail(directory) {
  const key = await encryptionKey((await readFile(join(directory, 'intake-key'), 'utf8')).trim(), 'local-customer-mail');
  const source = await readFile(join(directory, 'customer-mail.jsonl'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  return Promise.all(source.split(/\r?\n/).filter(Boolean).map(async line => {
    const row = JSON.parse(line); return unseal(row.envelope, key, `local-mail:${row.id}`);
  }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--work')) throw Error('Use [--work PRIVATE-PREVIEW-DIRECTORY].');
  const directory = resolve(args[1] ?? fileURLToPath(new URL('../../.tools/site-preview', import.meta.url)));
  const messages = await readLocalMail(directory);
  for (const message of messages.slice(-10)) console.log(`To: ${message.to}\n${message.subject}\n${message.text}\n`);
  if (!messages.length) console.log('No local customer sign-in emails yet.');
}
