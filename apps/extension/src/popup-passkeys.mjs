import { enableAllPasskeys, disableAllPasskeys } from './passkey-settings.mjs';
import { originOf } from './match.mjs';

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
    const settings = await chrome.storage.local.get(['passkeysAllSites', 'passkeyOrigins']);
    $('enable-passkeys').hidden = settings.passkeysAllSites === true && await chrome.permissions.contains({ origins: ['https://*/*'] });
    $('disable-passkeys').hidden = settings.passkeysAllSites !== true && !settings.passkeyOrigins?.length;
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
    if (processing) return;
    try {
      await enableAllPasskeys(chrome);
      if (originOf(getTab()?.url)) {
        await chrome.scripting.executeScript({ target: { tabId: getTab().id }, files: ['src/passkey-bridge.js'], world: 'ISOLATED' }).catch(() => {});
        await chrome.scripting.executeScript({ target: { tabId: getTab().id }, files: ['src/passkey-page.js'], world: 'MAIN' }).catch(() => {});
      }
      status('127Vaults passkeys enabled on all HTTPS sites. Reload existing pages before testing.');
      await refresh();
    } catch (error) { status(String(error?.message || error), true); }
  };
  $('disable-passkeys').onclick = async () => {
    if (processing) return;
    try {
      if (request) await send({ kind: 'passkey.cancel', id: request.id, useBrowser: true });
      await disableAllPasskeys(chrome);
      status('127Vaults passkeys disabled. Reload existing pages to restore the browser methods.');
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
