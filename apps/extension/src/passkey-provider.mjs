import { passkeysEnabled, windowsNativeOnly } from './passkey-settings.mjs';
import { createPasskeyQueue } from './passkey-queue.mjs';
import { createPasskey, assertPasskey, matches } from './passkeys.mjs';
import { originOf, permissionPattern } from './match.mjs';

export function installPasskeyProvider(nativeRequest) {
  const queue = createPasskeyQueue();
  const selectedPasskeys = new Map();
  async function current(row) {
    if (await windowsNativeOnly(chrome)) throw Error('Use the Windows passkey picker with 127Vaults Desktop.');
    if (queue.get(row.id) !== row) throw Error('Passkey request expired or cancelled.');
    const tab = await chrome.tabs.get(row.tabId);
    if (originOf(tab.url) !== row.origin || queue.get(row.id) !== row) throw Error('The page changed.');
    const settings = await chrome.storage.local.get(['passkeysAllSites', 'passkeyOrigins']);
    if (!passkeysEnabled(settings, row.origin) || !(await chrome.permissions.contains({ origins: [permissionPattern(row.origin)] }))) throw Error('The passkey provider is disabled or site access was revoked.');
  }
  const unlockMessage = 'Unlock 127Vaults Desktop to continue. If it is already unlocked, restart the updated Desktop app.';
  function source(value) { if (value !== 'desktop') throw Error('Select Desktop and unlock it to use passkeys.'); return value; }
  async function desktopSession() {
    const result = await nativeRequest({ action: 'passkey.session', source: 'desktop' }).catch(() => null);
    if (!result?.verificationSession) throw Error(unlockMessage);
    return result.verificationSession;
  }
  async function rows(row, selectedSource) {
    source(selectedSource); await current(row);
    return nativeRequest({ action: 'passkey.list', source: selectedSource, siteOrigin: row.origin });
  }
  async function approve(row, message) {
    if (row.processing) throw Error('This passkey request is already being processed.');
    row.processing = true;
    let secret = null;
    try {
      const selectedSource = source(message.source), existing = await rows(row, selectedSource);
      if (message.masterPassword || message.accountSecret || !row.desktopVerificationSession) throw Error(unlockMessage);
      const credentials = { source: selectedSource, siteOrigin: row.origin, verificationSession: row.desktopVerificationSession };
      if (await desktopSession() !== credentials.verificationSession) throw Error('Desktop unlock session changed. Start again on the website.');
      let response, saved;
      if (row.operation === 'create') {
        if (existing.some(entry => row.options.excludeCredentials?.some(c => c.id === entry.metadata.credentialId))) throw Error('A passkey excluded by this website already exists. Use the browser or the existing credential.');
        await current(row);
        secret = await createPasskey(row.options, row.origin, true);
        if (message.itemId) {
          const targets = await nativeRequest({ action: 'passkey.targets', source: selectedSource, siteOrigin: row.origin });
          if (!targets.some(item => item.itemId === message.itemId && item.vaultId === message.vaultId)) throw Error('Choose a matching login without a passkey.');
        }
        saved = await nativeRequest({ ...credentials, action: 'passkey.save', vaultId: message.vaultId, itemId: message.itemId || '', metadata: secret.metadata, privateKey: secret.privateKey });
        if (!saved?.itemId) throw Error('Passkey persistence could not be confirmed.');
        response = secret.response;
      } else {
        const entry = existing.find(entry => entry.itemId === message.itemId && entry.vaultId === message.vaultId && matches(entry.metadata, row.options, row.origin));
        if (!entry) throw Error('Choose a matching passkey.');
        secret = await nativeRequest({ ...credentials, action: 'passkey.get', itemId: entry.itemId, vaultId: entry.vaultId });
        await current(row);
        response = await assertPasskey(secret.metadata, secret.privateKey, row.options, row.origin, true);
      }
      await current(row);
      // Withhold success if the source was manually locked during this operation.
      await rows(row, selectedSource);
      if (credentials.verificationSession) {
        const live = await nativeRequest({ action: 'passkey.session', source: 'desktop' });
        if (live?.verificationSession !== credentials.verificationSession) throw Error('Desktop unlock session changed. Start sign-in again.');
      }
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
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message?.kind?.startsWith('passkey.')) return;
    const work = async () => {
      if (sender.tab) {
        if (await windowsNativeOnly(chrome)) return { useBrowser: true };
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
      if (message.kind === 'passkey.select') {
        const tab = await chrome.tabs.get(message.tabId);
        selectedPasskeys.set(message.tabId, { source: source(message.source), origin: originOf(tab.url), itemId: message.itemId, vaultId: message.vaultId });
        return { ok: true };
      }
      const row = queue.get(message.id);
      if (!row) throw Error('Passkey request expired. Start again on the website.');
      if (message.kind === 'passkey.cancel') {
        if (row.processing) throw Error('A passkey operation is in progress.');
        queue.finish(row.id, { useBrowser: message.useBrowser === true, error: 'Passkey request cancelled.' });
        await chrome.action.setBadgeText({ tabId: row.tabId, text: '' });
        return { ok: true };
      }
      if (message.kind === 'passkey.choices') {
        const selectedSource = source(message.source);
        row.desktopVerificationSession = '';
        const session = await desktopSession();
        const entries = await rows(row, selectedSource);
        const vaults = row.operation === 'create' ? await nativeRequest({ action: 'passkey.vaults', source: selectedSource }) : [];
        const targets = row.operation === 'create' ? await nativeRequest({ action: 'passkey.targets', source: selectedSource, siteOrigin: row.origin }) : [];
        if (await desktopSession() !== session) throw Error(unlockMessage);
        row.desktopVerificationSession = session;
        const preferred = selectedPasskeys.get(row.tabId);
        return { preferred: preferred?.source === selectedSource && preferred?.origin === row.origin ? preferred : null, targets, reuseDesktopUnlock: !!row.desktopVerificationSession, entries: entries.filter(entry => row.operation === 'create' || matches(entry.metadata, row.options, row.origin)), vaults: vaults.filter(vault => !vault.retired) };
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
  chrome.tabs.onRemoved?.addListener(tabId => { selectedPasskeys.delete(tabId); queue.cancelTab(tabId); });
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.passkeysAllSites?.newValue === false) { selectedPasskeys.clear(); queue.cancelAll(); }
  });
  chrome.tabs.onUpdated?.addListener((tabId, change) => { if (change.url || change.status === 'loading') { selectedPasskeys.delete(tabId); queue.cancelTab(tabId); } });
  return queue;
}
