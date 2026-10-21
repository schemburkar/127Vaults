import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {recoverBuildLock} from './recover-build-lock.mjs';
test('lock recovery refuses a running or mismatched owner and clears a confirmed exited build',async()=>{
  const root=await mkdtemp(join(tmpdir(),'127vaults-lock-'));
  const path=join(root,'.build-lock');
  try{
    await writeFile(path,JSON.stringify({pid:process.pid,host:process.platform}));
    await assert.rejects(recoverBuildLock(root,process.pid),/still running/);
    await assert.rejects(recoverBuildLock(root,process.pid+1),/differs/);
    const child=spawnSync(process.execPath,['-e','']);
    await writeFile(path,JSON.stringify({pid:child.pid,host:process.platform}));
    await recoverBuildLock(root,child.pid);await assert.rejects(stat(path),{code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
});
