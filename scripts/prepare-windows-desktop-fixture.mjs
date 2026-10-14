// Prepare a reviewed manual launcher; this script never launches/installs Desktop.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {verifyRelease} from './release/verify-release.mjs';
assert.equal(process.platform,'win32');
const [releaseArg,rootArg]=process.argv.slice(2);assert.ok(releaseArg&&rootArg,'Supply the selected release directory and owned fixture root.');const release=resolve(releaseArg),root=resolve(rootArg);
assert.equal(root.toLowerCase(),'c:\\projects\\127vaults-sync-desktop-20261013-a');
const manifest=await verifyRelease(release);assert.equal(manifest.product,'desktop');assert.equal(manifest.platform,'windows');assert.equal(manifest.sourceRevision,'fba2cb203cbcfc4c81008c871def05ab37da4e52');
const oldProfile=join(root,'profile-h'),profile=join(root,'profile-k'),app=join(root,'app-l'),starter=join(root,'start-isolated-desktop.ps1');
const device=await readFile(join(oldProfile,'device.conf'),'utf8');assert.ok(device.includes('username=owner_127\n')&&device.includes('server_id=14725fef-f5b4-4cb8-afe0-77aa3d80b268\n'));
const sevenZip='C:/Program Files/7-Zip/7z.exe';await access(sevenZip);
await access(profile).then(()=>{throw Error('Prepared profile already exists');},error=>{if(error.code!=='ENOENT')throw error;});await mkdir(app);await cp(oldProfile,profile,{recursive:true,errorOnExist:true,force:false});
const archive=join(release,'127vaults-desktop-0.0.0-windows-x64.exe');
await new Promise((accept,reject)=>{const child=spawn(sevenZip,['x',archive,'-o'+app,'-y'],{windowsHide:true,stdio:'pipe'});let error='';child.stdout.resume();child.stderr.on('data',chunk=>error+=chunk);child.on('error',reject);child.on('close',code=>code?reject(Error('Static installer extraction failed: '+error)):accept());});
const binary=join(app,'vaults-desktop-poc.exe');for(const name of ['vaults-desktop-poc.exe','127vaults.exe','127vaults-extension-host.exe','install-native-host.ps1'])await access(join(app,name));
const binaryHash=createHash('sha256').update(await readFile(binary)).digest('hex'),quote=value=>"'"+value.replaceAll("'","''")+"'";
const text=`$ErrorActionPreference = 'Stop'
$fixtureRoot = ${quote(root)}
$fixtureProfile = Join-Path $fixtureRoot 'profile-k'
$fixtureBinary = Join-Path $fixtureRoot 'app-l\\vaults-desktop-poc.exe'
$fixtureDevice = [IO.File]::ReadAllText((Join-Path $fixtureProfile 'device.conf'))
if (-not $fixtureDevice.Contains("username=owner_127\x60n") -or -not $fixtureDevice.Contains("server_id=14725fef-f5b4-4cb8-afe0-77aa3d80b268\x60n")) { throw 'This launcher accepts only the isolated fictitious profile.' }
if ((Get-FileHash -LiteralPath $fixtureBinary -Algorithm SHA256).Hash.ToLowerInvariant() -ne '${binaryHash}') { throw 'The reviewed fixture binary has changed; do not launch it.' }
$env:VAULTS_CONFIG_DIR = $fixtureProfile
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $fixtureRoot 'webview-l'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=12915'
$fixtureApp = Start-Process -FilePath $fixtureBinary -WindowStyle Normal -PassThru
$fixtureApp.Id | Set-Content -LiteralPath (Join-Path $fixtureRoot 'app-l-pid.txt')
Write-Host 'Desktop-i isolated fixture opened. Leave it at the unlock screen for acceptance.'
`;
await writeFile(join(root,'start-isolated-desktop.previous-20261014-i.ps1'),await readFile(starter),{flag:'wx'});await writeFile(starter,text);
await writeFile(join(root,'manual-preparation-20261014-i.json'),JSON.stringify({status:'prepared; not launched',fixtureServer:'14725fef-f5b4-4cb8-afe0-77aa3d80b268',sourceRevision:manifest.sourceRevision,release,archiveSha256:manifest.files.find(row=>row.name.endsWith('.exe')).sha256,binarySha256:binaryHash,profile,app,starter,checks:['Release manifest/files verified','Installer unpacked as data without installation or execution','Existing app/profile/starter preserved separately','Launcher pins extracted executable hash and fictitious profile'],limits:['Manual human launch remains pending; no Windows GUI or native registration changed.']},null,2)+'\n',{flag:'wx'});
console.log('Latest Windows fixture prepared for manual launch; Desktop was not launched.');
