// Native Windows integration is retained but disabled until deployment is ready.
export const WINDOWS_NATIVE_PASSKEYS_ENABLED = false;
export async function windowsNativeOnly(api) {
  return WINDOWS_NATIVE_PASSKEYS_ENABLED && (await api.runtime?.getPlatformInfo?.())?.os === 'win';
}
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
  if (await windowsNativeOnly(api)) throw Error('Passkeys on Windows are managed by 127Vaults Desktop through the Windows picker.');
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

// Storage can survive an unpacked reload even when dynamic registrations do not.
// Restore only already-authorized scripts; never request permission on startup.
export async function restorePasskeyScripts(api) {
  if (await windowsNativeOnly(api)) { await disableAllPasskeys(api); return false; }
  const settings = await api.storage.local.get(['passkeysAllSites', 'passkeyOrigins']);
  const matches = settings.passkeysAllSites === true ? [PASSKEY_MATCH] : (settings.passkeyOrigins || []).filter(origin => passkeysEnabled(settings, origin)).map(origin => 'https://' + new URL(origin).hostname + '/*');
  if (!matches.length || !(await api.permissions.contains({ origins: matches }))) return false;
  const scripts = await api.scripting.getRegisteredContentScripts();
  const wanted = [
    { id: IDS[0], matches, js: ['src/passkey-bridge.js'], runAt: 'document_start', world: 'ISOLATED', allFrames: false },
    { id: IDS[1], matches, js: ['src/passkey-page.js'], runAt: 'document_start', world: 'MAIN', allFrames: false },
  ];
  if (wanted.every(script => scripts.some(existing => existing.id === script.id && existing.world === script.world && JSON.stringify(existing.matches) === JSON.stringify(matches)))) return true;
  await clearProviderScripts(api);
  await api.scripting.registerContentScripts(wanted);
  return true;
}
