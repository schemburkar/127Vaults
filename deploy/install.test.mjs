import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diagnose, inspectInstallation, main, parseOptions, prerequisites, probe, renderDiagnosis, verify } from './install.mjs';

test('installer rejects incomplete manifests, altered helpers and unsafe paths before engine actions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vaults-installer-'));
  const files = {};
  const names = ['server-image.tar', 'postgres-image.tar', 'openssl-image.tar', 'server.mjs', 'lib/test-install.mjs', 'compose.test.yaml', 'install.mjs', 'install.ps1', 'install.sh'];
  try {
    await mkdir(join(directory, 'lib'));
    for (const name of names) {
      await writeFile(join(directory, name), name);
      files[name] = createHash('sha256').update(name).digest('hex');
    }
    const manifest = () => writeFile(join(directory, 'manifest.json'), JSON.stringify({ format: 1, files }));
    await manifest();
    await verify(directory);
    delete files['server.mjs'];
    await manifest();
    await assert.rejects(verify(directory), /Missing required/);
    files['server.mjs'] = createHash('sha256').update('server.mjs').digest('hex');
    files['../escape'] = 'a'.repeat(64);
    await manifest();
    await assert.rejects(verify(directory), /Invalid bundle manifest entry/);
    delete files['../escape'];
    await manifest();
    await writeFile(join(directory, 'lib/test-install.mjs'), 'tampered');
    await assert.rejects(verify(directory), /checksum mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const healthy = { ok: true, output: '' };
function harness(overrides = {}) {
  const calls = [];
  return {
    calls,
    directory: tmpdir(),
    platform: 'linux',
    nodeVersion: '24.20.0',
    verifyBundle: async () => {},
    inspectState: null,
    runProbe: async (program, args) => { calls.push([program, args]); return healthy; },
    ...overrides
  };
}

test('options reject typos, duplicate flags, missing values and invalid network endpoints', () => {
  for (const args of [
    ['--dokcer'], ['--docker', '--docker'], ['--endpoint'], ['--endpoint', '--docker'],
    ['--private-dir', 'bad\npath'], ['--compose-provider', ''],
    ['--docker', '--compose-provider', 'podman-compose'],
    ...['192.168.999.1', '10.256.0.1', '172.32.0.1', '8.8.8.8', '10.01.0.1', '127.0.0.2', '::1', 'example.com', 'https://10.0.0.1'].map(value => ['--endpoint', value])
  ]) assert.throws(() => parseOptions(args), undefined, JSON.stringify(args));
  for (const endpoint of ['localhost', '127.0.0.1', '10.0.0.1', '192.168.1.20', '172.16.0.1', '172.31.255.254']) {
    assert.equal(parseOptions(['--endpoint', endpoint]).engine, 'podman');
  }
});

test('options keep identity outside the bundle and preserve argument boundaries', () => {
  const directory = join(tmpdir(), 'bundle');
  for (const value of ['.', './child', './child/../child']) {
    assert.throws(() => parseOptions(['--private-dir', value], { directory }), /outside the bundle/);
  }
  const args = ['--private-dir', '../private identity', '--compose-provider', 'provider with spaces.exe'];
  assert.deepEqual(parseOptions(args, { directory }).args, args);
});

test('doctor reports all independent failures without exposing command output', async () => {
  const secret = 'PRIVATE_TOKEN=do-not-print';
  const dependencies = harness({
    nodeVersion: '22.1.0',
    verifyBundle: async () => { throw Error(secret); },
    runProbe: async () => ({ ok: false, reason: 'missing', output: secret })
  });
  const report = await diagnose(['--compose-provider', 'missing-provider'], dependencies);
  assert.equal(report.ready, false);
  assert.deepEqual(report.checks.map(check => [check.id, check.status]), [
    ['bundle', 'fail'], ['node', 'fail'], ['engine', 'fail'], ['connection', 'skip'], ['compose', 'fail']
  ]);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(renderDiagnosis(report).includes(secret), false);
  assert.ok(report.checks.filter(check => check.status === 'fail').every(check => check.nextStep));
});

test('doctor distinguishes installed engine from unreachable connection and checks Compose', async () => {
  const dependencies = harness();
  dependencies.runProbe = async (program, args) => {
    dependencies.calls.push([program, args]);
    return args[0] === 'info' ? { ok: false, reason: 'timeout', output: 'sensitive engine config' } : healthy;
  };
  const report = await diagnose(['--docker'], dependencies);
  assert.deepEqual(dependencies.calls, [['docker', ['--version']], ['docker', ['info']], ['docker', ['compose', 'version']], ['docker', ['compose', 'ls', '--format', 'json']]]);
  assert.equal(report.checks.find(check => check.id === 'engine').status, 'pass');
  assert.match(report.checks.find(check => check.id === 'connection').message, /timeout/);
  assert.equal(report.checks.find(check => check.id === 'compose').status, 'pass');
  assert.equal(report.ready, false);
});

test('Windows Podman uses configured native Compose without requiring Python discovery', async () => {
  const dependencies = harness({ platform: 'win32' });
  const args = ['--endpoint', '127.0.0.1'];
  const report = await diagnose(args, dependencies);
  assert.equal(report.ready, true);
  assert.deepEqual(args, ['--endpoint', '127.0.0.1']);
  assert.deepEqual(report.args, args);
  assert.deepEqual(dependencies.calls.at(-1), ['podman', ['compose', 'ls', '--format', 'json']]);
  assert.equal(dependencies.calls.some(([program]) => program === 'where.exe'), false);
});

test('Windows Podman missing provider gives guidance rather than invoking a Docker shim', async () => {
  const dependencies = harness({ platform: 'win32' });
  dependencies.runProbe = async (program, args) => {
    dependencies.calls.push([program, args]);
    return args[0] === 'compose' ? { ok: false, reason: 'exit' } : healthy;
  };
  const report = await diagnose([], dependencies);
  assert.equal(report.ready, false);
  assert.match(report.checks.find(check => check.id === 'compose').nextStep, /full executable path/);
  assert.match(report.checks.find(check => check.id === 'compose').nextStep, /Python is not required/);
  assert.equal(dependencies.calls.some(([program]) => program === 'docker' || program === 'where.exe'), false);
});

test('explicit provider bypasses Windows discovery and healthy prerequisites return resolved options', async () => {
  const dependencies = harness({ platform: 'win32' });
  const args = ['--compose-provider', 'provider.exe'];
  let provider;
  dependencies.runProbe = async (program, argv, options) => {
    dependencies.calls.push([program, argv]);
    if (argv[0] === 'compose') provider = options.env.PODMAN_COMPOSE_PROVIDER;
    return healthy;
  };
  assert.deepEqual(await prerequisites(args, dependencies), args);
  assert.equal(dependencies.calls.some(([program]) => program === 'where.exe'), false);
  assert.deepEqual(dependencies.calls.at(-1), ['podman', ['compose', 'ls', '--format', 'json']]);
  assert.equal(provider, 'provider.exe');
});

test('doctor rejects a Compose binary that reports a version but cannot reach its engine', async () => {
  const dependencies = harness({
    runProbe: async (_program, args) => args.includes('ls')
      ? { ok: false, reason: 'exit', output: 'private socket path and project names' } : healthy
  });
  const report = await diagnose([], dependencies);
  assert.equal(report.ready, false);
  assert.equal(report.checks.find(check => check.id === 'compose').status, 'fail');
  assert.equal(JSON.stringify(report).includes('private socket path'), false);
});

test('prerequisite subprocess receives an explicitly selected native provider with spaces', async () => {
  const provider = join(tmpdir(), 'Native Compose', 'docker-compose.exe');
  const result = await probe(process.execPath, ['-e', 'process.stdout.write(process.env.PODMAN_COMPOSE_PROVIDER)'], {
    env: { ...process.env, PODMAN_COMPOSE_PROVIDER: provider }
  });
  assert.equal(result.ok, true);
  assert.equal(result.output, provider);
});

test('invalid arguments and verify-only never contact the engine', async () => {
  const dependencies = harness({ log: () => {} });
  await assert.rejects(main(['setup', '--endpoint', '10.999.1.1'], dependencies), /private IPv4/);
  await assert.rejects(main(['setup', '--json'], dependencies), /only for doctor/);
  assert.equal(await main(['verify'], dependencies), 0);
  assert.equal(dependencies.calls.length, 0);
});

test('doctor JSON is a single redacted report, exits unsuccessfully and performs no operator actions', async () => {
  const output = [];
  const dependencies = harness({
    log: value => output.push(value),
    nodeVersion: '23.0.0',
    runOperator: () => { throw Error('doctor must never call operator'); }
  });
  assert.equal(await main(['doctor', '--json', '--compose-provider', 'private-provider-path'], dependencies), 1);
  assert.equal(output.length, 1);
  const report = JSON.parse(output[0]);
  assert.equal(report.ready, false);
  assert.equal(report.format, 1);
  assert.equal(Object.hasOwn(report, 'args'), false);
  assert.equal(output[0].includes('private-provider-path'), false);
});

test('setup cannot initialize or start when bundle or prerequisite checks fail', async () => {
  for (const overrides of [
    { verifyBundle: async () => { throw Error('corrupt'); } },
    { nodeVersion: '22.0.0' },
    { runProbe: async () => ({ ok: false, reason: 'missing' }) }
  ]) {
    const dependencies = harness({ ...overrides, log: () => {}, runOperator: () => { assert.fail('operator must not run'); } });
    await assert.rejects(main(['setup'], dependencies), /Prerequisites are not ready/);
  }
});

test('setup preserves existing identity and awaits each operator step', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vaults-setup-'));
  const calls = [];
  const dependencies = harness({ directory, log: () => {}, runOperator: async (_program, args, cwd) => {
    assert.equal(cwd, directory);
    calls.push(args[2]);
    if (args[2] === 'init') await writeFile(join(directory, '.env'), 'existing identity');
    else assert.equal(await readFile(join(directory, '.env'), 'utf8'), 'existing identity');
  } });
  try {
    assert.equal(await main(['setup'], dependencies), 0);
    assert.deepEqual(calls, ['init', 'start', 'status']);
    calls.length = 0;
    assert.equal(await main(['setup'], dependencies), 0);
    assert.deepEqual(calls, ['start', 'status']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('failed initialization or start stops the setup sequence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vaults-failed-setup-'));
  try {
    for (const failure of ['init', 'start']) {
      const calls = [];
      const dependencies = harness({ directory, log: () => {}, runOperator: async (_program, args) => {
        calls.push(args[2]);
        if (args[2] === failure) throw Error('simulated operator failure');
      } });
      await assert.rejects(main(['setup'], dependencies), /simulated operator failure/);
      assert.deepEqual(calls, failure === 'init' ? ['init'] : ['init', 'start']);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real probes distinguish missing executables, nonzero exit and bounded hangs', async () => {
  assert.equal((await probe('127vaults-no-such-executable-for-test', [])).reason, 'missing');
  assert.equal((await probe(process.execPath, ['-e', 'process.exit(7)'])).reason, 'exit');
  const success = await probe(process.execPath, ['-e', 'process.stdout.write("ready"); process.stderr.write("private")']);
  assert.equal(success.ok, true);
  assert.equal(success.output, 'ready');
  const before = Date.now();
  const hung = await probe(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 250 });
  assert.equal(hung.reason, 'timeout');
  assert.ok(Date.now() - before < 5000);
});

test('standalone extracted installer emits valid JSON and a failure exit code without a bundle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vaults-standalone-doctor-'));
  try {
    await copyFile(new URL('./install.mjs', import.meta.url), join(directory, 'install.mjs'));
    const result = await probe(process.execPath, [join(directory, 'install.mjs'), 'doctor', '--json', '--compose-provider', '127vaults-missing-provider'], {
      cwd: directory, timeoutMs: 60000
    });
    assert.equal(result.reason, 'exit');
    const report = JSON.parse(result.output);
    assert.equal(report.ready, false);
    assert.equal(report.checks.find(check => check.id === 'bundle').status, 'fail');
    assert.equal(report.checks.find(check => check.id === 'compose').status, 'fail');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('installation inspection preserves configuration, detects incomplete identity and rejects source changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vaults-identity-check-'));
  const bundle = join(directory, 'bundle');
  const identity = join(directory, 'private identity');
  try {
    await mkdir(bundle);
    assert.equal((await inspectInstallation(bundle, {})).status, 'pass');
    const configuration = `VAULTS_PROJECT=vaults-test-abcdef123456\r\nVAULTS_TLS_DIR=${identity.replaceAll('\\', '/')}\r\nVAULTS_ENDPOINT_HOST=127.0.0.1\r\nSECRET=never-show-this\r\n`;
    await writeFile(join(bundle, '.env'), configuration);
    const incomplete = await inspectInstallation(bundle, {});
    assert.equal(incomplete.status, 'fail');
    assert.match(incomplete.nextStep, /matching identity/);
    assert.equal(JSON.stringify(incomplete).includes('never-show-this'), false);
    for (const name of ['ca/ca.crt', 'ca/ca.key', 'live/server.crt', 'live/server.key', 'runtime/token.key', 'runtime/checkpoint.key', 'runtime/postgres-password', 'runtime/readiness-token']) {
      await mkdir(join(identity, name.split('/')[0]), { recursive: true });
      await writeFile(join(identity, name), 'fixture-only');
    }
    assert.equal((await inspectInstallation(bundle, {})).status, 'pass');
    assert.match((await inspectInstallation(bundle, { endpoint: '10.0.0.1' })).message, /endpoint differs/);
    assert.match((await inspectInstallation(bundle, { privateDir: join(directory, 'other') })).message, /directory differs/);
    assert.equal((await inspectInstallation(bundle, { privateDir: identity })).status, 'pass');
    const parsed = parseOptions([], { directory: bundle });
    assert.equal((await inspectInstallation(bundle, parsed)).status, 'pass');
    assert.deepEqual(parsed.args, ['--private-dir', identity.replaceAll('\\', '/')]);
    assert.equal(await readFile(join(bundle, '.env'), 'utf8'), configuration);
    await writeFile(join(identity, 'runtime/token.key'), '');
    assert.equal((await inspectInstallation(bundle, {})).status, 'fail');
    await writeFile(join(bundle, '.env'), configuration + 'VAULTS_ENDPOINT_HOST=10.0.0.1\n');
    assert.equal((await inspectInstallation(bundle, {})).status, 'fail');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('damaged identity blocks start but does not block stop or status', async () => {
  const calls = [];
  const dependencies = harness({
    inspectState: async () => ({ id: 'installation', status: 'fail', message: 'Identity is missing.' }),
    log: () => {},
    runOperator: async (_program, args) => calls.push(args[2])
  });
  await assert.rejects(main(['start'], dependencies), /Identity is missing/);
  assert.equal(await main(['stop'], dependencies), 0);
  assert.equal(await main(['status'], dependencies), 0);
  assert.deepEqual(calls, ['stop', 'status']);
});
