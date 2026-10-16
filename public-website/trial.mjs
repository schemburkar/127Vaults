const $ = id => document.getElementById(id);
const fragment = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const match = /^([a-f0-9]{64})\.([A-Za-z0-9_-]{43})$/.exec(fragment);
const base = match ? `/api/trials/${match[1]}` : '';
const token = match?.[2]; // Memory only; reopen the email link after closing/reloading.
const status = value => { $('trial-status').textContent = value; };
async function api(action = '', value) {
  const response = await fetch(`${base}${action}`, { method: value === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: value === undefined ? undefined : JSON.stringify(value), cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Error(error.error === 'already_bound' ? 'This trial is already bound to another installation. Contact your inviter.'
      : error.error === 'release_changed_contact_operator' ? 'The selected release has changed. Contact your inviter for an updated invitation.'
        : 'This action is unavailable. Reopen your invitation email or contact your inviter.');
  }
  return response;
}
function showLicense(record) {
  $('trial-activate').hidden = Boolean(record.installationId);
  $('trial-license').hidden = !record.installationId;
  $('trial-dates').textContent = record.expiresAt
    ? `Bound to ${record.installationId}. Writes expire ${new Date(record.expiresAt).toLocaleString()}.`
    : `Up to ${record.maxUsers} vault users. The 10 days start when you activate. Invitation available until ${new Date(record.linkExpiresAt).toLocaleString()}.`;
}
async function download(action, filename) {
  const response = await api(action); const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function open() {
  if (!match) { status('Open the complete private link from your invitation email.'); return; }
  const record = await (await api()).json();
  $('trial-content').hidden = false; status('Your private trial is ready. No payment is required.');
  $('trial-release').textContent = `Release source: ${record.sourceRevision}`;
  showLicense(record);
  const supporting = document.createElement('details');
  const supportingTitle = document.createElement('summary'); supportingTitle.textContent = 'Verification files and package guides';
  const supportingGrid = document.createElement('div'); supportingGrid.className = 'trial-grid';
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
        await api('/ticket', {});
        // A scoped HttpOnly cookie allows a streamed browser download without a token in the URL.
        const a = document.createElement('a'); a.href = `${base}/artifacts/${asset.id}`; a.download = asset.filename; a.click();
        status('Download requested. Verify its SHA-256 before installation; check browser downloads for completion.');
      } catch (error) { status(error.message); }
      finally { button.disabled = false; }
    });
    card.append(heading, detail, checksum, button);
    (asset.supporting ? supportingGrid : $('trial-artifacts')).append(card);
  }
  if (supportingGrid.childElementCount) $('trial-artifacts').after(supporting);
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
