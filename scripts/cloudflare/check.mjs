import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
for (const location of [new URL('./', import.meta.url), new URL('../../apps/public-intake/cloudflare/', import.meta.url)]) {
  for (const name of readdirSync(location).filter(name => name.endsWith('.mjs'))) {
    execFileSync(process.execPath, ['--check', fileURLToPath(new URL(name, location))], { stdio: 'inherit', windowsHide: true });
  }
}
console.log('Cloudflare Worker and deployment script syntax passed.');
