// One operator-facing command for source checkouts and extracted test bundles.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const bundled = existsSync(join(root, 'manifest.json'));
const [group, action, ...args] = process.argv.slice(2);
const commands = {
  install: ['deploy/test-install.mjs', 'lib/test-install.mjs', ['init', 'start', 'status', 'stop', 'bootstrap', 'restore']],
  database: ['scripts/ops/server-data.mjs', 'lib/server-data.mjs', ['keygen', 'backup', 'rehearse']],
  identity: ['scripts/ops/identity-backup.mjs', 'lib/identity-backup.mjs', ['backup', 'restore']],
  envelope: ['scripts/ops/backup-envelope.mjs', 'lib/backup-envelope.mjs', ['verify']],
  tls: ['scripts/tls.mjs', 'lib/tls.mjs', ['renew']]
};
let script, forwarded;
if (group === 'bundle' && action && !bundled) {
  script = 'scripts/ops/make-server-bundle.mjs';
  forwarded = [action, ...args];
} else {
  if (group === 'install' && !bundled) throw new Error('Install commands require an extracted test bundle. Build one with: node server.mjs bundle <new-directory>.');
  const entry = commands[group];
  if (!entry || !entry[2].includes(action)) {
    throw new Error('Use bundle <directory>, install init|restore|start|status|stop|bootstrap, database keygen|backup|rehearse, identity backup|restore, envelope verify, or tls renew.');
  }
  script = bundled ? entry[1] : entry[0];
  forwarded = [action, ...args];
}
const child = spawn(process.execPath, [join(root, script), ...forwarded], { cwd: root, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', code => { if (code !== null) process.exitCode = code; });
