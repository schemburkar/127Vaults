const $ = id => document.getElementById(id);
const fragment = location.hash.slice(1);
const reviewRequested = new URLSearchParams(location.search).get('review') === '1';
// Pasting a new invitation into this tab changes only the fragment. Reload so
// the new bearer and current page/module version replace the previous view.
window.addEventListener('hashchange', () => {
  if (location.hash) location.reload();
});
const match = /^([a-f0-9]{64})\.([A-Za-z0-9_-]{43})$/.exec(fragment);
const operatorReview = reviewRequested && !match;
history.replaceState(null, '', operatorReview ? `${location.pathname}?review=1` : location.pathname);
const base = operatorReview ? '/api/access-admin/releases' : match ? `/api/trials/${match[1]}` : '';
const productNames = { server: 'Server', desktop: 'Desktop', cli: 'CLI', extension: 'Browser extension' };

function describe(asset) {
  const parts = (asset.label || '').split(' / ');
  const product = asset.product || parts[0] || 'Other';
  const platform = asset.platform || parts[1] || 'Other';
  const os = /^win/i.test(platform) ? 'Windows' : /^linux/i.test(platform) ? 'Linux'
    : /^(mac|darwin)/i.test(platform) ? 'macOS' : /extension|browser|chrome|edge/i.test(`${platform} ${product}`) ? 'Cross-platform browsers' : platform;
  return { os, app: productNames[product] || product, platform };
}

function renderPackages(container, packages, layout) {
  const doc = container.ownerDocument;
  const make = (tag, value, className) => {
    const node = doc.createElement(tag);
    if (value !== undefined) node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  container.replaceChildren();
  container.className = layout === 'cards' ? 'trial-grid' : 'trial-table-wrap';
  if (layout === 'cards') {
    for (const { card, button } of packages) { card.append(button); container.append(card); }
    return;
  }
  const table = make('table', undefined, 'trial-package-table');
  table.append(make('caption', 'Downloads grouped by operating system and app type'));
  const head = make('thead'), headings = make('tr');
  for (const title of ['App type', 'Package', 'Size', 'Verification', 'Download']) {
    const th = make('th', title); th.scope = 'col'; headings.append(th);
  }
  head.append(headings); table.append(head);
  const groups = new Map();
  for (const entry of packages) {
    const info = describe(entry.asset);
    if (!groups.has(info.os)) groups.set(info.os, []);
    groups.get(info.os).push({ ...entry, info });
  }
  const order = ['Windows', 'Linux', 'macOS', 'Cross-platform browsers'];
  const rank = os => order.includes(os) ? order.indexOf(os) : order.length;
  for (const [os, entries] of [...groups].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))) {
    const body = make('tbody'), group = make('tr'), title = make('th', os);
    title.colSpan = 5; title.scope = 'rowgroup'; group.className = 'trial-os-group'; group.append(title); body.append(group);
    entries.sort((a, b) => a.info.app.localeCompare(b.info.app) || a.asset.filename.localeCompare(b.asset.filename));
    for (const { asset, info, button } of entries) {
      const row = make('tr'), app = make('th', info.app); app.scope = 'row'; row.append(app);
      const file = make('td'); file.append(make('span', asset.filename), make('small', info.platform)); row.append(file);
      row.append(make('td', `${(asset.sizeBytes / 1048576).toFixed(1)} MB`));
      const hash = make('td'), details = make('details'); details.append(make('summary', 'SHA-256'), make('code', asset.sha256)); hash.append(details); row.append(hash);
      const action = make('td'); action.append(button); row.append(action); body.append(row);
      button.setAttribute('aria-label', `Download ${asset.filename}`);
    }
    table.append(body);
  }
  container.append(table);
}

