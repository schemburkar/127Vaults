import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.mjs';
import { execute, runWrangler } from './deploy.mjs';
export async function backupWithRetry(config, { backup = () => execute('backup', config, { run: (args, settings) => runWrangler(args, settings, { capture: true }) }),
  delay = ms => new Promise(done => setTimeout(done, ms)), attempts = 3 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { await backup(); return; }
    catch (error) {
      const diagnostic = error.diagnosticFile ? await readFile(error.diagnosticFile, 'utf8').catch(() => '') : '';
      // Retry only the observed provider internal error. Auth/configuration failures still stop immediately.
      if (attempt === attempts || !/\[code:\s*7500\]/.test(diagnostic.replace(/\x1b\[[0-9;]*m/g, ''))) throw error;
      console.log(`Cloudflare backup service returned an internal error; retrying (${attempt}/${attempts}). No deployment step has run.`);
      await delay(attempt * 10000);
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await backupWithRetry(await loadConfig(resolve(process.argv[2])));
}
