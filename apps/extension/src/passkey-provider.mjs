import { passkeysEnabled } from './passkey-settings.mjs';
import { createPasskeyQueue } from './passkey-queue.mjs';
import { createPasskey, assertPasskey, matches } from './passkeys.mjs';
import { originOf, permissionPattern } from './match.mjs';

export function installPasskeyProvider(nativeRequest) {
  const queue = createPasskeyQueue();
  async function current(row) {
    if (queue.get(row.id) !== row) throw Error('Passkey request expired or cancelled.');
    const tab = await chrome.tabs.get(row.tabId);
    if (originOf(tab.url) !== row.origin || queue.get(row.id) !== row) throw Error('The page changed.');
    const settings = await chrome.storage.local.get(['passkeysAllSites', 'passkeyOrigins']);
    if (!passkeysEnabled(settings, row.origin) || !(await chrome.permissions.contains({ origins: [permissionPattern(row.origin)] }))) throw Error('The passkey provider is disabled or site access was revoked.');
  }
  async function web(row, method, args = []) {
    const { vaultOrigin } = await chrome.storage.local.get('vaultOrigin');
    const origin = originOf(vaultOrigin);
    if (!origin || !(await chrome.permissions.contains({ origins: [permissionPattern(origin)] }))) throw Error('Connect an unlocked web vault tab first.');
    const tab = (await chrome.tabs.query({})).find(tab => tab.id !== row.tabId && originOf(tab.url) === origin);
    if (!tab) throw Error('Open and unlock the web vault tab first.');
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: async (method, args) => {
      try {
        const actions = window.__vaultsExtensionActions;
        if (!actions || typeof actions[method] !== 'function') return { error: 'This web client does not support passkeys. Update it first.' };
        return { value: await actions[method](...args) };
      } catch (error) { return { error: String(error?.message || error) }; }
    }, args: [method, args] });
    if (!result[0]?.result || result[0].result.error) throw Error(result[0]?.result?.error || 'Web vault is unavailable.');
    return result[0].result.value;
  }
  function source(value) { if (!['desktop', 'cli', 'web'].includes(value)) throw Error('Choose a vault source.'); return value; }
  async function rows(row, selectedSource) {
    source(selectedSource); await current(row);
    return selectedSource === 'web' ? web(row, 'passkeyList', [row.origin]) : nativeRequest({ action: 'passkey.list', source: selectedSource, siteOrigin: row.origin });
  }
  async function approve(row, message) {
    if (row.processing) throw Error('This passkey request is already being processed.');
    row.processing = true;
    let secret = null;
    try {
      const selectedSource = source(message.source), existing = await rows(row, selectedSource);
      const credentials = { source: selectedSource, siteOrigin: row.origin, username: message.username || '', accountSecret: message.accountSecret || '', masterPassword: message.masterPassword || '' };
      if (!credentials.masterPassword || credentials.masterPassword.length > 16384 || credentials.accountSecret.length > 256 || credentials.username.length > 256) throw Error('Verify your master password.');
      let response, saved;
      if (row.operation === 'create') {
        if (existing.some(entry => row.options.excludeCredentials?.some(c => c.id === entry.metadata.credentialId))) throw Error('A passkey excluded by this website already exists. Use the browser or the existing credential.');
        await current(row);
        secret = await createPasskey(row.options, row.origin, true);
        if (selectedSource === 'web') saved = await web(row, 'passkeySave', [secret.metadata, secret.privateKey, row.origin, credentials.masterPassword, message.vaultId]);
        else saved = await nativeRequest({ ...credentials, action: 'passkey.save', vaultId: message.vaultId, metadata: secret.metadata, privateKey: secret.privateKey });
        if (!saved?.itemId) throw Error('Passkey persistence could not be confirmed.');
        response = secret.response;
      } else {
        const entry = existing.find(entry => entry.itemId === message.itemId && entry.vaultId === message.vaultId && matches(entry.metadata, row.options, row.origin));
        if (!entry) throw Error('Choose a matching passkey.');
        secret = selectedSource === 'web'
          ? await web(row, 'passkeyGet', [entry.itemId, entry.vaultId, row.origin, credentials.masterPassword])
          : await nativeRequest({ ...credentials, action: 'passkey.get', itemId: entry.itemId, vaultId: entry.vaultId });
        await current(row);
        response = await assertPasskey(secret.metadata, secret.privateKey, row.options, row.origin, true);
      }
      await current(row);
      // Withhold success if the source was manually locked during this operation.
      await rows(row, selectedSource);
      await current(row);
      queue.finish(row.id, { value: response });
      return { ok: true, queued: saved?.queued === true, itemId: saved?.itemId, vaultId: saved?.vaultId || message.vaultId, source: selectedSource, syncError: saved?.syncError || null };
    } catch (error) {
      // A failed/ambiguous registration is terminal: never silently generate a
      // second key for the same website request after an uncertain save.
      if (row.operation === 'create') queue.finish(row.id, { error: String(error?.message || error) });
      throw error;
    } finally {
      if (secret) { secret.privateKey = ''; secret = null; }
      row.processing = false;
      message.masterPassword = ''; message.accountSecret = '';
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message?.kind?.startsWith('passkey.')) return;
    const work = async () => {
      if (sender.tab) {
        if (sender.frameId !== 0) throw Error('Passkeys require a top-level page.');
        if (message.kind === 'passkey.cancel') { queue.cancelPage(sender, message.id); return { ok: true }; }
        if (message.kind !== 'passkey.request') throw Error('Page cannot perform this passkey operation.');
        const origin = originOf(sender.url), settings = await chrome.storage.local.get(['passkeysAllSites', 'passkeyOrigins']);
        if (!origin || !passkeysEnabled(settings, origin) || !(await chrome.permissions.contains({ origins: [permissionPattern(origin)] }))) return { useBrowser: true };
        try {
          queue.add(message, sender, response => { chrome.action.setBadgeText({ tabId: sender.tab.id, text: '' }).catch(() => {}); respond(response); });
          await chrome.action.setBadgeText({ tabId: sender.tab.id, text: 'KEY' }).catch(() => {});
          chrome.action.openPopup?.().catch(() => {});
        } catch (error) { return { useBrowser: true, error: String(error?.message || error) }; }
        return undefined; // The pending ceremony holds the response channel.
      }
      if (message.kind === 'passkey.pending') return { requests: queue.list(message.tabId) };
      const row = queue.get(message.id);
      if (!row) throw Error('Passkey request expired. Start again on the website.');
      if (message.kind === 'passkey.cancel') {
        if (row.processing) throw Error('A passkey operation is in progress.');
        queue.finish(row.id, { useBrowser: message.useBrowser === true, error: 'Passkey request cancelled.' });
        await chrome.action.setBadgeText({ tabId: row.tabId, text: '' });
        return { ok: true };
      }
      if (message.kind === 'passkey.choices') {
        const selectedSource = source(message.source), entries = await rows(row, selectedSource);
        const vaults = row.operation === 'create' ? selectedSource === 'web' ? await web(row, 'passkeyVaults') : await nativeRequest({ action: 'passkey.vaults', source: selectedSource }) : [];
        return { entries: entries.filter(entry => row.operation === 'create' || matches(entry.metadata, row.options, row.origin)), vaults: vaults.filter(vault => !vault.retired) };
      }
      if (message.kind === 'passkey.approve') {
        const result = await approve(row, message);
        await chrome.action.setBadgeText({ tabId: row.tabId, text: '' });
        return result;
      }
      throw Error('Unsupported passkey operation.');
    };
    work().then(value => { if (value !== undefined) respond(value); }, error => respond({ error: String(error?.message || error) }));
    return true;
  });
  chrome.tabs.onRemoved?.addListener(tabId => queue.cancelTab(tabId));
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.passkeysAllSites?.newValue === false) queue.cancelAll();
  });
  chrome.tabs.onUpdated?.addListener((tabId, change) => { if (change.url || change.status === 'loading') queue.cancelTab(tabId); });
  return queue;
}
