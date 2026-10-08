import { encode } from './passkeys.mjs';
import { originOf, permissionPattern } from './match.mjs';

export function setupPasskeyPopup({ getTab, getSource, getSources, status }) {
  const $ = id => document.getElementById(id);
  let request = null, entries = [], processing = false, revision = 0, choicesKey = '';
  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (response?.error) throw Error(response.error);
    return response;
  }
  function option(value, label) { const row = document.createElement('option'); row.value = value; row.textContent = label; return row; }
  async function refresh(force = false) {
    if (processing || !getTab()?.id) return;
    const version = ++revision, tab = getTab();
    const origin = originOf(tab.url), { passkeyOrigins = [] } = await chrome.storage.local.get('passkeyOrigins');
    $('enable-passkeys').hidden = !origin || passkeyOrigins.includes(origin);
    $('disable-passkeys').hidden = !origin || !passkeyOrigins.includes(origin);
    const pending = await send({ kind: 'passkey.pending', tabId: tab.id });
    if (version !== revision) return;
    request = pending?.requests?.[0] || null;
    $('passkey-request').hidden = !request;
    if (!request) { choicesKey = ''; return; }
    const key = `${request.id}:${getSource()}`;
    if (!force && key === choicesKey) return;
    $('passkey-origin').textContent = request.origin;
    $('passkey-operation').textContent = request.operation === 'create' ? `Save a passkey for ${request.options.user.displayName || request.options.user.name}` : 'Use a saved passkey';
    $('passkey-approve').textContent = request.operation === 'create' ? 'Verify and save passkey' : 'Verify and use passkey';
    $('passkey-label').textContent = request.operation === 'create' ? 'Destination vault' : 'Passkey';
    $('passkey-username').value = getSources().find(source => source.id === getSource())?.usernameHint || $('passkey-username').value;
    $('passkey-native-fields').hidden = getSource() === 'web';
    $('passkey-choice').replaceChildren();
    $('passkey-approve').disabled = true;
    try {
      const choices = await send({ kind: 'passkey.choices', id: request.id, source: getSource() });
      if (version !== revision) return;
      choicesKey = key;
      entries = choices.entries || [];
      if (request.operation === 'get') for (const [index, entry] of entries.entries()) $('passkey-choice').append(option(String(index), `${entry.metadata.displayName || entry.metadata.username} · ${entry.title}`));
      else for (const vault of choices.vaults || []) $('passkey-choice').append(option(vault.vaultId, vault.name || vault.code || vault.vaultId));
      $('passkey-approve').disabled = !$('passkey-choice').options.length || request.processing;
      $('passkey-hint').textContent = request.operation === 'create' ? 'A new encrypted passkey item will be saved before this website receives success. An offline local save will sync when the client reconnects.' : entries.length ? 'Your master password is checked for this request. The website receives a signature, never the private key.' : 'No matching passkey in this source. Select another source or use the browser.';
    } catch (error) { $('passkey-hint').textContent = String(error?.message || error); }
  }
  $('enable-passkeys').onclick = async () => {
    const origin = originOf(getTab()?.url);
    if (!origin) return;
    try {
      if (!(await chrome.permissions.request({ origins: [permissionPattern(origin)] }))) throw Error('Site permission was not granted.');
      const { passkeyOrigins = [] } = await chrome.storage.local.get('passkeyOrigins');
      const suffix = encode(new TextEncoder().encode(origin));
      const ids = [`passkey-bridge-${suffix}`, `passkey-page-${suffix}`];
      const registered = await chrome.scripting.getRegisteredContentScripts({ ids });
      if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map(script => script.id) });
      await chrome.scripting.registerContentScripts([
        { id: ids[0], matches: [permissionPattern(origin)], js: ['src/passkey-bridge.js'], runAt: 'document_start', world: 'ISOLATED', allFrames: false },
        { id: ids[1], matches: [permissionPattern(origin)], js: ['src/passkey-page.js'], runAt: 'document_start', world: 'MAIN', allFrames: false },
      ]);
      await chrome.storage.local.set({ passkeyOrigins: [...new Set([...passkeyOrigins, origin])] });
      // Install immediately for sites that haven't captured the native methods;
      // reload is recommended so both scripts run before the site's own code.
      await chrome.scripting.executeScript({ target: { tabId: getTab().id }, files: ['src/passkey-bridge.js'], world: 'ISOLATED' });
      await chrome.scripting.executeScript({ target: { tabId: getTab().id }, files: ['src/passkey-page.js'], world: 'MAIN' });
      status('Passkeys enabled for this site. Reload the page before creating or using one.');
      await refresh();
    } catch (error) { status(String(error?.message || error), true); }
  };
  $('disable-passkeys').onclick = async () => {
    if (processing) return;
    const origin = originOf(getTab()?.url);
    if (!origin) return;
    try {
      if (request) await send({ kind: 'passkey.cancel', id: request.id, useBrowser: true });
      const { passkeyOrigins = [] } = await chrome.storage.local.get('passkeyOrigins');
      await chrome.storage.local.set({ passkeyOrigins: passkeyOrigins.filter(value => value !== origin) });
      const suffix = encode(new TextEncoder().encode(origin));
      const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [`passkey-bridge-${suffix}`, `passkey-page-${suffix}`] });
      if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map(script => script.id) });
      const { vaultOrigin } = await chrome.storage.local.get('vaultOrigin');
      const pattern = permissionPattern(origin);
      if ((!originOf(vaultOrigin) || permissionPattern(vaultOrigin) !== pattern) && !passkeyOrigins.some(site => site !== origin && permissionPattern(site) === pattern)) await chrome.permissions.remove({ origins: [pattern] });
      status('127Vaults passkeys disabled on this site. Reload the page to restore the browser methods.');
      await refresh();
    } catch (error) { status(String(error?.message || error), true); }
  };
  $('passkey-approve').onclick = async () => {
    if (!request || processing) return;
    processing = true;
    $('source-select').disabled = true;
    const selected = entries[Number($('passkey-choice').value)];
    const message = { kind: 'passkey.approve', id: request.id, source: getSource(), vaultId: request.operation === 'get' ? selected?.vaultId : $('passkey-choice').value, itemId: selected?.itemId, username: $('passkey-username').value.trim(), accountSecret: $('passkey-secret').value, masterPassword: $('passkey-master').value };
    $('passkey-secret').value = ''; $('passkey-master').value = '';
    $('passkey-approve').disabled = true; $('passkey-browser').disabled = true; $('passkey-cancel').disabled = true;
    try {
      const response = await send(message);
      status(response?.queued ? 'Passkey saved in the encrypted local replica. Reconnect the client to sync.' : 'Passkey request completed.');
      $('passkey-request').hidden = true;
    } catch (error) { status(String(error?.message || error), true); }
    finally { message.masterPassword = ''; message.accountSecret = ''; processing = false; $('source-select').disabled = false; $('passkey-browser').disabled = false; $('passkey-cancel').disabled = false; await refresh(); }
  };
  for (const [id, useBrowser] of [['passkey-browser', true], ['passkey-cancel', false]]) $(id).onclick = async () => {
    if (!request || processing) return;
    try { await send({ kind: 'passkey.cancel', id: request.id, useBrowser }); $('passkey-secret').value = ''; $('passkey-master').value = ''; await refresh(); }
    catch (error) { status(String(error?.message || error), true); }
  };
  return { refresh };
}
