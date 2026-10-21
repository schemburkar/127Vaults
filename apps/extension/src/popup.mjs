import { matchingLogin, originOf, permissionPattern } from './match.mjs';
import { probeFrame, fillFrame } from './fill.mjs';
import { sourceStatus } from './source-status.mjs';
import { findUnlockedVaultTab } from './vault-tab.mjs';
import { setupPasskeyPopup } from './popup-passkeys.mjs';

const $ = id => document.getElementById(id);
let vaultOrigin = null;
let targetTab = null;
let vaultTab = null;
let vaultId = null;
let items = [], savedPasskeyEntries = [];
let pending = false;
let selectedSource = null;
let localSources = [];
let sourceSignature = '';
let refreshInProgress = false;
let userSelectedSource = false;
let sourceLoadRevision = 0;
const passkeys = setupPasskeyPopup({ getTab: () => targetTab, getSource: () => selectedSource, status, onSavedPasskeys: entries => { savedPasskeyEntries = entries; renderItems(); }, listSavedPasskeys: async origin => {
  if (selectedSource !== 'web') return native({ action: 'passkey.list', source: selectedSource, siteOrigin: origin });
  if (!vaultTab?.id) return [];
  return (await script(vaultTab.id, site => window.__vaultsExtensionActions?.passkeyList(site), [origin], {}, 'MAIN'))[0]?.result || [];
} });

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function errorMessage(error) {
  const code = String(error?.message || error);
  if (/Cannot access|permission|not allowed to access/i.test(code)) return 'Browser access to the vault tab was denied. Use Web connection to grant access to its HTTPS address, then refresh.';
  return code.replace(/_/g, ' ').slice(0, 150);
}
async function script(tabId, func, args = [], extra = {}, world = 'ISOLATED') {
  return chrome.scripting.executeScript({ target: { tabId, ...extra }, world, func, args });
}
async function configuredOrigin() {
  const stored = await chrome.storage.local.get('vaultOrigin');
  return originOf(stored.vaultOrigin);
}
async function native(request) {
  const response = await chrome.runtime.sendMessage({ kind: 'connector.request', request });
  if (!response?.ok) throw Error(response?.error || 'local connector is unavailable');
  return response.value;
}
function renderItems() {
  const query = $('search').value.trim().toLowerCase();
  const matching = items.filter(item => matchingLogin(item.website, targetTab.url) && `${item.title} ${item.username || ''} ${item.website}`.toLowerCase().includes(query));
  $('items').replaceChildren();
  for (const item of matching) {
    const button = document.createElement('button');
    button.className = 'item';
    button.type = 'button';
    button.setAttribute('aria-label', `Fill ${item.title} on this site`);
    const title = document.createElement('span');
    title.textContent = item.title;
    const action = document.createElement('span');
    action.className = 'item-action';
    action.textContent = 'Fill';
    const heading = document.createElement('span');
    heading.className = 'item-heading';
    heading.append(title, action);
    const site = document.createElement('small');
    site.textContent = item.username || item.website;
    button.append(heading, site);
    button.onclick = () => choose(item);
    $('items').append(button);
  }
  const matchingPasskeys = savedPasskeyEntries.filter(entry => `${entry.title} ${entry.metadata.username} ${entry.metadata.displayName} ${entry.metadata.rpId}`.toLowerCase().includes(query));
  for (const entry of matchingPasskeys) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'item';
    button.setAttribute('aria-label', `Select passkey for ${entry.metadata.displayName || entry.metadata.username || entry.metadata.rpId}`);
    const heading = document.createElement('span'); heading.className = 'item-heading';
    const title = document.createElement('span'); title.textContent = entry.metadata.displayName || entry.metadata.username || entry.metadata.rpId;
    const action = document.createElement('span'); action.className = 'item-action'; action.textContent = 'Passkey'; heading.append(title, action);
    const detail = document.createElement('small'); detail.textContent = [entry.metadata.rpId, entry.vaultName, entry.sync?.pending ? 'Waiting to sync' : entry.sync?.pending === false ? 'Synced' : ''].filter(Boolean).join(' · ');
    button.append(heading, detail); button.onclick = () => passkeys.selectSaved(entry).catch(error => status(errorMessage(error), true)); $('items').append(button);
  }
  status(matching.length || matchingPasskeys.length ? '' : query ? 'No matching sign-ins.' : 'No sign-ins saved for this site.');
}
async function findVaultTab() {
  const tabs = await chrome.tabs.query({});
  return findUnlockedVaultTab(tabs, vaultOrigin, targetTab.id, async id => {
      return (await script(id, () => {
        const actions = window.__vaultsExtensionActions;
        return actions?.status ? actions.status() : actions?.list ? actions.list(location.origin) : null;
      }, [], {}, 'MAIN'))[0]?.result;
  });
}
function licenseNotice(license) {
  if (!license) return '';
  if (license.mode === 'missing') return ' A signed license is required. Ask your server operator.';
  if (license.mode === 'read-only') return ' License expired: server writes are blocked during the 30-day read-only period. Existing logins may still be filled.';
  if (license.mode === 'revoked') return ' License revoked: vault access is blocked. Ask your operator for a replacement license.';
  if (license.mode === 'locked') return ' License locked: vault access is blocked. Ask your operator for a trial or renewed license.';
  return license.expiresAt ? ` License active until ${license.expiresAt.slice(0, 10)}.` : '';
}
async function loadSelectedSource() {
  const revision = ++sourceLoadRevision, sourceId = $('source-select').value;
  const current = () => revision === sourceLoadRevision && selectedSource === sourceId;
  $('results').hidden = true;
  $('native-unlock').hidden = true;
  $('lock-vault').hidden = true;
  selectedSource = sourceId;
  try {
  const source = localSources.find(row => row.id === selectedSource);
  const license = source?.license;
  $('source-state').textContent = selectedSource === 'web' ? 'Web tab session; requires the web app to be open and unlocked.'
    : `${sourceStatus(source)}${licenseNotice(license)}${source?.online === false && selectedSource !== 'desktop' ? ' Offline license status may be stale.' : ''}`;
  $('open-vault').hidden = selectedSource !== 'web' || !vaultOrigin;
  items = []; savedPasskeyEntries = [];
  if (selectedSource !== 'web') {
    try {
      const listed = await native({ action: 'list', source: selectedSource, siteOrigin: originOf(targetTab.url) });
      if (!current()) return;
      items = Array.isArray(listed) ? listed : [];
      $('results').hidden = false;
      $('lock-vault').hidden = false;
      renderItems();
      await passkeys.refreshSaved();
    } catch (error) {
      if (!current()) return;
      if (source?.active || source?.localUnlocked) {
        status(`Could not read ${selectedSource} logins: ${errorMessage(error)} Refresh or lock and unlock the client.`, true);
      } else {
        $('native-unlock').hidden = false;
        status(`Open and unlock the ${selectedSource} client to connect.`);
      }
    }
    return;
  }
  const allowed = vaultOrigin && await chrome.permissions.contains({ origins: [permissionPattern(vaultOrigin)] });
  if (!current()) return;
  if (!allowed) {
    $('setup').hidden = false;
    status('Connect your vault web address.');
    return;
  }
  const found = await findVaultTab();
  if (!current()) return;
  vaultTab = found;
  if (!vaultTab) { status('Open and unlock the vault web tab, or choose a local source.'); return; }
  try {
    const license = (await script(vaultTab.id, async () => {
      const response = await fetch('/api/v1/license', { credentials: 'same-origin' });
      return response.ok ? response.json() : null;
    }, [], {}, 'MAIN'))[0]?.result;
    if (!current()) return;
    $('source-state').textContent += licenseNotice(license);
  } catch { /* Older server or unavailable status. */ }
  const result = (await script(vaultTab.id, site => window.__vaultsExtensionActions?.list(site), [originOf(targetTab.url)], {}, 'MAIN'))[0]?.result;
  if (!current()) return;
  if (!result || result.locked) { status('Unlock the vault web tab, or choose a local source.'); return; }
  vaultId = result.vaultId;
  items = Array.isArray(result.items) ? result.items : [];
  $('results').hidden = false;
  $('lock-vault').hidden = false;
  renderItems();
  await passkeys.refreshSaved();
  } catch (error) { if (current()) throw error; }
}
async function refresh() {
  if (refreshInProgress || pending) return;
  refreshInProgress = true;
  sourceLoadRevision++;
  const previousSource = $('source-select').value;
  try {
  $('setup').hidden = true;
  $('results').hidden = true;
  $('frames').hidden = true;
  $('lock-vault').hidden = true;
  $('source-panel').hidden = true;
  $('source-select').hidden = true;
  $('refresh-sources').hidden = true;
  $('open-vault').hidden = true;
  targetTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!targetTab?.id || !originOf(targetTab.url)) {
    status('Open a secure website login page, then click 127Vaults.', true);
    return;
  }
  $('site').textContent = new URL(targetTab.url).host;
  vaultOrigin = await configuredOrigin();
  let connectorError = null;
  try { localSources = (await native({ action: 'sources' })).sources || []; }
  catch (error) { localSources = []; connectorError = error; }
  sourceSignature = JSON.stringify(localSources.map(source => [source.id, source.configured, source.active, source.localUnlocked, source.online]));
  const options = localSources.filter(source => source.configured).map(source => ({
    id: source.id, label: `${source.id === 'desktop' ? '▣ Desktop' : '⌘ CLI'}${source.active || source.localUnlocked ? '' : ' · locked'}`,
    preferred: source.active || source.localUnlocked,
  }));
  if (vaultOrigin) options.push({ id: 'web', label: '◉ Web tab', preferred: false });
  $('source-select').replaceChildren();
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option.id;
    element.textContent = option.label;
    $('source-select').append(element);
  }
  if (!options.length) {
    $('setup').hidden = false;
    status(connectorError
      ? 'Local connector unavailable. Check native-host registration, or connect an unlocked web tab.'
      : 'No enrolled local client found. Unlock desktop or CLI, then refresh; or connect an unlocked web tab.');
    return;
  }
  $('source-panel').hidden = false;
  $('source-select').hidden = false;
  $('refresh-sources').hidden = false;
  $('source-select').value = userSelectedSource && options.some(option => option.id === previousSource) ? previousSource
    : options.find(option => option.preferred)?.id || options.find(option => option.id === 'web')?.id || options[0].id;
  await loadSelectedSource();
  } finally { refreshInProgress = false; await passkeys.refresh().catch(error => status(errorMessage(error), true)); }
}
async function choose(item) {
  if (pending) return;
  pending = true;
  $('frames').hidden = true;
  try {
    status('Checking the page and login fields…');
    const fresh = await chrome.tabs.get(targetTab.id);
    if (!matchingLogin(item.website, fresh.url) || fresh.id !== targetTab.id) throw Error('The page changed. Reopen 127Vaults on the intended login page.');
    const origin = originOf(fresh.url);
    const probes = await script(targetTab.id, probeFrame, [origin], { allFrames: true });
    const candidates = probes.filter(row => row.result?.eligible && row.result.frameOrigin === origin);
    if (!candidates.length) {
      const rejected = probes.find(row => row.result?.frameOrigin === origin && row.result?.reason);
      throw Error(rejected?.result.reason || 'No usable login fields were found on this page.');
    }
    const fill = async frameId => {
      const latest = await chrome.tabs.get(targetTab.id);
      if (!matchingLogin(item.website, latest.url)) throw Error('The page changed before fill.');
      status('Decrypting the selected login…');
      const credential = selectedSource === 'web'
        ? (await script(vaultTab.id, async (id, selectedVault, entryId, site) => window.__vaultsExtensionActions?.credential(id, selectedVault, entryId, site), [item.itemId, vaultId, item.entryId || '', origin], {}, 'MAIN'))[0]?.result
        : await native({ action: 'get', source: selectedSource, vaultId: item.vaultId, itemId: item.itemId, entryId: item.entryId || '', siteOrigin: origin });
      if (!credential || !matchingLogin(credential.website, latest.url) || credential.itemId !== item.itemId || (credential.entryId || '') !== (item.entryId || '')) throw Error('The vault or selected login changed.');
      const filled = (await script(targetTab.id, fillFrame, [origin, { username: credential.username, password: credential.password }], { frameIds: [frameId] }))[0]?.result;
      if (!filled?.ok) throw Error(filled?.reason || 'The page did not accept the fill.');
      status('');
      $('frames').hidden = true;
      window.close();
    };
    if (candidates.length === 1) await fill(candidates[0].frameId);
    else {
      $('frames').replaceChildren();
      const note = document.createElement('p');
      note.textContent = 'Choose the same-site frame containing the login form:';
      $('frames').append(note);
      for (const candidate of candidates) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = candidate.frameId === 0 ? 'Main page' : `Frame ${candidate.frameId}${candidate.result.focused ? ' (focused)' : ''}`;
        button.onclick = () => fill(candidate.frameId).catch(error => status(errorMessage(error), true));
        $('frames').append(button);
      }
      $('frames').hidden = false;
      status('Several login forms were found. Choose the correct frame.');
    }
  } catch (error) { status(errorMessage(error), true); }
  finally { pending = false; }
}

