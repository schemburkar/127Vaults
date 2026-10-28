import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const receiptFile = resolve(root, '.cloudflare-deploy/billing/verification.json');
const commands = [
  ['scripts/cloudflare/check.mjs'],
  ['--check', 'apps/server/src/subscription-refresh.mjs'],
  ['--check', 'customer-website/billing.mjs'],
  ['--check', 'admin-website/billing-admin.mjs'],
  ['--test', '--test-name-pattern', 'Dodo', 'apps/public-intake/test/cloudflare-worker.test.mjs'],
  ['--test', 'apps/server/test/subscription-refresh.test.mjs', 'apps/server/test/license-status.test.mjs',
    'apps/server/test/license-handler.test.mjs', 'apps/server/test/license-write-guard.test.mjs',
    'apps/server/test/license-seats.test.mjs', 'apps/server/test/license-clock.test.mjs',
    'apps/web/test/license-entitlement.test.mjs', 'apps/desktop/test/import-and-license-focus.test.mjs',
    'deploy/license-files.test.mjs', 'scripts/cloudflare/deploy.test.mjs', 'scripts/ops/identity-backup.test.mjs'],
];
const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
const receipt = { schemaVersion: 1, startedAt: new Date().toISOString(), sourceRevision: git(['rev-parse', 'HEAD']),
  workingTreeDiffSha256: createHash('sha256').update(git(['diff', 'HEAD'])).digest('hex'), checks: [] };
const changed = [...new Set([git(['diff', '--name-only', 'HEAD']), git(['ls-files', '--others', '--exclude-standard'])]
  .flatMap(v => v.split(/\r?\n/)).filter(Boolean))].sort();
receipt.changedFiles = await Promise.all(changed.map(async path => {
  try { return { path, sha256: createHash('sha256').update(await readFile(resolve(root, path))).digest('hex') }; }
  catch (error) { if (error.code === 'ENOENT') return { path, deleted: true }; throw error; }
}));
await mkdir(dirname(receiptFile), { recursive: true });
for (const args of commands) {
  const code = await new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', value => done(value ?? 1));
  });
  receipt.checks.push({ command: [process.execPath, ...args], exitCode: code });
  if (code !== 0) break;
}
receipt.finishedAt = new Date().toISOString();
receipt.passed = receipt.checks.length === commands.length && receipt.checks.every(v => v.exitCode === 0);
await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(`Billing verification ${receipt.passed ? 'passed' : 'failed'}; receipt saved to ${receiptFile}`);
if (!receipt.passed) process.exitCode = 1;
