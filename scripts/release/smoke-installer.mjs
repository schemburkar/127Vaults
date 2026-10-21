// Verify consumer bytes and exercise read-only discovery, without trial credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyRelease } from './verify-release.mjs';
import { execute } from './process.mjs';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
for (const name of ['--release','--extract-to','--output']) {
  if (!args.includes(name) || !option(name) || option(name).startsWith('--')) throw Error(`Missing ${name}.`);
}
const directory = resolve(option('--release')), extracted = resolve(option('--extract-to'));
const inside = relative(directory,extracted);
if (!inside || (!isAbsolute(inside) && inside !== '..' && !inside.startsWith('..\\') && !inside.startsWith('../'))) throw Error('Keep extraction outside the verified release directory.');
const manifest = await verifyRelease(directory);
assert.equal(manifest.product,'installer');
assert.equal(manifest.platform,process.platform === 'win32' ? 'windows' : 'linux');
const archives = manifest.files.filter(file => /\.(zip|tar\.gz)$/.test(file.name));
assert.equal(archives.length,1);
const statePath = join(process.platform === 'win32' ? process.env.LOCALAPPDATA : process.env.XDG_DATA_HOME ?? join(homedir(),'.local/share'),'127Vaults/installer/installation.json');
const snapshot = async () => {
  try {return createHash('sha256').update(await readFile(statePath)).digest('hex');}
  catch(error) {if(error.code === 'ENOENT') return null;throw error;}
};
const before = await snapshot();
await mkdir(extracted); // New directory only; no overwrite or recursive cleanup.
await execute('tar',['-xf',join(directory,archives[0].name),'-C',extracted]);
const folders = await readdir(extracted,{withFileTypes:true});
assert.equal(folders.length,1);
assert.ok(folders[0].isDirectory());
const binary = join(extracted,folders[0].name,process.platform === 'win32' ? '127vaults-install.exe' : '127vaults-install');
assert.equal(await execute(binary,['--version'],{capture:true}),`127vaults-install ${manifest.packageVersion}`);
const command = ['--discover',...(args.includes('--engine') ? ['--engine',option('--engine')] : [])];
const servers = JSON.parse(await execute(binary,command,{capture:true}));
assert.ok(Array.isArray(servers));
let existingLicensePlan = false;
if (args.includes('--check-existing-license-plan')) {
  if (!process.env.VAULTS_INSTALL_INVITATION) throw Error('Set VAULTS_INSTALL_INVITATION in this process; it is never written to the receipt.');
  // cliclack sends its human-readable plan to stderr, including on success.
  const result = await promisify(execFile)(binary,['--components','server','--keep-existing-license','--plan',
    ...(args.includes('--engine') ? ['--engine',option('--engine')] : [])],
    {windowsHide:true,timeout:60000,maxBuffer:1048576});
  const plan = result.stdout + result.stderr;
  assert.ok(plan.includes('Keep this server\'s existing license'));
  assert.ok(plan.includes('Upgrade:') || plan.includes('Check existing installation:'));
  assert.ok(!plan.includes('Install / resume:'));
  existingLicensePlan = true;
}
assert.equal(await snapshot(),before,'Read-only discovery changed installer state');
const output = resolve(option('--output'));
await mkdir(resolve(output,'..'),{recursive:true});
await writeFile(output,JSON.stringify({status:'passed',testedAt:new Date().toISOString(),packageVersion:manifest.packageVersion,
  sourceRevision:manifest.sourceRevision,binary,servers,installerStateUnchanged:true,existingLicensePlan,
  checks:['Release hashes verified','Consumer archive extracted','Embedded version matches','Live discovery completed without state changes'],
  limitation:'No setup, upgrade, trial activation or publication performed'},null,2)+'\n',{flag:'wx'});
console.log(`Local installer ready: ${binary}\nReceipt: ${output}`);