$('connect').onclick = async () => {
  const origin = originOf($('vault-url').value);
  if (!origin) { status('Enter the HTTPS address of your 127Vaults web app.', true); return; }
  try {
    const granted = await chrome.permissions.request({ origins: [permissionPattern(origin)] });
    if (!granted) { status('Vault access was not granted.', true); return; }
    const previous = await configuredOrigin();
    await chrome.storage.local.set({ vaultOrigin: origin });
    const { passkeyOrigins = [], passkeysAllSites = false } = await chrome.storage.local.get(["passkeyOrigins", "passkeysAllSites"]);
    if (previous && previous !== origin && permissionPattern(previous) !== permissionPattern(origin) && !passkeysAllSites && !passkeyOrigins.some(site => permissionPattern(site) === permissionPattern(previous))) {
      await chrome.permissions.remove({ origins: [permissionPattern(previous)] });
    }
    await refresh();
  } catch (error) { status(errorMessage(error), true); }
};
$('source-select').onchange = () => { userSelectedSource = true; loadSelectedSource().then(() => passkeys.refresh(true)).catch(error => status(errorMessage(error), true)); };
$('refresh-sources').onclick = () => refresh().catch(error => status(errorMessage(error), true));
$('refresh-setup').onclick = () => refresh().catch(error => status(errorMessage(error), true));
$('settings').onclick = () => {
  $('setup').hidden = false;
  $('vault-url').value = vaultOrigin || '';
  status('Web-tab connection is optional when desktop or CLI is available.');
};
$('open-vault').onclick = async () => {
  const origin = vaultOrigin || originOf($('vault-url').value);
  if (!origin) { $('setup').hidden = false; status('Enter your vault address first.', true); return; }
  await chrome.tabs.create({ url: origin });
};
$('lock-vault').onclick = async () => {
  try {
    if (selectedSource === 'web') {
      if (!vaultTab?.id) return;
      await script(vaultTab.id, () => window.__vaultsExtensionActions?.lock(), [], {}, 'MAIN');
    } else await native({ action: 'lock', source: selectedSource });
    items = []; savedPasskeyEntries = [];
    $('results').hidden = true;
    $('lock-vault').hidden = true;
    status('Connector locked. Unlock the source before filling again.');
    await passkeys.refresh();
  } catch (error) { status(errorMessage(error), true); }
};
async function refreshLocalItems() {
  const source = selectedSource, revision = sourceLoadRevision;
  if (!['desktop', 'cli'].includes(source) || !$('frames').hidden || pending) return;
  const listed = await native({ action: 'list', source, siteOrigin: originOf(targetTab.url) });
  if (source !== selectedSource || revision !== sourceLoadRevision || pending || !$('frames').hidden || document.hidden) return;
  const next = Array.isArray(listed) ? listed : [];
  if (JSON.stringify(next) !== JSON.stringify(items)) {
    items = next;
    renderItems();
  }
}

$('search').oninput = renderItems;
refresh().catch(error => status(errorMessage(error), true));
let pollingSources = false;
setInterval(async () => {
  if (document.hidden || pending || refreshInProgress || pollingSources || !$('frames').hidden) return;
  pollingSources = true;
  try {
    await passkeys.refresh();
    await passkeys.refreshSaved();
    const sources = (await native({ action: 'sources' })).sources || [];
    const next = JSON.stringify(sources.map(source => [source.id, source.configured, source.active, source.localUnlocked, source.online]));
    if (next !== sourceSignature) await refresh();
    else await refreshLocalItems();
  } catch { /* Manual refresh reports connector errors without interrupting the current form. */ }
  finally { pollingSources = false; }
}, 3000);
