import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureRecovery } from './recovery.mjs';
test('normal setup generates, records and reuses its key and refuses a lost saved key',async()=>{
  const home=await mkdtemp(join(tmpdir(),'127vaults-recovery-')),bundle=join(home,'bundle');
  try {
    await mkdir(bundle);await writeFile(join(bundle,'.env'),'VAULTS_PROJECT=vaults-test-123456abcdef\n');
    const notes=[];const record=await ensureRecovery(bundle,{home,log:v=>notes.push(v)});
    const key=await readFile(record.key_file);assert.equal(key.length,32);
    assert.ok(record.key_file.startsWith(join(home,'.127vaults','keys')));
    assert.ok(notes[0].includes(record.key_file));
    await ensureRecovery(bundle,{home,log:()=>{}});assert.deepEqual(await readFile(record.key_file),key);
    await rm(record.key_file);await assert.rejects(ensureRecovery(bundle,{home,log:()=>{}}),/not replaced/);
  } finally {await rm(home,{recursive:true,force:true});}
});
