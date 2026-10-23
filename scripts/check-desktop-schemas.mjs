// Probe a committed snapshot without generated schemas; never remove local state.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execute, pnpm } from './release/process.mjs';
import { outside, git } from './release/plan.mjs';

const repository = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output') throw Error('Use node scripts/check-desktop-schemas.mjs --output <new directory outside checkout>.');
const output = outside(repository, args[1], 'Schema probe output');
await mkdir(output); // Exclusive: never overwrite an existing probe.
const source = join(output, 'source'), archive = join(output, 'source.tar');
await mkdir(source);
const revision = await git(repository, ['rev-parse', 'HEAD']);
await git(repository, ['archive', '--format=tar', `--output=${archive}`, revision]);
await execute('tar', ['-xf', archive, '-C', source, '--exclude', 'apps/desktop/src-tauri/gen']);
const generated = join(source, 'apps/desktop/src-tauri/gen/schemas');
await access(generated).then(() => { throw Error('Probe extraction unexpectedly retained schemas.'); }, error => { if (error.code !== 'ENOENT') throw error; });
await pnpm(['install', '--frozen-lockfile'], { cwd: source });
await pnpm(['--filter', '@127vaults/desktop', 'check'], { cwd: source });
const schema = process.platform === 'win32' ? 'windows-schema.json' : process.platform === 'linux' ? 'linux-schema.json' : 'macOS-schema.json';
const files = {};
for (const name of ['acl-manifests.json', 'capabilities.json', 'desktop-schema.json', schema]) {
  const value = JSON.parse(await readFile(join(generated, name), 'utf8'));
  files[name] = Object.keys(value).length;
}
await writeFile(join(output, 'schema-receipt.json'), JSON.stringify({ status: 'passed', revision, platform: process.platform, generatedFromAbsentDirectory: true, files }, null, 2) + '\n');
console.log(`Clean schema regeneration passed: ${output}`);
