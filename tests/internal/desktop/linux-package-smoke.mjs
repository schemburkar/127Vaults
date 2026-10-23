// Fresh-container package dependencies and GUI startup; no enrolled/default user profiles.
import assert from 'node:assert/strict';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { verifyRelease } from '../../../scripts/release/verify-release.mjs';
import { openDesktopFixtureInspector } from '../support/desktop-fixture-inspector.mjs';
const execute=promisify(execFile);
const [desktopPath,cliPath,workArg,portArg='12911']=process.argv.slice(2);
assert.ok(desktopPath&&cliPath&&workArg,'Supply desktop/CLI release directories and a new external workspace');
const work=resolve(workArg),checkout=resolve(import.meta.dirname,'../../..'),rel=relative(checkout,work),port=Number(portArg);
assert.ok(rel&&(isAbsolute(rel)||rel==='..'||rel.startsWith(`..${sep}`)),'Workspace must be outside the checkout');
assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
const [desktop,cli]=await Promise.all([verifyRelease(resolve(desktopPath)),verifyRelease(resolve(cliPath))]);
assert.equal(desktop.product,'desktop');assert.equal(desktop.platform,'linux');assert.equal(cli.product,'cli');assert.equal(cli.platform,'linux');
const appimage=desktop.files.find(file=>file.name.endsWith('.AppImage'));assert.ok(appimage);
const deb=desktop.files.find(file=>file.name.endsWith('.deb')),archive=cli.files.find(file=>file.name.endsWith('.tar.gz'));assert.ok(deb&&archive);
await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve));});
await mkdir(work);const context=join(work,'context');await mkdir(context);
await Promise.all([copyFile(join(resolve(desktopPath),appimage.name),join(context,'desktop.AppImage')),copyFile(join(resolve(desktopPath),deb.name),join(context,'desktop.deb')),copyFile(join(resolve(cliPath),archive.name),join(context,'cli.tar.gz'))]);
const cliDirectory=archive.name.replace(/\.tar\.gz$/,'');
await writeFile(join(context,'Dockerfile'),`FROM docker.io/library/ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
COPY desktop.deb desktop.AppImage cli.tar.gz /fixture/
RUN chmod +x /fixture/desktop.AppImage
RUN apt-get update && apt-get install -y /fixture/desktop.deb && dpkg-query -W 127vaults-desktop && /usr/bin/127vaults --version
# Xvfb and D-Bus are fixture infrastructure, not additional package-dependency claims.
RUN apt-get install -y xvfb xauth dbus-x11 python3 && mkdir -p /fixture-cli /fixture-ui/profile /fixture-ui/config /fixture-ui/data /fixture-ui/cache && tar -xzf /fixture/cli.tar.gz -C /fixture-cli && /fixture-cli/${cliDirectory}/127vaults --version
ENV VAULTS_CONFIG_DIR=/fixture-ui/profile XDG_CONFIG_HOME=/fixture-ui/config XDG_DATA_HOME=/fixture-ui/data XDG_CACHE_HOME=/fixture-ui/cache WEBKIT_INSPECTOR_HTTP_SERVER=0.0.0.0:12911 LIBGL_ALWAYS_SOFTWARE=1
CMD ["dbus-run-session","--","xvfb-run","-a","/usr/bin/vaults-desktop-poc"]
`);
const identity=randomUUID(),name='vaults-clean-client-'+identity.slice(0,12),image='localhost/127vaults-clean-client:'+identity;
let started=false,inspector;
async function run(stage,args,settings={}){
  try{const result=await execute('podman',args,{windowsHide:true,maxBuffer:32*1024*1024,...settings});await writeFile(join(work,stage+'.log'),result.stdout+result.stderr);return result.stdout.trim();}
  catch(error){await writeFile(join(work,stage+'.log'),String(error.stdout||'')+String(error.stderr||''));throw Error('Fresh-container fixture failed at '+stage);}
}
try{
  console.log('Building fresh Ubuntu 24.04 package fixture...');
  await run('build',['build','--tag',image,'.'],{cwd:context});
  await run('start',['run','--detach','--name',name,'--label','vaults.internal.fixture='+identity,'--publish',`127.0.0.1:${port}:12911`,image]);started=true;
  inspector=await openDesktopFixtureInspector('http://127.0.0.1:'+port,'webkit');
  let body='';for(let i=0;i<80;i++){body=await inspector.evaluate('document.body.innerText');if(body.includes('Unlock 127Vaults'))break;await new Promise(resolve=>setTimeout(resolve,250));}
  assert.ok(body.includes('Unlock 127Vaults'),'Fresh packaged UI did not start');
  await inspector.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(el=>el.textContent.includes('Register or create an account'));if(!button)throw Error('Missing fresh desktop setup');button.click();})()`);
  for(let i=0;i<80;i++){body=await inspector.evaluate('document.body.innerText');if(body.includes('Connect to your private server'))break;await new Promise(resolve=>setTimeout(resolve,250));}
  assert.ok(body.includes('Connect to your private server'));
  assert.equal(await inspector.evaluate(`document.querySelector('input[aria-label="Private server URL"]').value`),'');
  const probe=`import json,struct,subprocess
