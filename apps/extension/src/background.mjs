import { restorePasskeyScripts } from './passkey-settings.mjs';
import { originOf, permissionPattern } from './match.mjs';
import { installPasskeyProvider } from './passkey-provider.mjs';

let nativePort = null;
let nextNativeId = 1;
const nativePending = new Map();

function nativeRequest(value) {
  if (!nativePort) {
    nativePort = chrome.runtime.connectNative('com.127vaults.connector');
    nativePort.onMessage.addListener(response => {
      const pending = nativePending.get(response?.id);
      if (!pending) return;
      nativePending.delete(response.id);
      if (response.ok) pending.resolve(response.value);
      else pending.reject(Error(String(response.value || 'local connector failed')));
    });
    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || 'local connector disconnected';
      nativePort = null;
      for (const pending of nativePending.values()) pending.reject(Error(error));
      nativePending.clear();
    });
  }
  const id = nextNativeId++;
  return new Promise((resolve, reject) => {
    nativePending.set(id, { resolve, reject });
    try { nativePort.postMessage({ ...value, id }); }
    catch (error) { nativePending.delete(id); reject(error); }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message?.kind !== 'connector.request') return;
  if (message.request?.action === 'lock') passkeyQueue.cancelAll();
  nativeRequest(message.request).then(value => sendResponse({ ok: true, value }), error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
const passkeyQueue = installPasskeyProvider(nativeRequest);

async function lockOpenVaultTabs() {
  const { vaultOrigin } = await chrome.storage.local.get('vaultOrigin');
  const origin = originOf(vaultOrigin);
  if (!origin || !(await chrome.permissions.contains({ origins: [permissionPattern(origin)] }))) return;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || originOf(tab.url) !== origin) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => window.__vaultsExtensionActions?.lock(),
      });
    } catch {
      // A tab can navigate or close while the OS lock event is being handled.
    }
  }
}

chrome.idle.setDetectionInterval(30 * 60);
chrome.idle.onStateChanged.addListener(state => {
  if (state === 'locked' || state === 'idle') {
    passkeyQueue.cancelAll();
    return Promise.allSettled([
      nativeRequest({ action: 'lock', source: 'desktop' }),
      nativeRequest({ action: 'lock', source: 'cli' }),
      lockOpenVaultTabs(),
    ]).finally(() => { nativePort?.disconnect(); nativePort = null; });
  }
});

restorePasskeyScripts(chrome).catch(error => console.error('Passkey script registration failed:', error));
