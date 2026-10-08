// Collect verified native build outputs into one directory for a private handoff.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, outputDirectory, sha256, writeManifest } from './package.mjs';
import { verifyPackages } from './verify.mjs';

export async function assemble(output, inputs, zip = false) {
  if (!inputs.length) throw Error('Supply at least one --from <package directory>.');
  const sources = await Promise.all(inputs.map(async directory => ({ directory, manifest: await verifyPackages(directory) })));
  const revisions = new Set(sources.map(source => source.manifest.revision));
  if (revisions.size !== 1) throw Error('All packages must come from the same source revision.');
  const seen = new Map();
  for (const { directory, manifest } of sources) {
    for (const file of manifest.files) {
      if (['README.md', 'LICENSE-POLICY.md', 'verify.mjs'].includes(file.name)) continue;
      if (seen.has(file.name) && seen.get(file.name).file.sha256 !== file.sha256) throw Error(`Conflicting artifact: ${file.name}`);
      seen.set(file.name, { directory, file });
    }
  }
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  for (const { directory, file } of seen.values()) await copyFile(join(directory, file.name), join(output, file.name));
  const root = resolve(import.meta.dirname, '../..');
  for (const [source, target] of [['docs/release/local-packaging.md', 'README.md'], ['docs/release/client-install.md', 'CLIENT-INSTALL.md'],
    ['docs/release/extension-install.md', 'EXTENSION-INSTALL.md'], ['LICENSE-POLICY.md', 'LICENSE-POLICY.md'],
    ['scripts/release/verify.mjs', 'verify.mjs']]) await copyFile(join(root, source), join(output, target));
  await writeFile(join(output, 'builds.json'), JSON.stringify(sources.map(({ manifest }) => manifest), null, 2) + '\n');
  const components = [...new Set(sources.flatMap(source => source.manifest.components.map(component =>
    component === 'desktop' ? `desktop-${source.manifest.platform}` : component)))];
  await writeManifest(output, components);
  // Preserve the actual build provenance rather than the assembler's current Git HEAD.
  const path = join(output, 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.revision = [...revisions][0];
  manifest.sourceDirty = sources.some(source => source.manifest.sourceDirty);
  manifest.platform = [...new Set(sources.map(source => source.manifest.platform))].join(',');
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Complete private handoff: ${output}`);
  if (zip) {
    await archive(output, `${output}.zip`, true);
    await writeFile(`${output}.zip.sha256`, `${await sha256(`${output}.zip`)}  ${output.split(/[\\/]/).at(-1)}.zip\n`, { flag: 'wx' });
    console.log(`All-in-one archive: ${output}.zip`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const inputs = args.flatMap((value, index) => value === '--from' && args[index + 1] ? [resolve(args[index + 1])] : []);
  assemble(outputDirectory(args.includes('--out') ? args[args.indexOf('--out') + 1] : null), inputs, args.includes('--zip'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
