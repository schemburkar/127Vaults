export const PASSKEY_MATCH = 'https://*/*';
const IDS = ['passkey-bridge-all', 'passkey-page-all'];
export function passkeysEnabled(settings, origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin &&
      (settings.passkeysAllSites === true || settings.passkeyOrigins?.includes(origin) === true);
  } catch { return false; }
}
async function clearProviderScripts(api) {
  const scripts = await api.scripting.getRegisteredContentScripts();
  const ids = scripts.filter(script => /^passkey-(bridge|page)-/.test(script.id)).map(script => script.id);
  if (ids.length) await api.scripting.unregisterContentScripts({ ids });
}
export async function enableAllPasskeys(api) {
  if (!(await api.permissions.request({ origins: [PASSKEY_MATCH] }))) throw Error('Permission for HTTPS sites was not granted.');
  await clearProviderScripts(api);
  await api.scripting.registerContentScripts([
    { id: IDS[0], matches: [PASSKEY_MATCH], js: ['src/passkey-bridge.js'], runAt: 'document_start', world: 'ISOLATED', allFrames: false },
    { id: IDS[1], matches: [PASSKEY_MATCH], js: ['src/passkey-page.js'], runAt: 'document_start', world: 'MAIN', allFrames: false },
  ]);
  await api.storage.local.set({ passkeysAllSites: true, passkeyOrigins: [] });
}
export async function disableAllPasskeys(api) {
  // Preserve the shared vault connection permission. Disabling removes provider
  // scripts and authorization; browser extension settings can revoke site access.
  await api.storage.local.set({ passkeysAllSites: false, passkeyOrigins: [] });
  await clearProviderScripts(api);
}
