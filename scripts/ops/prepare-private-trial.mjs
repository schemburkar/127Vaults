// Prepare explicit private-test delivery, never publish or send email.
import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileHash, verifyRelease } from '../release/verify-release.mjs';
import { outside } from '../release/plan.mjs';
const repository = resolve(import.meta.dirname, '../..');
const run = promisify(execFile);

export async function prepareTrialCatalogue(config) {
  if (!Array.isArray(config.releaseDirectories) || !/^[a-f0-9]{40,64}$/.test(config.requiredFeatureRevision)
    || !/^[A-Za-z0-9_-]{1,40}$/.test(config.issuerKeyId ?? '')) throw Error('Supply releaseDirectories, issuerKeyId and requiredFeatureRevision.');
  const artifacts = [], products = new Set();
  let server;
  for (const directory of config.releaseDirectories) {
    const manifest = await verifyRelease(directory);
    await run('git', ['-C', repository, 'merge-base', '--is-ancestor', config.requiredFeatureRevision, manifest.sourceRevision], { windowsHide: true });
    products.add(manifest.product);
    if (manifest.product === 'server') {
      if (server || !manifest.issuerPublicKeys?.[config.issuerKeyId]) throw Error('One server release with pinned trial issuer keys is required.');
      server = manifest;
    }
    const files = [...manifest.files, ...await Promise.all(['release.json', 'SHA256SUMS'].map(async name => ({
      name, sizeBytes: Buffer.byteLength(await readFile(join(directory, name))), sha256: await fileHash(join(directory, name)),
    })))];
    for (const [index, file] of files.entries()) {
      const isServer = manifest.product === 'server' && /\.tar(?:\.gz)?$/.test(file.name);
      if (isServer && artifacts.some(row => row.id === 'server')) throw Error('Ambiguous server archive.');
      artifacts.push({ id: isServer ? 'server' : `${manifest.product}-${manifest.platform}-${index}`,
        filename: file.name, path: resolve(directory, file.name), sha256: file.sha256, sizeBytes: file.sizeBytes,
        label: `${manifest.product} / ${manifest.platform} / ${file.name}`, sourceRevision: manifest.sourceRevision,
        product: manifest.product, platform: manifest.platform, supporting: /\.(?:md|mjs|json)$/.test(file.name) || file.name === 'SHA256SUMS' });
    }
  }
  if (['server', 'desktop', 'cli', 'extension'].some(product => !products.has(product))) throw Error('Select server, Desktop, CLI and extension releases. Web and admin ship with server.');
  return { schemaVersion: 1, sourceRevision: server.sourceRevision, issuerPublicKeys: server.issuerPublicKeys,
    requiredFeatureRevision: config.requiredFeatureRevision, artifacts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, input, output] = process.argv.slice(2);
    if (command === 'init' && input && !output) {
      const directory = outside(repository, input, 'Trial secrets directory');
      await mkdir(directory, { recursive: false, mode: 0o700 });
      if (process.platform === 'win32') {
        const { stdout } = await run('whoami.exe', [], { windowsHide: true });
        const identity = stdout.trim();
        if (!identity || /[\r\n]/.test(identity)) throw Error('Cannot identify the trial operator.');
        // Node's Unix mode bits do not restrict inherited Windows directory ACLs.
        await run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)F`,
          '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'], { windowsHide: true });
      }
      const { privateKey } = generateKeyPairSync('ed25519');
      const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
      const keys = { trial: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) };
      for (const [name, value] of Object.entries({ 'issuer.pem': pem, 'issuer-keys.json': JSON.stringify(keys, null, 2) + '\n',
        'operator-token': randomBytes(32).toString('base64url') + '\n', 'intake-key': randomBytes(32).toString('hex') + '\n' })) {
        await writeFile(join(directory, name), value, { flag: 'wx', mode: 0o600 });
      }
      console.log(`Trial keys created outside the checkout: ${directory}. Preserve and back up these keys; never place them in the static site.`);
    } else if (command === 'catalogue' && input && output) {
      const catalogue = await prepareTrialCatalogue(JSON.parse(await readFile(resolve(input), 'utf8')));
      const target = outside(repository, output, 'Trial catalogue');
      await writeFile(target, JSON.stringify(catalogue, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      console.log(`Prepared ${catalogue.artifacts.length} private downloads in ${basename(target)}. Nothing published.`);
    } else throw Error('Use: prepare-private-trial.mjs init <new-external-directory> | catalogue <config.json> <new-external-catalogue.json>');
  } catch (error) { console.error(`Trial preparation: ${error.message}`); process.exitCode = 1; }
}