payload=json.dumps({'id':1,'action':'sources'}).encode()
host='/fixture-cli/${cliDirectory}/127vaults-extension-host'
reply=subprocess.run([host],input=struct.pack('<I',len(payload))+payload,capture_output=True,check=True).stdout
assert struct.unpack('<I',reply[:4])[0]==len(reply)-4
value=json.loads(reply[4:]);assert value['ok'] and value['id']==1 and value['value']['version']==1
assert not any(row.get('active') for row in value['value']['sources'])
print('Fresh standalone native host framing and empty-source discovery passed')
`;
  await run('native-host',['exec',name,'python3','-c',probe]);
  await run('package-remove-reinstall',['exec',name,'sh','-c',"printf '%s\\n' fixture-profile-marker > /fixture-ui/profile/preserve-marker; apt-get remove -y 127vaults-desktop; test ! -e /usr/bin/vaults-desktop-poc; test -f /fixture-ui/profile/preserve-marker; dpkg -i /fixture/desktop.deb; /usr/bin/127vaults --version"]);
  await inspector.close();inspector=null;
  await run('stop-debian-fixture',['rm','--force',name]);started=false;
  await run('start-appimage',['run','--detach','--name',name,'--label','vaults.internal.fixture='+identity,
    '--publish',`127.0.0.1:${port}:12911`,'--env','APPIMAGE_EXTRACT_AND_RUN=1',
    '--env','VAULTS_CONFIG_DIR=/fixture-appimage/profile','--env','XDG_CONFIG_HOME=/fixture-appimage/config',
    '--env','XDG_DATA_HOME=/fixture-appimage/data','--env','XDG_CACHE_HOME=/fixture-appimage/cache',
    image,'dbus-run-session','--','xvfb-run','-a','/fixture/desktop.AppImage']);started=true;
  inspector=await openDesktopFixtureInspector('http://127.0.0.1:'+port,'webkit');
  for(let i=0;i<80;i++){body=await inspector.evaluate('document.body.innerText');if(body.includes('Unlock 127Vaults'))break;await new Promise(resolve=>setTimeout(resolve,250));}
  assert.ok(body.includes('Unlock 127Vaults'),'Fresh AppImage UI did not start');
  const base=JSON.parse(await run('base-image',['image','inspect','docker.io/library/ubuntu:24.04']));
  await writeFile(join(work,'evidence.json'),JSON.stringify({date:new Date().toISOString(),status:'passed',scope:'Fresh Ubuntu container: declared Debian dependencies, GUI startup and package lifecycle; standalone CLI/native framing',desktopRevision:desktop.sourceRevision,cliRevision:cli.sourceRevision,baseDigest:base[0].Digest,checks:['fresh apt Debian dependency installation','standalone CLI version','packaged WebKit GUI startup and unconfigured trust form','native framing with no enrolled/unlocked sources','remove/reinstall preserves separate profile marker','AppImage extract-and-run WebKit GUI startup'],limitations:['Xvfb/container evidence; clean physical machine, desktop keyring enrollment and unrelated-host acceptance remain separate.']},null,2)+'\n');
  console.log('Fresh Ubuntu container package/startup/lifecycle checks passed.');
}finally{
  if(inspector)await inspector.close();
  if(started){const info=JSON.parse(await run('inspect-owned',['inspect',name]));assert.equal(info[0].Config.Labels['vaults.internal.fixture'],identity);await run('stop-owned',['rm','--force',name]);}
}
