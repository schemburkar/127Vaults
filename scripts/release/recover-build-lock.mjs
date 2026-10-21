// Explicit recovery for an interrupted local build. Never clear a live lock.
import { lstat, readFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function recoverBuildLock(cacheRoot, expectedPid) {
  if(!Number.isSafeInteger(expectedPid)||expectedPid<1)throw Error('Supply the inspected lock owner PID.');
  const path=join(resolve(cacheRoot),'.build-lock'),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())throw Error('Expected a regular build lock.');
  const source=await readFile(path,'utf8'),record=JSON.parse(source);
  if(record.pid!==expectedPid||record.host!==process.platform)throw Error('Lock identity differs from the inspected build.');
  try{process.kill(record.pid,0);throw Error('Build owner is still running; lock preserved.');}
  catch(error){if(error.code!=='ESRCH')throw error;}
  if(await readFile(path,'utf8')!==source)throw Error('Lock changed during recovery.');
  await unlink(path);console.log('Recovered the interrupted build lock; no packages or source were changed.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
  if(!args.includes('--cache-root')||!args.includes('--expected-pid'))throw Error('Use --cache-root PATH --expected-pid PID after inspecting the lock.');
  await recoverBuildLock(value('--cache-root'),Number(value('--expected-pid')));
}
