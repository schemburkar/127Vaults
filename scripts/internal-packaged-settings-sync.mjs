// Real packaged agents on explicit enrolled fictitious profiles. This matrix
// changes only the default view and an existing synthetic lifecycle item.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
const [phase, executable, profile, path] = process.argv.slice(2);
assert.ok(['baseline','peer-ready','queue','offline-reopen','peer-update','review','resolve','verify','restore','restored-peer'].includes(phase));
for (const value of [executable, profile, path]) assert.ok(value && isAbsolute(value));
assert.match(basename(executable), /^127vaults(?:\.exe)?$/);
const fixtureServer = '14725fef-f5b4-4cb8-afe0-77aa3d80b268';
const device = await readFile(profile + '/device.conf', 'utf8');
assert.ok(device.includes('username=owner_127\n') && device.includes(`server_id=${fixtureServer}\n`));
const deviceId = /^device_id=(.+)$/m.exec(device)?.[1]; assert.ok(deviceId);
const evidence = JSON.parse(await readFile(path, 'utf8')); assert.equal(evidence.fixtureServer, fixtureServer);
assert.ok(evidence.title.startsWith('Packaged CLI cross-OS '));
assert.equal(evidence['lifecycle-restored-peerPassed'], true);
assert.ok(['server','local'].includes(process.env.VAULTS_FIXTURE_SETTINGS_KEEP || 'server'));
const digest = value => createHash('sha256').update(value).digest('hex');
const settingsFile = profile + '/vault-settings.json';
const replicaFile = profile + '/replicas/' + evidence.vaultId + '.json';
const replica = async () => JSON.parse(await readFile(replicaFile, 'utf8'));
const pendingHash = async () => digest(JSON.stringify((await replica()).pending));
// An unset synchronized default is the same all-items view as explicit All.
const state = value => ({names:value.names,collections:value.collections,defaultView:value.defaultView || {kind:'all'},removalPreference:value.removalPreference});
if (evidence.settingsBaseline && !evidence.settingsBaseline.defaultView) evidence.settingsBaseline.defaultView = {kind:'all'};
async function command(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args, '--config-dir', profile], {windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output = '', error = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('Settings fixture command timed out')); }, 60000);
    child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => error += bytes);
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); code ? reject(Error(`Settings fixture ${args[0]} failed: ${error.trim()}`)) : resolve(output.trim()); });
    child.stdin.end(input);
  });
}
const json = async args => JSON.parse(await command(args));
async function acceptUndraftedServer() {
  const current = await json(['vault','settings']);
  assert.equal(current.pending, false, 'Never discard a fixture settings draft');
  if (current.conflict) {
    const review = await json(['vault','settings-review']); assert.equal(review.localPending, false);
    assert.equal(review.server.names[evidence.vaultId], evidence.vaultName);
    await command(['vault','settings-resolve','--keep','server']);
  }
  return await json(['vault','settings']);
}
async function setView(view) {
  await command(['vault','default-view',view?.kind || 'all', ...(view?.id ? [view.id] : [])]);
}
const agent = spawn(executable, ['agent-serve','--username','owner_127','--config-dir',profile], {windowsHide:true,stdio:['pipe','pipe','pipe']});
let agentReady = false;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Settings fixture agent startup timed out')), 60000);
    agent.stdout.on('data', bytes => { if (String(bytes).includes('ready')) { agentReady = true; clearTimeout(timer); resolve(); } });
    agent.stderr.resume(); agent.on('error', reject); agent.on('close', () => { clearTimeout(timer); if (!agentReady) reject(Error('Settings fixture agent failed')); });
    agent.stdin.end(JSON.stringify({account_secret:'07'.repeat(32),master_password:'fictitious password 127vaults'}) + '\n');
  });
  if (['queue','offline-reopen'].includes(phase)) await assert.rejects(command(['device','list']), /unavailable while offline/);
  else await command(['device','list']);
  if (phase === 'baseline') {
    assert.equal(deviceId, evidence.writerDevice);
    assert.equal((await replica()).pending.length, 0);
    const current = await acceptUndraftedServer();
    evidence.settingsBaseline = state(current);
    const item = await json(['item','get',evidence.itemId,'--vault',evidence.vaultId]);
    assert.deepEqual(item.customFields, [], 'Only the existing synthetic lifecycle item is accepted');
    assert.equal(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId,'--password','password']), 'fictitious-lifecycle-password');
    evidence.itemBaseline = {title:item.title,website:item.website,username:item.username};
    evidence.settingsChoice = process.env.VAULTS_FIXTURE_SETTINGS_KEEP || 'server';
    const original = current.defaultView || {kind:'all'};
    evidence.localView = original.kind === 'vault' && original.id === evidence.vaultId ? {kind:'all'} : {kind:'vault',id:evidence.vaultId};
    evidence.peerView = evidence.localView.kind === 'all' ? {kind:'vault',id:evidence.vaultId} : {kind:'all'};
    evidence.settingsItemTitle = 'Packaged settings queued ' + randomUUID();
    evidence.settingsWriterOS = process.platform;
  } else if (phase === 'peer-ready') {
    assert.notEqual(deviceId, evidence.writerDevice); assert.equal(evidence['settings-baselinePassed'], true);
    assert.equal((await replica()).pending.length, 0);
    assert.deepEqual(state(await acceptUndraftedServer()), evidence.settingsBaseline);
    evidence.settingsPeerDevice = deviceId;
  } else if (phase === 'queue') {
    assert.equal(deviceId, evidence.writerDevice); assert.equal(evidence['settings-peer-readyPassed'], true);
    const current = await json(['vault','settings']); assert.equal(current.pending, false); assert.equal(current.conflict, false);
    assert.deepEqual(state(current), evidence.settingsBaseline);
    await setView(evidence.localView);
    assert.equal((await json(['vault','settings'])).pending, true);
    const changed = JSON.parse(await command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'],
      JSON.stringify({...evidence.itemBaseline,title:evidence.settingsItemTitle,password:'fictitious-lifecycle-password'}) + '\n'));
    assert.equal(changed.queued, true); assert.equal((await replica()).pending.length, 1);
    evidence.settingsQueuedHash = digest(await readFile(settingsFile)); evidence.itemQueuedHash = await pendingHash();
  } else if (phase === 'offline-reopen') {
    assert.equal(deviceId, evidence.writerDevice); assert.equal(evidence['settings-queuePassed'], true);
    assert.equal(digest(await readFile(settingsFile)), evidence.settingsQueuedHash);
    assert.equal(await pendingHash(), evidence.itemQueuedHash);
    const current = await json(['vault','settings']); assert.equal(current.pending, true); assert.deepEqual(current.defaultView, evidence.localView);
    const review = await json(['sync-review']); assert.equal(review.settingsPending, true); assert.equal(review.items.length, 1); assert.equal(review.items[0].title, evidence.settingsItemTitle);
  } else if (phase === 'peer-update') {
    assert.notEqual(deviceId, evidence.writerDevice); assert.equal(evidence['settings-offline-reopenPassed'], true);
    assert.deepEqual(state(await acceptUndraftedServer()), evidence.settingsBaseline);
    await setView(evidence.peerView);
    const current = await json(['vault','settings']); assert.equal(current.pending, false); assert.equal(current.conflict, false); assert.deepEqual(current.defaultView, evidence.peerView);
  } else if (phase === 'review') {
    assert.equal(deviceId, evidence.writerDevice); assert.equal(evidence['settings-peer-updatePassed'], true);
    await command(['vault','settings-sync']);
    const before = await readFile(settingsFile);
    assert.equal(digest(before), evidence.settingsQueuedHash); assert.equal(await pendingHash(), evidence.itemQueuedHash);
    const review = await json(['vault','settings-review']); assert.equal(review.localPending, true);
    assert.deepEqual(review.local.default_view, evidence.localView); assert.deepEqual(review.server.default_view, evidence.peerView);
    assert.equal(digest(await readFile(settingsFile)), digest(before)); assert.equal(await pendingHash(), evidence.itemQueuedHash);
  } else if (phase === 'resolve') {
    assert.equal(deviceId, evidence.writerDevice); assert.equal(evidence['settings-reviewPassed'], true);
    assert.equal(await pendingHash(), evidence.itemQueuedHash);
    const current = await json(['vault','settings-resolve','--keep',evidence.settingsChoice]);
    const expected = evidence.settingsChoice === 'local' ? evidence.localView : evidence.peerView;
    assert.equal(current.pending, false); assert.equal(current.conflict, false); assert.deepEqual(current.defaultView, expected);
    assert.deepEqual(state(current), {...evidence.settingsBaseline,defaultView:expected});
    assert.equal(await pendingHash(), evidence.itemQueuedHash, 'Settings resolution must not replay or discard item requests');
    evidence.settingsResolutionPreservedItemQueue = true;
    const synced = await json(['sync']); assert.equal(synced.pending, 0); assert.equal(synced.conflicts.length, 0);
    assert.equal(synced.vaultSettings.pending, false); assert.equal(synced.vaultSettings.conflict, false);
  } else if (phase === 'verify') {
    assert.notEqual(deviceId, evidence.writerDevice); assert.equal(evidence['settings-resolvePassed'], true);
    const expected = evidence.settingsChoice === 'local' ? evidence.localView : evidence.peerView;
    assert.deepEqual(state(await acceptUndraftedServer()), {...evidence.settingsBaseline,defaultView:expected});
    const item = await json(['item','get',evidence.itemId,'--vault',evidence.vaultId]); assert.equal(item.title, evidence.settingsItemTitle); assert.equal(item.password, '[redacted]');
    assert.equal(await command(['item','get',evidence.itemId,'--vault',evidence.vaultId,'--password','password']), 'fictitious-lifecycle-password');
  } else if (phase === 'restore') {
    assert.equal(deviceId, evidence.writerDevice); assert.equal(evidence['settings-verifyPassed'], true);
    await acceptUndraftedServer(); await setView(evidence.settingsBaseline.defaultView);
    await command(['item','edit',evidence.itemId,'--vault',evidence.vaultId,'--json','-'], JSON.stringify({...evidence.itemBaseline,password:'fictitious-lifecycle-password'}) + '\n');
    const synced = await json(['sync']); assert.equal(synced.pending, 0); assert.equal(synced.conflicts.length, 0);
    assert.deepEqual(state(await json(['vault','settings'])), evidence.settingsBaseline);
  } else {
    assert.notEqual(deviceId, evidence.writerDevice); assert.equal(evidence['settings-restorePassed'], true);
    assert.deepEqual(state(await acceptUndraftedServer()), evidence.settingsBaseline);
    const item = await json(['item','get',evidence.itemId,'--vault',evidence.vaultId]);
    for (const [field,value] of Object.entries(evidence.itemBaseline)) assert.equal(item[field], value);
    assert.equal((await replica()).pending.length, 0); evidence.settingsFixtureRestored = true;
  }
  evidence['settings-' + phase + 'Passed'] = true; evidence.settingsLastRunAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(evidence,null,2) + '\n');
  console.log(`Packaged settings ${phase} passed on ${process.platform}; choice ${evidence.settingsChoice}.`);
} finally { if (agentReady) await command(['lock']).catch(() => {}); if (agent.exitCode === null) agent.kill(); }
