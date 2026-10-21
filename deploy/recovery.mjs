import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, lstat, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export async function ensureRecovery(directory, { home = homedir(), log = console.log } = {}) {
  const config = await readFile(join(directory,'.env'),'utf8');
  const project = /^VAULTS_PROJECT=(vaults-test-[a-f0-9]{12})\r?$/m.exec(config)?.[1];
  if (!project) throw Error('Recovery settings require the initialized server project.');
  const base = join(home,'.127vaults'), metadataDir = join(base,'installations',project);
  const metadata = join(metadataDir,'recovery.json');
  let record;
  try { record = JSON.parse(await readFile(metadata,'utf8')); }
  catch(error) {if(error.code !== 'ENOENT') throw error;}
  const saved = Boolean(record);
  record ??= {format:1,project,key_file:join(base,'keys',`${project}.key`),backup_root:join(base,'backups',project)};
  if (record.format !== 1 || record.project !== project || !isAbsolute(record.key_file) || !isAbsolute(record.backup_root)) throw Error('Invalid saved recovery settings.');
  const protect = async path => {
    await mkdir(path,{recursive:true,mode:0o700});
    if ((await lstat(path)).isSymbolicLink()) throw Error('Recovery directory cannot be a symbolic link.');
    if (process.platform === 'win32') {
      const {windowsOperatorSid} = await import(existsSync(new URL('../scripts/tls.mjs',import.meta.url)) ? '../scripts/tls.mjs' : './tls.mjs');
      await run('icacls.exe',[path,'/inheritance:r','/grant:r',`${windowsOperatorSid()}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F'],{windowsHide:true});
    } else await chmod(path,0o700);
  };
  if (!existsSync(record.key_file)) {
    if (saved) throw Error(`Saved backup key is missing: ${record.key_file}. Restore the matching safe copy; it was not replaced.`);
    await protect(join(base,'keys'));
    await writeFile(record.key_file,randomBytes(32),{flag:'wx',mode:0o600});
  }
  const info = await lstat(record.key_file);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== 32 || (process.platform !== 'win32' && (info.mode & 0o077))) throw Error('Backup key must be a protected regular 32-byte file.');
  await protect(metadataDir); await protect(record.backup_root);
  const temporary = join(metadataDir,`recovery-${randomUUID()}.tmp`);
  await writeFile(temporary,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(temporary,metadata);
  log(`Backup key: ${record.key_file}\nEncrypted backups: ${record.backup_root}\nSaved settings: ${metadata}\nKeep a safe copy of the key separate from backups. It is required to restore them. Never upload or share it.`);
  return record;
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index=process.argv.indexOf('--directory');
  if(index<0 || !process.argv[index+1]) throw Error('Use --directory <initialized server bundle>.');
  await ensureRecovery(resolve(process.argv[index+1]));
}
