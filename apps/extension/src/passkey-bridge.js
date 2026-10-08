// ISOLATED world. The browser, not the page, supplies sender/frame/origin data.
(() => {
  if (window.top !== window || globalThis.__127vaultsPasskeyBridge) return;
  globalThis.__127vaultsPasskeyBridge = true;
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || typeof event.data?.id !== 'string' || event.data.id.length > 64) return;
    const data = event.data;
    if (data.channel === '127vaults.passkey.cancel') {
      await chrome.runtime.sendMessage({ kind: 'passkey.cancel', id: data.id }).catch(() => {});
      return;
    }
    if (data.channel !== '127vaults.passkey.request') return;
    if (JSON.stringify(data).length > 20000) return;
    let response;
    try { response = await chrome.runtime.sendMessage({ kind: 'passkey.request', id: data.id, operation: data.operation, options: data.options }); }
    catch { response = { error: '127Vaults disconnected. Reopen the extension and try again.' }; }
    // Explicit fields prevent accidental propagation of vault/private material.
    window.postMessage({ channel: '127vaults.passkey.response', id: data.id, value: response?.value, error: response?.error, useBrowser: response?.useBrowser === true }, location.origin);
  });
})();
