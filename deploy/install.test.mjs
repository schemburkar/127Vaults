import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verify } from './install.mjs';

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
