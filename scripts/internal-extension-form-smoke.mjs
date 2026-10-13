// Real extension popup and native host, confined to explicit fictitious profiles.
// Every website response is a synthetic document; no external site is contacted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, copyFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { attachExtensionPopup } from './extension-popup-driver.mjs';
import { runInstalledPasskeyFixture } from './installed-extension-passkey-fixture.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--extension', '--host', '--profile', '--desktop-profile', '--react-fixture', '--work', '--server-id', '--passkeys', '--passkeys-only'].includes(key) || !value || options[key]) throw Error('Supply explicit extension, host, profile, workspace and server ID; optional desktop profile and React fixture.');
  options[key] = value;
}
for (const key of ['--extension', '--host', '--profile', '--work', '--server-id']) if (!options[key]) throw Error('Missing fixture argument.');
const serverId = options['--server-id'];
assert.match(serverId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const work = resolve(options['--work']), profile = resolve(options['--profile']);
async function fixtureProfile(path) {
  const value = await readFile(join(path, 'device.conf'), 'utf8');
  assert.ok(value.includes(`server_id=${serverId}\n`) && value.includes('username=owner_127\n'), 'Only the explicitly selected fictitious profiles are accepted.');
}
await fixtureProfile(profile);
const checkout = resolve(import.meta.dirname, '..'), rel = relative(checkout, work);
if (!rel || !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) throw Error('Use a new workspace outside the checkout.');
await mkdir(work);
const desktopProfile = options['--desktop-profile'] ? resolve(options['--desktop-profile']) : join(work, 'empty-desktop');
if (options['--desktop-profile']) await fixtureProfile(desktopProfile); else await mkdir(desktopProfile);
const pointer = join(homedir(), '.127vaults-active');
const oldPointer = await readFile(pointer).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
const executable = join(work, process.platform === 'win32' ? '127vaults-extension-host.exe' : '127vaults-extension-host');
await copyFile(resolve(options['--host']), executable);
if (process.platform !== 'win32') { const { chmod } = await import('node:fs/promises'); await chmod(executable, 0o700); }
const manifestPath = join(work, 'com.127vaults.connector.json');
const configRoot = join(work, 'config');
await mkdir(configRoot);
const registryKey = 'HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.127vaults.connector';
const ps = source => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], {
  encoding: 'utf8', windowsHide: true, env: { ...process.env, VAULTS_FIXTURE_KEY: registryKey, VAULTS_FIXTURE_MANIFEST: manifestPath },
}).trim();
const oldRegistry = process.platform === 'win32' ? JSON.parse(ps("$p=$env:VAULTS_FIXTURE_KEY; if(Test-Path -LiteralPath $p){@{present=$true;value=(Get-Item -LiteralPath $p).GetValue('')}|ConvertTo-Json -Compress}else{@{present=$false;value=$null}|ConvertTo-Json -Compress}")) : null;
if (oldRegistry) await writeFile(join(work, 'prior-registration.json'), JSON.stringify(oldRegistry));
if (oldPointer) await writeFile(join(work, 'prior-profile-pointer.txt'), oldPointer);
const { chromium } = createRequire(import.meta.url)(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
let context, worker, extensionId, registered = false, pointerChanged = false;
const origin = 'https://offline-remote.invalid';
const checks = [];
const reactFixture=options['--react-fixture']&&await readFile(resolve(options['--react-fixture']),'utf8');
const form = '<form><label>Username<input name="username" autocomplete="username"></label><label>Password<input name="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form>';
const monitor = '<script>window.submits=0;window.events=[];document.addEventListener("submit",event=>{event.preventDefault();window.submits++});document.addEventListener("input",event=>window.events.push(event.target.name));document.addEventListener("change",event=>window.events.push(event.target.name));</script>';
const pages = {
  '/login': form,
  '/username': '<form><input name="username" autocomplete="username"><button>Next</button></form>',
  '/password': '<form><input name="password" type="password" autocomplete="current-password"><button>Sign in</button></form>',
  '/ambiguous': '<form><input name="username" autocomplete="username"><input type="password"><input type="password"></form>',
  '/new-password': '<form><input name="username" autocomplete="username"><input type="password" autocomplete="new-password"></form>',
  '/frames': form + '<iframe src="/frame"></iframe><iframe src="https://foreign.invalid/frame"></iframe>',
  '/frame': form,
  '/shadow': '<div id="host"></div><script>document.querySelector("#host").attachShadow({mode:"open"}).innerHTML='+JSON.stringify(form)+'</script>',
  '/react': '<div id="controlled"></div><script src="/react-fixture.js"></script>',
};
async function launch() {
  context = await chromium.launchPersistentContext(join(work, 'browser'), {
    ...(process.platform === 'win32' ? { executablePath: process.env.VAULTS_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' } : { channel: 'chromium' }),
    headless: process.env.VAULTS_EXTENSION_HEADED !== '1', ignoreDefaultArgs: ['--disable-extensions'],
    env: { ...process.env, XDG_CONFIG_HOME: configRoot, VAULTS_CONFIG_DIR: desktopProfile },
    args: [`--disable-extensions-except=${resolve(options['--extension'])}`, `--load-extension=${resolve(options['--extension'])}`],
  });
  await context.route('https://**/*', route => {
    const url = new URL(route.request().url());
    if (!['offline-remote.invalid', 'foreign.invalid', 'wrong-origin.invalid'].includes(url.hostname)) return route.abort();
    if(url.pathname==='/react-fixture.js'&&reactFixture)return route.fulfill({contentType:'text/javascript',body:reactFixture});
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fictitious connector acceptance</title>'+(pages[url.pathname] || form)+monitor });
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  await worker.evaluate(() => {
    globalThis.fixtureNativeActions = [];
    const original = chrome.runtime.connectNative.bind(chrome.runtime);
    chrome.runtime.connectNative = name => {
      const port = original(name), post = port.postMessage.bind(port);
      port.postMessage = request => { globalThis.fixtureNativeActions.push({ action: request.action, source: request.source }); post(request); };
      return port;
    };
  });
}
async function popup(page) {
  await page.bringToFront();
  const browserSession = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const tabs = targetInfos.filter(info => info.type === 'tab' && info.url === page.url());
  assert.equal(tabs.length, 1, 'Expected one synthetic target tab.');
  const before = (await browserSession.send('Target.getTargets',{filter:[{}]})).targetInfos.map(info=>info.targetId);
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: tabs[0].targetId });
  let popupTarget;
  for(let i=0;i<100;i++){
    popupTarget=(await browserSession.send('Target.getTargets',{filter:[{}]})).targetInfos.find(info=>!before.includes(info.targetId)&&(info.type==='other'||info.type==='page'&&info.url.startsWith(`chrome-extension://${extensionId}/`)));
    if(popupTarget)break;await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(!popupTarget)console.log('Action target observations:',(await browserSession.send('Target.getTargets',{filter:[{}]})).targetInfos.map(info=>({type:info.type,url:info.url})));
  assert.ok(popupTarget,'Real action popup did not expose a target.');
  const result = await attachExtensionPopup(browserSession,popupTarget.targetId);
  await result.waitForURL(`chrome-extension://${extensionId}/popup.html`);
  await result.locator('#source-select').waitFor({ state: 'visible' });
  return result;
}
async function selectedPopup(page, source = 'cli') {
  const view = await popup(page);
  await view.locator('#source-select').selectOption(source);
  await view.locator('#items .item').first().waitFor({ state: 'visible' });
  return view;
}
async function assertFilled(page, field, expected) {
  assert.ok((await page.locator(`input[name="${field}"]`).inputValue()) === expected, 'Synthetic field did not contain the expected fixture value.');
  assert.equal(await page.evaluate(() => window.submits), 0);
}
try {
  await writeFile(pointer, profile+'\n'); pointerChanged = true;
  await launch();
  const manifest = JSON.stringify({ name: 'com.127vaults.connector', description: 'Fictitious connector acceptance', path: executable, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`] });
  await writeFile(manifestPath, manifest);
  if (process.platform === 'win32') {
    registered = true;
    ps("$null=New-Item -Path $env:VAULTS_FIXTURE_KEY -Force; Set-Item -LiteralPath $env:VAULTS_FIXTURE_KEY -Value $env:VAULTS_FIXTURE_MANIFEST");
  } else {
    // All locations belong to this new context/config root, never a user's browser.
    for (const path of [join(work,'browser','NativeMessagingHosts'), ...['google-chrome','google-chrome-for-testing','chromium','microsoft-edge'].map(name=>join(configRoot,name,'NativeMessagingHosts'))]) {
      await mkdir(path, { recursive: true }); await writeFile(join(path,'com.127vaults.connector.json'), manifest, { mode: 0o600 });
    }
  }
  const page = context.pages()[0] || await context.newPage();
  let passkeyPage=page;
  if(options['--passkeys-only']!=='yes'){
  for (const [path, fields] of [['/login',['username','password']],['/username',['username']],['/password',['password']]]) {
    await page.goto(origin+path);
    const view = await selectedPopup(page);
    const closed = view.waitForEvent('close');
    await view.locator('#items .item').first().click(); await closed;
    for (const field of fields) await assertFilled(page,field,field==='username'?'base-user':'api010-fiction-secret');
    checks.push(`${path} explicit fill without submit`);
  }
  await page.goto(origin+'/ambiguous');
  let beforeGet=(await worker.evaluate(()=>globalThis.fixtureNativeActions)).filter(row=>row.action==='get').length;
  let view = await selectedPopup(page);
  await view.locator('#items .item').first().click();
  await view.locator('#status').filter({ hasText: /ambiguous/i }).waitFor();
  assert.equal(await page.locator('input').evaluateAll(inputs=>inputs.filter(input=>input.value).length),0);
  assert.equal((await worker.evaluate(()=>globalThis.fixtureNativeActions)).filter(row=>row.action==='get').length,beforeGet);
  await view.close(); checks.push('ambiguous form refusal');
  await page.goto(origin+'/new-password');view=await selectedPopup(page);
  beforeGet=(await worker.evaluate(()=>globalThis.fixtureNativeActions)).filter(row=>row.action==='get').length;
  await view.locator('#items .item').first().click();
  await view.locator('#status').filter({hasText:/new password/i}).waitFor();
  assert.equal(await page.locator('input').evaluateAll(inputs=>inputs.filter(input=>input.value).length),0);
  assert.equal((await worker.evaluate(()=>globalThis.fixtureNativeActions)).filter(row=>row.action==='get').length,beforeGet);
  await view.close();checks.push('new-password form refused before credential retrieval');
  await page.goto(origin+'/frames');view=await selectedPopup(page);
  await view.locator('#items .item').first().click();
  const frameButton=view.locator('#frames button').filter({hasText:/^Frame /}).first();await frameButton.waitFor();
  let frameClosed=view.waitForEvent('close');await frameButton.click();await frameClosed;
  assert.equal(await page.locator('input').evaluateAll(inputs=>inputs.filter(input=>input.value).length),0);
  await assertFilled(page.frames().find(frame=>frame.url()===origin+'/frame'),'password','api010-fiction-secret');
  assert.equal(await page.frames().find(frame=>frame.url()==='https://foreign.invalid/frame').locator('input').evaluateAll(inputs=>inputs.filter(input=>input.value).length),0);
  checks.push('explicit same-origin frame selection; main and cross-origin frames untouched');
  await page.goto(origin+'/shadow');view=await selectedPopup(page);
  let shadowClosed=view.waitForEvent('close');await view.locator('#items .item').first().click();await shadowClosed;
  await assertFilled(page,'password','api010-fiction-secret');checks.push('open shadow-root fill');
  if(reactFixture){
    await page.goto(origin+'/react');await page.locator('#rerender').waitFor();view=await selectedPopup(page);
    let controlledClosed=view.waitForEvent('close');await view.locator('#items .item').first().click();await controlledClosed;
    await page.locator('#rerender').click();await assertFilled(page,'username','base-user');await assertFilled(page,'password','api010-fiction-secret');
    assert.ok((await page.evaluate(()=>window.events)).includes('password'));checks.push('React controlled values survive rerender');
  }
  await page.goto(origin+'/login');view=await selectedPopup(page);
  beforeGet=(await worker.evaluate(()=>globalThis.fixtureNativeActions)).filter(row=>row.action==='get').length;
  await page.goto('https://wrong-origin.invalid/login');
  if(!await view.isClosed()){await view.locator('#items .item').first().click();await view.locator('#status').filter({hasText:/page changed/i}).waitFor();await view.close();}
  assert.equal(await page.locator('input').evaluateAll(inputs=>inputs.filter(input=>input.value).length),0);
  assert.equal((await worker.evaluate(()=>globalThis.fixtureNativeActions)).filter(row=>row.action==='get').length,beforeGet);
  checks.push('navigation origin change refused before credential retrieval');
  await page.goto('https://wrong-origin.invalid/login');
  view = await popup(page);
  await view.locator('#status').filter({hasText:/No sign-ins saved/}).waitFor();
  assert.equal(await view.locator('#items .item').count(),0);
  await view.close(); checks.push('wrong-origin no match');
  await page.goto(origin+'/login');
  view = await selectedPopup(page);
  if (options['--desktop-profile']) {
    await view.locator('#source-select').selectOption('desktop');
    await view.locator('#items .item').first().waitFor();
    const closed=view.waitForEvent('close'); await view.locator('#items .item').first().click(); await closed;
    await assertFilled(page,'password','api010-fiction-secret');
    assert.ok((await worker.evaluate(()=>globalThis.fixtureNativeActions)).some(row=>row.action==='get'&&row.source==='desktop'));
    checks.push('desktop/CLI source handoff');
  } else await view.close();
  await context.close(); context=null;
  await launch();
  const restartedPage=context.pages()[0]||await context.newPage(); await restartedPage.goto(origin+'/login');
  view=await selectedPopup(restartedPage);
  let closed=view.waitForEvent('close');await view.locator('#items .item').first().click();await closed;
  await assertFilled(restartedPage,'password','api010-fiction-secret');checks.push('browser process restart and native reconnect');
  view=await selectedPopup(restartedPage);await view.locator('#lock-vault').click();
  await view.locator('#status').filter({hasText:/locked/i}).waitFor();
  assert.equal(await view.locator('#items .item:visible').count(),0);await view.close();checks.push('source lock clears visible results');
  passkeyPage=restartedPage;
  }
  if(options['--passkeys']==='yes'){
    assert.ok(options['--desktop-profile'],'Passkeys require an explicit fictitious desktop profile');
    await runInstalledPasskeyFixture({page:passkeyPage,worker,popup,context,origin,checks});
  }
  const version=context.browser().version();
  await writeFile(join(work,'evidence.json'),JSON.stringify({date:new Date().toISOString(),status:'passed',browserVersion:version,platform:process.platform,scope:'Real installed extension popup, activeTab and native host; synthetic sites and fictitious profiles',checks,limitations:['No physical OS-lock acceptance.','No external website account or real credentials used.']},null,2)+'\n');
  console.log('Installed extension popup and native form checks passed: '+checks.join('; '));
} finally {
  try { if(context)await context.close(); }
  finally {
    try { if(pointerChanged){if(oldPointer===null)await unlink(pointer);else await writeFile(pointer,oldPointer);} }
    finally { if(registered){if(oldRegistry.present){process.env.VAULTS_FIXTURE_OLD_REG=oldRegistry.value||'';ps("$null=New-Item -Path $env:VAULTS_FIXTURE_KEY -Force; Set-Item -LiteralPath $env:VAULTS_FIXTURE_KEY -Value $env:VAULTS_FIXTURE_OLD_REG");if(oldRegistry.value===null)ps("$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.127vaults.connector',$true);try{$k.DeleteValue('', $false)}finally{$k.Dispose()}");}else ps("if(Test-Path -LiteralPath $env:VAULTS_FIXTURE_KEY){Remove-Item -LiteralPath $env:VAULTS_FIXTURE_KEY -Force}");} }
  }
  console.log('Original profile pointer and browser registration restored.');
}
