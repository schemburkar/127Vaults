import { spawnSync } from 'node:child_process';
import { cp, copyFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaChecksum } from '../apps/server/src/schema.mjs';
import { overlayChecksum } from '../apps/server/internal-cloud/operator.mjs';

const output = new URL('../apps/server/wasm-auth/', import.meta.url);
const assets = new URL('worker-assets/', output);
const hyperdriveId = process.env.VAULTS_WORKER_HYPERDRIVE_ID ?? '00000000000000000000000000000000';
if (!/^[a-f0-9]{32}$/.test(hyperdriveId)) throw Error('Invalid vault Hyperdrive configuration ID.');

await cp(new URL('../apps/web/dist/', import.meta.url), assets, { recursive: true });
for (const asset of ['landing.html', 'landing.css']) {
  await copyFile(new URL(`../apps/server/internal-cloud/${asset}`, import.meta.url), new URL(asset, assets));
}
await writeFile(new URL('worker-manifest.mjs', output),
  `export const schemaChecksum = ${JSON.stringify(schemaChecksum)};\nexport const overlayChecksum = ${JSON.stringify(overlayChecksum)};\n`);
await writeFile(new URL('worker-config.json', output), JSON.stringify({
  name: '127vaults-cloud-vault', main: '../internal-cloud/worker.mjs',
  compatibility_date: '2026-07-01', compatibility_flags: ['nodejs_compat'],
  workers_dev: false, preview_urls: false, routes: [],
  assets: { directory: './worker-assets', binding: 'ASSETS', run_worker_first: true,
    html_handling: 'none', not_found_handling: 'none' },
  hyperdrive: [{ binding: 'VAULT_DB', id: hyperdriveId }]
}, null, 2) + '\n');
console.log(`Prepared local Worker configuration at ${fileURLToPath(new URL('worker-config.json', output))}`);
const require = createRequire(import.meta.url);
const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const built = spawnSync(process.execPath, [wrangler, 'deploy', '--config', 'worker-config.json',
  '--dry-run', '--outdir', 'worker-bundle'], { cwd: fileURLToPath(output), stdio: 'inherit', windowsHide: true });
if (built.error) throw built.error;
if (built.status !== 0) process.exitCode = 1;
