import { copyFile, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, protectedDirectory } from './config.mjs';

// Legacy keys are copied only after the operator explicitly identifies their mode.
// Never infer mode from a key's contents, overwrite files, or print credentials.
export async function prepareDodoSecrets(file, legacyMode) {
  if (legacyMode !== undefined && !['test_mode', 'live_mode'].includes(legacyMode)) throw Error('Choose test_mode or live_mode for legacy keys');
  const config = await loadConfig(file);
  for (const mode of ['test_mode', 'live_mode']) {
    await protectedDirectory(join(config.secretsDirectory, 'dodo', mode));
  }
  let copied = 0;
  if (legacyMode) {
    for (const name of ['dodo-api-key', 'dodo-webhook-secret']) {
      const source = join(config.secretsDirectory, name);
      const info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink()) throw Error('Legacy Dodo secret must be a regular file');
      try {
        await copyFile(source, join(config.secretsDirectory, 'dodo', legacyMode, name), constants.COPYFILE_EXCL);
        copied++;
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
  }
  return { prepared: ['test_mode', 'live_mode'], legacyMode: legacyMode ?? null, copied, deployed: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [file, legacyMode, ...extra] = process.argv.slice(2);
  if (!file || extra.length) throw Error('Usage: node scripts/cloudflare/prepare-dodo-secrets.mjs CONFIG [test_mode|live_mode]');
  console.log(JSON.stringify(await prepareDodoSecrets(file, legacyMode)));
}
