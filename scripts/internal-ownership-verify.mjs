// Verify retained evidence without changing accounts or restarting the fixture.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verify } from '../deploy/install.mjs';
import { verifyRelease } from './release/verify-release.mjs';

const [work, ...flags] = process.argv.slice(2);
assert.ok(flags.every(flag => ['--with-browser', '--with-stale'].includes(flag)));
assert.equal(new Set(flags).size, flags.length);
assert.ok(work && isAbsolute(work));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const fixture = await json(join(work, 'fixture.json'));
assert.equal(fixture.serverId, '98027ac4-9882-42d5-812a-a18c972c299f');
assert.equal(fixture.project, 'vaults-test-632a4442dfd2');
assert.equal(fixture.origin, 'https://127.0.0.1:12898');
const result = await json(join(work, 'ownership-evidence.json'));
assert.equal(result.status, 'passed');
assert.equal(result.serverId, fixture.serverId);
assert.equal(result.checks.length, 5);
assert.equal(result.memberId, (await json(join(work, 'ownership-member.json'))).accountId);
const additional = {};
if (flags.includes('--with-browser')) {
  const browser = await json(join(work, 'ownership-admin-browser.json'));
  assert.equal(browser.status, 'passed');
  assert.equal(browser.serverId, fixture.serverId);
  assert.equal(browser.serverRevision, fixture.serverRevision);
  assert.equal(browser.checks.length, 5);
  assert.equal(browser.mutations.length, 4);
  assert.equal(browser.mutations[0].action, 'ownership.request');
  assert.equal(browser.mutations[0].status, 200);
  assert.equal(browser.mutations[1].action, 'ownership.cancel');
  assert.equal(browser.mutations[1].status, 200);
  assert.equal(browser.mutations[1].targetId, browser.mutations[0].requestId);
  const denied = browser.mutations.slice(2);
  assert.ok(denied.every(row => row.action === 'account.suspend' && row.status === 409));
  assert.equal(denied[0].requestId, denied[1].requestId);
  additional.adminBrowser = browser;
}
if (flags.includes('--with-stale')) {
  const stale = await json(join(work, 'ownership-stale-evidence.json'));
  assert.equal(stale.status, 'passed');
  assert.equal(stale.serverId, fixture.serverId);
  assert.equal(stale.serverRevision, fixture.serverRevision);
  assert.ok(stale.elapsedMs >= 310000);
  assert.equal(stale.checks.length, 3);
  additional.staleAuthentication = stale;
}
for (const [name, snapshot] of [['compose.test.yaml', 'compose'], ['manifest.json', 'manifest'], ['.env', 'env']]) {
  assert.deepEqual(await readFile(join(fixture.bundle, name)), await readFile(join(work, 'ownership-' + snapshot + '-before')));
}
await verify(fixture.bundle);
const revoked = await json(join(work, 'revocation-evidence.json'));
const profile = join(work, 'clients-revocation/device-b');
assert.equal((await readFile(join(profile, 'vault-removal.json'))).toString('base64'), revoked.journalBytes);
assert.deepEqual((await json(join(profile, 'replicas', revoked.destination + '.json'))).pending, revoked.pending);
const cliPath = 'C:/Projects/127Vaults-Releases/cli/internal-20261015-a/windows';
const cli = await verifyRelease(cliPath);
assert.equal(cli.sourceRevision, '600f206ce300e643a0b3d2dfd8259bdde597cb1a');
const run = promisify(execFile);
const { stdout } = await run('podman', ['ps', '--format', '{{.Names}} {{.Status}}'], { windowsHide: true });
assert.ok(!stdout.includes(fixture.project), 'Owned fixture must be stopped after cleanup');
assert.ok(!stdout.includes('vaults-ownership-mail-20261015-a'));
for (const service of ['server', 'database']) {
  assert.match(stdout, new RegExp('vaults-test-a0540f7d9c99_' + service + '_1 Up[^\\r\\n]*\\(healthy\\)'));
}
await writeFile(join(work, 'ownership-combined-evidence.json'), JSON.stringify({
  status: 'passed', verifiedAt: new Date().toISOString(), serverId: fixture.serverId,
  serverRevision: fixture.serverRevision, result, ...additional,
  cli: { path: cliPath, sourceRevision: cli.sourceRevision, files: cli.files },
  cleanup: ['Exact Compose/manifest/environment restored and verified', 'Owned fixture stopped; original server/database healthy', 'Revoked device journal and pending request preserved'],
  limits: result.limits,
}, null, 2) + '\n');
console.log('Ownership evidence, selected CLI, exact cleanup and revoked draft verified.');
