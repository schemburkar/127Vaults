// Verify retained evidence without changing accounts or restarting the fixture.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verify } from '../deploy/install.mjs';
import { verifyRelease } from './release/verify-release.mjs';

const [work] = process.argv.slice(2);
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
  serverRevision: fixture.serverRevision, result,
  cli: { path: cliPath, sourceRevision: cli.sourceRevision, files: cli.files },
  cleanup: ['Exact Compose/manifest/environment restored and verified', 'Owned fixture stopped; original server/database healthy', 'Revoked device journal and pending request preserved'],
  limits: result.limits,
}, null, 2) + '\n');
console.log('Ownership evidence, selected CLI, exact cleanup and revoked draft verified.');
