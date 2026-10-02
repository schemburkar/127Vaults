// One operator-facing command for source checkouts and extracted test bundles.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const bundled = existsSync(join(root, 'manifest.json'));
const [group, action, ...args] = process.argv.slice(2);
const commands = {
  install: ['deploy/test-install.mjs', 'lib/test-install.mjs', 'runTestInstall', ['init', 'start', 'status', 'stop', 'bootstrap', 'restore']],
  database: ['scripts/ops/server-data.mjs', 'lib/server-data.mjs', 'runServerData', ['keygen', 'backup', 'rehearse']],
  identity: ['scripts/ops/identity-backup.mjs', 'lib/identity-backup.mjs', 'runIdentityBackup', ['backup', 'restore']],
  envelope: ['scripts/ops/backup-envelope.mjs', 'lib/backup-envelope.mjs', 'runEnvelope', ['seal', 'verify', 'open']],
  tls: ['scripts/tls.mjs', 'lib/tls.mjs', 'runTls', ['init', 'renew']]
};
try {
  if (group === 'bundle' && action && !bundled) {
    await (await import('./scripts/ops/make-server-bundle.mjs')).runMakeBundle([action, ...args]);
  } else {
    if (group === 'install' && !bundled) throw new Error('Install commands require an extracted test bundle. Build one with: node server.mjs bundle <new-directory>.');
    const entry = commands[group];
    if (!entry || !entry[3].includes(action)) {
      throw new Error('Use bundle <directory>, install init|restore|start|status|stop|bootstrap, database keygen|backup|rehearse, identity backup|restore, envelope verify, or tls renew.');
    }
    const module = await import(`./${bundled ? entry[1] : entry[0]}`);
    await module[entry[2]]([action, ...args]);
  }
} catch (error) {
  console.error(`Server operator: ${error.message}`);
  process.exitCode = 1;
}
