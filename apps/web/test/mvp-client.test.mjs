import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { PrivateVaultClient } from "../src/private-vault-client.mjs";

async function licenseHarness() {
  const source = await readFile(new URL('../mvp-client.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('let stopLicenseStatus ='), source.indexOf('async function login() {'));
  const calls = [], events = new Map(), timers = new Map();
  const elements = { vault: { hidden: false }, state: { textContent: 'Unlocked' } };
  const context = vm.createContext({ root: {}, serverAuthenticated: true, sessionGeneration: 1,
    document: { hidden: false }, $: id => elements[id],
    refreshEntitlement: () => new Promise(resolve => calls.push(resolve)),
    checkLicense: () => ({ mode: 'active' }), networkUnavailable: () => false,
    lock: async () => { context.root = null; elements.vault.hidden = true; context.sessionGeneration++; },
    window: { setInterval: (callback, delay) => { assert.equal(delay, 30000); timers.set(1, callback); return 1; },
      clearInterval: id => timers.delete(id), addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) },
  });
  vm.runInContext(code + '\nmonitorLicenseStatus();', context);
  return { calls, events, timers, elements, context, stop: () => vm.runInContext('stopLicenseStatus()', context) };
}

test('unlocked web session refreshes license expiry and renewal without duplicate requests', async () => {
  const h = await licenseHarness();
  await h.events.get('focus')(); assert.equal(h.calls.length, 1);
  h.calls[0]({ mode: 'active' }); await new Promise(setImmediate);
  h.timers.get(1)(); h.calls[1]({ mode: 'read-only' }); await new Promise(setImmediate);
  assert.match(h.elements.state.textContent, /Expired:.*writes are blocked/);
  h.context.document.hidden = true; h.timers.get(1)(); assert.equal(h.calls.length, 2);
  h.context.document.hidden = false;
  const focused = h.events.get('focus')(); h.calls[2]({ mode: 'active', expiresAt: '2030-01-01' }); await focused;
  assert.match(h.elements.state.textContent, /Active until 2030-01-01/);
  h.stop(); assert.equal(h.timers.size, 0); assert.equal(h.events.size, 0);
});

test('web discards an old license response after locking or switching sessions', async () => {
  const h = await licenseHarness(); const oldResponse = h.calls[0];
  h.stop(); vm.runInContext('sessionGeneration += 1; monitorLicenseStatus()', h.context);
  h.calls[1]({ mode: 'active' }); await new Promise(setImmediate);
  oldResponse({ mode: 'revoked' }); await new Promise(setImmediate);
  assert.match(h.elements.state.textContent, /Active/); assert.doesNotMatch(h.elements.state.textContent, /Revoked/);
  h.stop();
  vm.runInContext('serverAuthenticated = false; monitorLicenseStatus()', h.context);
  assert.equal(h.calls.length, 2); h.stop();
});

async function deletionHarness(confirm = true) {
  const source=await readFile(new URL('../mvp-client.mjs',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function deleteItem() {'),source.indexOf('async function save(event'));
  const calls=[],events=[],values=[],context=vm.createContext({
    root:{},vault:{},vaultId:'owning-vault',sessionGeneration:1,busy:false,
    currentItem:{itemId:'selected-item',index:{title:'Selected'}},catalogue:new Uint8Array(80),
    core:{delete_private_item:()=>new Uint8Array(80)},id:value=>value,uuid:()=> 'revision',b64:()=> 'encrypted-catalogue',
    signedMutation:async(...args)=>{calls.push(['sign',...args]);return{kind:'item.delete'}},
    call:async(...args)=>{calls.push(['call',...args]);return{}},
    window:{confirm:()=>confirm,dispatchEvent:event=>events.push(event)},CustomEvent,
    crypto,Date,confirmDiscard:()=>true,setBusy:value=>values.push(value),clearItem:()=>events.push('clear'),
    reload:async()=>{},updateSessionDates:()=>{},toast:()=>{},safeError:String,replica:null,
  });
  vm.runInContext(code+'\nglobalThis.runDelete = deleteItem;',context);
  return{run:()=>context.runDelete(),calls,events,values,context};
}
test('web deletion confirmation protects cancellation and sends only a signed catalogue to the owning item',async()=>{
  const cancelled=await deletionHarness(false);await cancelled.run();assert.equal(cancelled.calls.length,0);
  const h=await deletionHarness();await h.run();
  assert.equal(h.calls[0][1],'item.delete');const request=h.calls[1];
  assert.equal(request[1],'/api/v1/vaults/owning-vault/items/selected-item');assert.equal(request[2].method,'DELETE');
  assert.equal(request[2].body.index,undefined);assert.equal(request[2].body.body,undefined);
  assert.ok(h.events.includes('clear'));assert.equal(h.values.at(-1),false);
});
test('web deletion response from a locked session cannot clear a newly opened item',async()=>{
  const h=await deletionHarness();let complete;
  h.context.call=()=>new Promise(resolve=>{complete=resolve});
  const done=h.run();await new Promise(setImmediate);h.context.sessionGeneration++;complete({});await done;
  assert.equal(h.events.length,0);
});

test("WebCrypto digests are converted with a bound constructor call", async () => {
  const source = await readFile(
    new URL("../mvp-client.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\.then\(Uint8Array\.from\)/);
  assert.match(
    source,
    /digest\("SHA-512", x\)\.then\(\(v\) => new Uint8Array\(v\)\)/,
  );
  const digest = await crypto.subtle.digest("SHA-512", new Uint8Array());
  assert.equal(new Uint8Array(digest).length, 64);
});

test("setup username validation matches the server grammar", async () => {
  const source = await readFile(
    new URL("../mvp-client.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /\^\[A-Za-z0-9_\]\[A-Za-z0-9_.-\]\{4,63\}\$/);
});

test("device proof uses the server-defined request and response transcript", async () => {
  const source = await readFile(
    new URL("../mvp-client.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /deviceTranscript = await hash\(cat\(request, response\)\)/,
  );
  assert.match(source, /verified\.deviceTranscript/);
  assert.doesNotMatch(source, /verified\.transcript/);
});

test("private-vault requests retain the browser fetch receiver", async () => {
  let called = false;
  function browserFetch(url, options) {
    assert.equal(this, globalThis);
    assert.equal(url, "/api/v1/vaults");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["X-127V-CSRF"], "csrf");
    called = true;
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }
  const record = new Uint8Array(102);
  const vault = {
    context: () => new Uint8Array(81),
    envelope: () => new Uint8Array(205),
  };
  const made = {
    vault: () => vault,
    directory: () => new Uint8Array(174),
    catalogue: () => new Uint8Array(110),
  };
  const client = new PrivateVaultClient({
    core: { create_private_vault: () => made },
    root: {},
    csrf: "csrf",
    fetcher: browserFetch,
  });
  await client.create(record);
  assert.equal(called, true);
});

test("settings device panel is post-unlock, supports enrollment, and fails safely", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../mvp.html", import.meta.url), "utf8"),
    readFile(new URL("../mvp-client.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<dialog id="settings"/);
  assert.match(html, /data-settings-view="profile"/);
  assert.match(html, /data-settings-view="devices"/);
  assert.match(html, /id="device-list"/);
  assert.doesNotMatch(html, /id="revoke-device"|id="enroll-device"/);
  assert.match(html, /id="begin-enrollment"/);
  assert.match(html, /id="complete-enrollment"/);
  assert.match(source, /call\("\/api\/v1\/devices"\)/);
  assert.match(source, /\$\("settings"\)\.showModal\(\)/);
  assert.match(
    source,
    /Device status is temporarily unavailable\. Your vault remains unlocked\./,
  );
  assert.match(source, /\/api\/v1\/devices\/revoke/);
  assert.match(source, /device\.deviceId === identity\?\.deviceId/);
  assert.match(source, /\$\("settings"\)\.close\(\)/);
});

test("new UX uses progressive login, default sorting, compact save actions, and no app message bar", async () => {
  const [html, source, css] = await Promise.all([
    readFile(new URL("../mvp.html", import.meta.url), "utf8"),
    readFile(new URL("../mvp-client.mjs", import.meta.url), "utf8"),
    readFile(new URL("../style.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="login-username-step"/);
  assert.match(html, /id="login-password-step"/);
  assert.match(html, /id="registration-flow"/);
  assert.doesNotMatch(html, /id="app-message"/);
  assert.doesNotMatch(html, /Encrypted before leaving/);
  assert.match(html, /id="save"[^>]*>Save<\/button><button id="cancel-edit"/);
  assert.match(source, /items\.sort\(/);
  assert.match(source, /\["ArrowDown", "ArrowUp", "Home", "End"\]/);
  assert.match(css, /\.custom-field select\{appearance:none/);
});

test("custom fields stay in encrypted item bodies and domains normalize to HTTPS", async () => {
  const [html, source, app] = await Promise.all([
    readFile(new URL("../mvp.html", import.meta.url), "utf8"),
    readFile(new URL("../mvp-client.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/app.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="add-custom-field"/);
  assert.match(html, /id="view-custom-fields"/);
  assert.match(source, /fields = collectCustomFields\(\)/);
  assert.match(source, /customFields: fields/);
  assert.match(app, /FieldTypePicker value=/);
  const picker = await readFile(new URL('../../../packages/ui/src/field-type-picker.tsx', import.meta.url), 'utf8');
  for (const kind of ['text', 'password', 'url', 'date', 'email', 'number', 'note']) assert.match(picker, new RegExp(kind + ':'));
  assert.match(source, /querySelector\("\.field-type-value"\)/);
  assert.match(source, /`https:\/\/\$\{value\}`/);
  assert.match(source, /parsed\.username\s+\|\|\s+parsed\.password/);
});

test("ordinary app switching does not lock and item interactions stay local", async () => {
  const source = await readFile(
    new URL("../mvp-client.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /visibilitychange/);
  assert.match(
    source,
    /\$\("search"\)\.oninput = \(\) => renderItems\(loadedItems\)/,
  );
  assert.match(
    source,
    /\$\("cancel-edit"\)\.onclick = \(\) => \{\s+if \(!confirmDiscard\(\)\) return;\s+currentItem\s+\? displayItem/,
  );
});

test("React owns the production component tree and shared Tailwind design system", async () => {
  const [entry, react, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/react-main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/tailwind.css", import.meta.url), "utf8"),
  ]);
  assert.match(entry, /id="root"/);
  assert.doesNotMatch(react, /legacy-shell|dangerouslySetInnerHTML/);
  assert.match(app, /@127vaults\/ui/);
  assert.match(app, /mvp-client\.mjs/);
  assert.match(styles, /@import "tailwindcss"/);
  assert.match(styles, /safe-area-inset-bottom/);
});

test("item and device rows are rendered by React rather than imperative DOM creation", async () => {
  const [app, source] = await Promise.all([
    readFile(new URL("../src/app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../mvp-client.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(app, /function ItemList\(/);
  assert.match(app, /function DeviceList\(\)/);
  assert.match(source, /CustomEvent\("vaults:items"/);
  assert.match(source, /CustomEvent\("vaults:devices"/);
  const itemRendering = source.slice(source.indexOf("function renderItems"), source.indexOf("const hex ="));
  assert.doesNotMatch(itemRendering, /document\.createElement|\.replaceChildren\(/);
  assert.match(app, /function CustomFieldsEditor\(\)/);
  assert.match(app, /function CustomFieldsView\(\)/);
});

test("opening an item does not disable and repaint every button", async () => {
  const source = await readFile(
    new URL("../mvp-client.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /querySelectorAll\("button"\)/);
  assert.match(source, /#save,#new-item,#create-vault/);
});

test("vault item selection does not trigger password-manager save prompts", async () => {
  const [app, source] = await Promise.all([
    readFile(new URL("../src/app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../mvp-client.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(app, /data-1p-ignore/);
  assert.match(app, /data-form-type="other"/);
  assert.match(source, /Do not leave credential-shaped values in the hidden editor/);
  assert.match(source, /\$\("item-password"\)\.type = "text"/);
  assert.match(source, /\$\("item-password"\)\.type = "password"/);
});

test("omnisearch includes actions and item loading stays locally scoped", async () => {
  const [app, source] = await Promise.all([
    readFile(new URL("../src/app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../mvp-client.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(app, /Search items and actions/);
  assert.match(source, /id: "new-item"/);
  assert.match(source, /id: "settings"/);
  assert.match(source, /runAction:/);
  const openItemBody = source.slice(
    source.indexOf("async function openItem"),
    source.indexOf("async function fetchItem"),
  );
  assert.doesNotMatch(openItemBody, /setBusy\(true\)/);
  assert.match(source, /\$\("items"\)\.setAttribute\("aria-busy", "true"\)/);
});

test("desktop enrollment links open the trusted-device approval view", async () => {
  const source = await readFile(new URL("../mvp-client.mjs", import.meta.url), "utf8");
  assert.match(source, /get\("enrollDevice"\)/);
  assert.match(source, /showSettingsView\("devices"\)/);
  assert.match(source, /Confirm this one-time code to register your desktop/);
});