const token = match?.[2]; // Memory only; reopen the email link after closing/reloading.
const status = value => { $('trial-status').textContent = value; };
async function api(action = '', value) {
  const response = await fetch(`${base}${action}`, { method: value === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: value === undefined ? undefined : JSON.stringify(value), cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) {
    if (operatorReview && response.status === 401) throw Error('Sign in on the request page, then review releases again.');
    const error = await response.json().catch(() => ({}));
    throw Error(error.error === 'replacement_pending' ? 'Your replacement request is pending. Contact your inviter for the new license.' : error.error === 'license_expired' ? 'Your license has expired. Replacement cannot renew it.' : error.error === 'already_bound' ? 'This trial is already bound to another installation. Contact your inviter.'
      : error.error === 'licensed_major_unavailable' ? 'Downloads for your licensed major version are temporarily unavailable. Contact your inviter.'
        : 'This action is unavailable. Reopen your invitation email or contact your inviter.');
  }
  return response;
}
function showLicense(record) {
  const upgrading = Boolean(record.upgradeOfferedAt && record.installationId && !record.replacementCount && !record.replacementRequest);
  $('trial-upgrade').hidden = !upgrading;
  $('trial-prepare').hidden = Boolean(record.installationId);
  $('trial-install').hidden = upgrading;
  $('trial-activate').hidden = Boolean(record.installationId);
  $('trial-license').hidden = !record.installationId;
  $('trial-recovery').hidden = !record.installationId;
  const expired = record.expiresAt && Date.now() >= Date.parse(record.expiresAt);
  $('replacement-request').hidden = Boolean(record.replacementRequest) || expired;
  $('download-license').disabled = Boolean(record.replacementRequest);
  $('replacement-status').textContent = record.replacementRequest ? 'Replacement requested. Your inviter must issue the new license. The previous license is marked revoked; download and apply its revocation if the old server is reachable.' : expired ? 'This license has expired. Replacement does not renew it; contact your inviter.' : record.replacementCount ? 'Your replacement license is ready. Download it above and install it on the approved replacement server.' : '';
  $('download-replacement-revocation').hidden = !record.replacementRequest && !record.replacementCount;
  $('trial-dates').textContent = record.expiresAt
    ? `Bound to ${record.installationId}. Writes expire ${new Date(record.expiresAt).toLocaleString()}.`
    : `Up to ${record.maxUsers} vault users. The 10 days start when you activate. Invitation available until ${new Date(record.linkExpiresAt).toLocaleString()}.`;
}
async function download(action, filename) {
  const response = await api(action); const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function open() {
  if (!match && !operatorReview) { status('Open the complete private link from your invitation email.'); return; }
  const record = await (await api()).json();
  $('trial-content').hidden = false;
  status(operatorReview ? 'Operator session verified. Current packages are ready to review and download.' : 'Your private trial is ready. No payment is required.');
  $('trial-release').textContent = `Release source: ${record.sourceRevision}`;
  if (operatorReview) {
    document.title = 'Review releases - 127 Vaults';
    document.querySelector('#main h1').textContent = 'Review releases';
    document.querySelector('#main .kicker').textContent = 'OPERATOR ACCESS';
    document.querySelector('#main > p').textContent = 'Review and download current packages using your operator session.';
    for (const id of ['trial-prepare', 'trial-install', 'trial-upgrade', 'trial-recovery']) $(id).hidden = true;
    const back = document.createElement('a'); back.href = '/access-admin'; back.textContent = 'Back to requests'; $('trial-status').after(back);
  } else showLicense(record);
  const packages = [], supportingPackages = [];
  const supporting = document.createElement('details');
  const supportingTitle = document.createElement('summary'); supportingTitle.textContent = 'Verification files and package guides';
  const supportingGrid = document.createElement('div'); supportingGrid.id = 'trial-supporting-artifacts';
  supporting.append(supportingTitle, supportingGrid);
  for (const asset of record.artifacts) {
    const card = document.createElement('article'); card.className = 'trial-artifact';
    const heading = document.createElement('h3'); heading.textContent = asset.label;
    const detail = document.createElement('p'); detail.textContent = `${asset.filename} · ${(asset.sizeBytes / 1048576).toFixed(1)} MB`;
    const checksum = document.createElement('code'); checksum.textContent = `SHA-256: ${asset.sha256}`;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button primary'; button.textContent = 'Download';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (!operatorReview) await api('/ticket', {});
        // A scoped HttpOnly cookie allows a streamed browser download without a token in the URL.
        const a = document.createElement('a'); a.href = `${base}/artifacts/${asset.id}`; a.download = asset.filename; a.click();
        status('Download requested. Verify its SHA-256 before installation; check browser downloads for completion.');
      } catch (error) { status(error.message); }
      finally { button.disabled = false; }
    });
    card.append(heading, detail, checksum, button);
    if (asset.supporting) supportingPackages.push({ asset, card, button });
    else packages.push({ asset, card, button });
  }
  let layout = 'table';
  const drawPackages = () => {
    renderPackages($('trial-artifacts'), packages, layout);
    if (supportingPackages.length) renderPackages(supportingGrid, supportingPackages, layout);
    for (const view of ['table', 'cards']) $(`trial-layout-${view}`).setAttribute('aria-pressed', String(layout === view));
  };
  for (const view of ['table', 'cards']) $(`trial-layout-${view}`).addEventListener('click', () => { layout = view; drawPackages(); });
  drawPackages();
  if (supportingPackages.length) $('trial-artifacts').after(supporting);
}
$('trial-activate').addEventListener('submit', async event => {
  event.preventDefault(); if (!$('trial-activate').reportValidity()) return;
  const button = $('trial-activate').querySelector('button'); button.disabled = true;
  try { const record = await (await api('/activate', { installationId: $('installation-id').value.trim() })).json(); showLicense(record); status('Trial activated. Download and install your license on the server.'); }
  catch (error) { status(error.message); }
  finally { button.disabled = false; }
});
$('download-license').addEventListener('click', () => download('/license', 'trial-license.json').catch(error => status(error.message)));
$('download-keys').addEventListener('click', () => download('/public-keys', 'trial-issuer-keys.json').catch(error => status(error.message)));
open().catch(error => status(error.message));

$('replacement-request').addEventListener('submit', async event => {
  event.preventDefault(); if (!$('replacement-request').reportValidity()) return;
  const button = $('replacement-request').querySelector('button'); button.disabled = true;
  try {
    const record = await (await api('/replacement-request', { installationId: $('replacement-id').value.trim(),
      reason: $('replacement-reason').value.trim(), retired: $('replacement-retired').checked })).json();
    showLicense(record); status('Replacement requested. Contact your inviter to issue the new license.');
  } catch (error) { status(error.message); } finally { button.disabled = false; }
});
$('download-replacement-revocation').addEventListener('click', () => download('/replacement-revocation', 'replaced-license-revocation.json').catch(error => status(error.message)));
