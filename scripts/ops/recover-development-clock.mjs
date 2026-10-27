import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyLicenseFile, licenseStatus } from '../../apps/server/src/license-status.mjs';

export function recoveryRecord(previous, now, reference, serverNow, status) {
  if (status.plan !== 'development' || status.mode !== 'active') throw Error('Recovery requires an active signed development license.');
  if (![now, reference, serverNow].every(Number.isSafeInteger) || Math.abs(now - reference) > 120_000 || Math.abs(now - serverNow) > 120_000) throw Error('Verify Windows, server and independent reference time before recovery.');
  if (previous.version !== 1 || !Number.isSafeInteger(previous.lastObservedMs) || previous.lastObservedMs <= now + 120_000 || previous.lastObservedMs > now + 86_400_000) throw Error('Recovery requires a confirmed clock rollback of less than one day.');
  return { version: 1, lastObservedMs: now };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 8) throw Error('Usage: node scripts/ops/recover-development-clock.mjs --container NAME --identity PATH --receipt NEW_DIRECTORY --reference-time VERIFIED_UTC');
  const options = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
  const container = options['--container'], identity = resolve(options['--identity']), receipt = resolve(options['--receipt']);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(container)) throw Error('Invalid container name.');
  const podman = process.platform === 'win32' ? join(process.env.ProgramFiles || 'C:/Program Files', 'RedHat/Podman/podman.exe') : 'podman';
  function run(args) {
    const result = spawnSync(podman, args, { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw Error(`Podman ${args[0]} failed.`);
    return result.stdout.trim();
  }
  const inspect = JSON.parse(run(['inspect', container]))[0];
  const env = Object.fromEntries(inspect.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
  const normalize = path => resolve(process.platform === 'win32' ? path.replace(/^\/mnt\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:/`) : path).toLowerCase();
  for (const [target, directory] of [['/run/runtime', 'output'], ['/run/secrets/runtime', 'runtime']]) {
    const mount = inspect.Mounts.find(m => m.Destination === target);
    if (!mount || normalize(mount.Source) !== normalize(join(identity, directory))) throw Error('Selected identity does not match the running container mounts.');
  }
  if (!inspect.State.Running || env.VAULTS_LICENSE_CLOCK_FILE !== '/run/runtime/license-clock.json' || env.VAULTS_LICENSE_REVOCATION_FILE) throw Error('Unsupported server state or license configuration.');
  const localLicensePath = name => {
    const match = /^\/run\/secrets\/runtime\/licenses\/([1-9][0-9]*\.(?:keys\.)?json)$/.exec(env[name] || '');
    if (!match) throw Error('Unsupported license path.');
    return join(identity, 'runtime/licenses', match[1]);
  };
  const installation = (await readFile(join(identity, 'installation-id'), 'utf8')).trim();
  const license = verifyLicenseFile(await readFile(localLicensePath('VAULTS_LICENSE_FILE'), 'utf8'), JSON.parse(await readFile(localLicensePath('VAULTS_LICENSE_PUBLIC_KEYS_FILE'), 'utf8')), installation);
  const clockPath = join(identity, 'output/license-clock.json');
  const serverNow = Number(run(['exec', container, 'node', '-e', 'console.log(Date.now())']));
  const reference = Date.parse(options['--reference-time']);
  recoveryRecord(JSON.parse(await readFile(clockPath, 'utf8')), Date.now(), reference, serverNow, licenseStatus(license));
  await mkdir(receipt, { recursive: false });
  run(['stop', '--time', '20', container]);
  try {
    const original = await readFile(clockPath, 'utf8');
    const next = recoveryRecord(JSON.parse(original), Date.now(), reference, serverNow, licenseStatus(license));
    await writeFile(join(receipt, 'previous-license-clock.json'), original, { flag: 'wx', mode: 0o600 });
    await writeFile(`${clockPath}.recovery`, JSON.stringify(next) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(`${clockPath}.recovery`, clockPath);
    await writeFile(join(receipt, 'recovery.json'), JSON.stringify({ container, identity, referenceTime: new Date(reference).toISOString(), recoveredAt: new Date(next.lastObservedMs).toISOString(), license: licenseStatus(license), previousClock: JSON.parse(original), nextClock: next }, null, 2), { flag: 'wx', mode: 0o600 });
  } finally {
    run(['start', container]);
  }
  console.log(`Development clock recovered; server restarted. Backup and receipt: ${receipt}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
