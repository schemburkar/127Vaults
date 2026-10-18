import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { archiveServerBundle } from './make-server-bundle.mjs';

test('compressed offline bundle extracts through ordinary installer tar flow without changing bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), '127vaults-compressed-'));
  const run = promisify(execFile);
  try {
    const directory = join(root, '127vaults-server-0.0.4-linux-amd64');
    const extract = join(root, 'extracted');
    await mkdir(directory); await mkdir(extract);
    const bytes = Buffer.alloc(256 * 1024, 0x5a);
    await writeFile(join(directory, 'server-image.tar'), bytes);
    const archive = await archiveServerBundle(directory, (program, args) => run(program, args, { windowsHide: true }));
    assert.deepEqual((await readFile(archive)).subarray(0, 2), Buffer.from([0x1f, 0x8b]));
    assert.ok((await stat(archive)).size < bytes.length / 10);
    await run('tar', ['-xf', archive, '-C', extract], { windowsHide: true });
    assert.deepEqual(await readFile(join(extract, '127vaults-server-0.0.4-linux-amd64/server-image.tar')), bytes);
    await assert.rejects(archiveServerBundle(directory, () => { throw Error('Must not overwrite'); }), /already exists/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
