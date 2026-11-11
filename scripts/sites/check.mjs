import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repository } from './assets.mjs';

const checks = [
  ['--check', 'scripts/sites/local.mjs'], ['--check', 'scripts/sites/assets.mjs'],
  ['--check', 'admin-website/admin-shell.mjs'], ['--check', 'admin-website/customer-mail.mjs'], ['--check', 'admin-website/licenses.mjs'], ['--check', 'admin-website/access-admin.mjs'], ['--check', 'admin-website/billing-admin.mjs'], ['--check', 'admin-website/releases.mjs'],
  ['--check', 'customer-website/trial.mjs'], ['--check', 'customer-website/billing.mjs'],
  ['--check', 'customer-website/portal.mjs'], ['--check', 'customer-website/portal-client.mjs'],
  ['--check', 'customer-website/passkeys.mjs'], ['--check', 'apps/public-intake/cloudflare/customer-passkeys.mjs'],
  ['--check', 'apps/public-intake/cloudflare/customer-portal.mjs'],
  ['--check', 'apps/public-intake/cloudflare/public-site.mjs'], ['--check', 'apps/public-intake/cloudflare/intake-only.mjs'],
  ['--test', 'scripts/sites/local.test.mjs', 'scripts/sites/portal.test.mjs', 'scripts/sites/manual-mail.test.mjs', 'scripts/sites/customer-email.test.mjs', 'scripts/sites/intake-protection.test.mjs', 'customer-website/trial-navigation.test.mjs', 'apps/public-intake/test/operator-session.test.mjs'],
];
const receipt = { schemaVersion: 1, startedAt: new Date().toISOString(), sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8', windowsHide: true }).trim(), checks: [] };
for (const args of checks) {
  const exitCode = await new Promise((done, reject) => {
    const process = spawn(globalThis.process.execPath, args, { cwd: repository, stdio: 'inherit', windowsHide: true });
    process.on('error', reject); process.on('exit', code => done(code ?? 1));
  });
  receipt.checks.push({ args, exitCode }); if (exitCode !== 0) break;
}
receipt.finishedAt = new Date().toISOString(); receipt.passed = receipt.checks.length === checks.length && receipt.checks.every(v => v.exitCode === 0);
const directory = join(repository, '.tools', 'site-checks'); await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(`Site separation verification ${receipt.passed ? 'passed' : 'failed'}. Receipt: ${join(directory, 'verification.json')}`);
if (!receipt.passed) process.exitCode = 1;
