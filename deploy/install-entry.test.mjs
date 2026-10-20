import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

test('recipient installer runs through a junction or symlink instead of silently exiting', async t => {
  const root = await mkdtemp(join(tmpdir(),'127v-installer-entry-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const actual = join(root,'actual'), alias = join(root,'alias');
  await mkdir(actual);
  await copyFile(new URL('./install.mjs',import.meta.url),join(actual,'install.mjs'));
  await symlink(actual,alias,process.platform === 'win32' ? 'junction' : 'dir');
  const result = await run(process.execPath,[join(alias,'install.mjs'),'--help'],{windowsHide:true});
  assert.match(result.stdout,/Commands: verify, doctor, setup, start, status, bootstrap, stop, upgrade/);
});
