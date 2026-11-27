const $ = id => document.getElementById(id);
import { portalApi } from './portal-client.mjs';
const fragment = location.hash.slice(1);
// Pasting a new invitation into this tab changes only the fragment. Reload so
// the new bearer and current page/module version replace the previous view.
window.addEventListener('hashchange', () => {
  if (location.hash) location.reload();
});
const match = /^([a-f0-9]{64})\.([A-Za-z0-9_-]{43})$/.exec(fragment);
const selected = new URLSearchParams(location.search).get('request');
const requestId = match?.[1] ?? (/^[a-f0-9]{64}$/.test(selected ?? '') ? selected : null);
history.replaceState(null, '', !match && requestId ? `${location.pathname}?request=${requestId}` : location.pathname);
const base = requestId ? `/api/trials/${requestId}` : '';
import { renderPackages, renderInstallerCard } from './package-list.mjs';

const token = match?.[2]; // Memory only; reopen the email link after closing/reloading.
const status = value => { $('trial-status').textContent = value; };
async function api(action = '', value) {
  const response = await fetch(`${base}${action}`, { method: value === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: value === undefined ? undefined : JSON.stringify(value), cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Error(error.error === 'replacement_pending' ? 'Your replacement request is pending. Contact your inviter for the new license.' : error.error === 'license_expired' ? 'Your license has expired. Replacement cannot renew it.' : error.error === 'already_bound' ? 'This trial is already bound to another installation. Contact your inviter.'
      : error.error === 'licensed_major_unavailable' ? 'Downloads for your licensed major version are temporarily unavailable. Contact your inviter.'
        : 'This action is unavailable. Reopen your invitation email or contact your inviter.');
  }
  return response;
}
function showInstaller(record) {
  // Activation/replacement responses contain license state, without a catalogue.
  if (!Array.isArray(record.artifacts)) return;
  const available = !record.conversionInstallationId && record.artifacts.some(asset => asset.product === 'installer' && !asset.supporting);
  $('trial-installer').hidden = !available;
  $('trial-manual').open = !available;
  if (!available) return;
  $('trial-installer-command').textContent = '# Windows (PowerShell)\n.\\127vaults-install.exe\n\n# Linux\n./127vaults-install';
  $('copy-installer-invitation').hidden = false;
  $('trial-installer-command-help').textContent = 'Copy your setup link below, run the installer from the extracted folder, and paste the link when prompted. The link gives the installer access to your authorized downloads and license setup.';
}
$('copy-installer-invitation').addEventListener('click', async () => {
  if (!requestId) return;
  const notice = $('installer-invitation-status');
  let link;
  try {
    if (token) link = `${location.origin}/trial.html#${requestId}.${token}`;
    else {
      const result = await portalApi('installer-link', { requestId });
      link = result.link;
    }
    await navigator.clipboard.writeText(link);
    notice.textContent = 'Setup link copied. Paste it into the installer. Keep this link private.';
  } catch {
    if (link) {
      $('installer-setup-fallback').hidden = false;
      $('installer-setup-value').value = link;
      notice.textContent = 'Copy the setup link from the field above and paste it into the installer. Keep it private.';
    } else notice.textContent = 'Could not create a setup link. Sign in to Manage and open Downloads and license again.';
  }
});
function showLicense(record) {
  showInstaller(record);
  if (record.billingAvailable) {
    document.querySelector('.trial-main > .kicker').textContent = 'YOUR SELF-HOSTED SERVER';
    document.querySelector('.trial-main > h1').textContent = 'Set up 127 Vaults';
    document.querySelector('.trial-main > h1 + p').textContent = 'Install your private server and the apps you’ll use to connect to it.';
    $('trial-activate').querySelector('button').textContent = 'Activate my server license';
    $('bind-confirm').nextElementSibling.textContent = 'This is my server. Activation binds the license to this installation.';
  }
  if(record.kind === 'development') {
    document.querySelector('.trial-main > .kicker').textContent='DEVELOPMENT ACCESS';
    document.querySelector('.trial-main > h1').textContent='Your development installation.';
    document.querySelector('.trial-main > h1 + p').textContent='Approved development access through the standard signed-license and installer flow.';
    $('trial-activate').querySelector('button').textContent='Activate development license';
    $('bind-confirm').nextElementSibling.textContent='This is my development server. Activation binds the license to this installation without starting a trial.';
    $('trial-terms').textContent='Development access uses the displayed license expiry. Downloads and updates do not reset the expiry or change the server identity. Keep your backup key safe and separate from encrypted backups.';
  }
  const upgrading = Boolean(record.upgradeOfferedAt && record.installationId && !record.replacementCount && !record.replacementRequest);
  $('trial-upgrade').hidden = !upgrading;
  $('trial-prepare').hidden = Boolean(record.installationId || record.conversionInstallationId);
  $('trial-install').hidden = upgrading || Boolean(record.conversionInstallationId);
  $('trial-conversion').hidden = !record.conversionInstallationId;
  $('download-subscription').hidden = !record.installationId;
  if (record.conversionInstallationId) {
    $('trial-conversion').insertBefore($('trial-activate'), $('trial-conversion').querySelector('pre'));
    $('installation-id').value = record.conversionInstallationId;
    $('installation-id').readOnly = true;
  }
  $('trial-activate').hidden = Boolean(record.installationId);
  $('trial-license').hidden = !record.installationId;
  $('trial-recovery').hidden = !record.installationId;
  const expired = record.expiresAt && Date.now() >= Date.parse(record.expiresAt);
  $('replacement-request').hidden = record.personalTrial || Boolean(record.replacementRequest) || expired;
  if (record.personalTrial) {
    $('trial-activate').querySelector('button').textContent = 'Activate my 15-day trial';
    $('bind-confirm').nextElementSibling.textContent = 'Activation binds the license to this installation and starts your 15-day trial.';
    $('trial-terms').textContent = 'Writes stop after 15 days. Reads and exports remain available for 30 more days. Subscribe in Manage to keep using this installation.';
  }
  $('download-license').disabled = Boolean(record.replacementRequest);
  $('replacement-status').textContent = record.replacementRequest ? 'Replacement requested. Your inviter must issue the new license. The previous license is marked revoked; download and apply its revocation if the old server is reachable.' : expired ? 'This license has expired. Replacement does not renew it; contact your inviter.' : record.replacementCount ? 'Your replacement license is ready. Download it above and install it on the approved replacement server.' : '';
  $('download-replacement-revocation').hidden = !record.replacementRequest && !record.replacementCount;
  $('trial-dates').textContent = record.expiresAt
    ? `Bound to ${record.installationId}. Writes expire ${new Date(record.expiresAt).toLocaleString()}.`
    : record.kind === 'development'
      ? `Development access for up to ${record.maxUsers} vault users, licensed until ${new Date(record.entitlementExpiresAt).toLocaleString()}. Invitation available until ${new Date(record.linkExpiresAt).toLocaleString()}.`
      : record.personalPurchase ? `Paid Personal license for up to ${record.maxUsers} vault users. Bind it to your server during setup.`
      : record.personalTrial ? `Your 15-day Personal trial starts when you activate. Includes up to ${record.maxUsers} vault users.`
      : `Up to ${record.maxUsers} vault users. ${record.billingAvailable ? '' : 'The 10 days start when you activate. '}Invitation available until ${new Date(record.linkExpiresAt).toLocaleString()}.`;
}
async function download(action, filename) {
  const response = await api(action); const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function open() {
  if (!requestId) { status('Sign in to the customer portal or open the complete private invitation.'); return; }
  if (match) {
    const { establishInvitationSession } = await import('./portal-client.mjs');
    await establishInvitationSession(requestId, token).then(() => history.replaceState(null, '', `${location.pathname}?request=${requestId}`)).catch(() => {});
  }
  const record = await (await api()).json();
  if (record.billingAvailable) {
    const link = document.createElement('a');link.textContent = 'Manage subscription, invoices and payment methods';
    link.href = token ? `/billing#${requestId}.${token}` : `/billing?request=${requestId}`; link.className = 'button primary';
    $('trial-status').after(link);
    $('trial-terms').textContent = 'Your subscription license follows your confirmed paid period. Failed renewals stop writes, then allow 30 days for reads and exports. Your encrypted data is retained.';
  }
  $('trial-content').hidden = false;
  status(record.billingAvailable ? 'Your private access is ready. Manage your subscription below.' : 'Your private trial is ready. No payment is required.');
  $('trial-release').textContent = `Release source: ${record.sourceRevision}`;
  showInstaller(record);
  showLicense(record);
  const packages = [], supportingPackages = [], installerPackages = [];
  const supporting = document.createElement('details'); supporting.className = 'trial-disclosure trial-supporting';
  const supportingTitle = document.createElement('summary');
  const supportingCopy = document.createElement('span'); supportingCopy.className = 'trial-disclosure-copy';
  const supportingName = document.createElement('span'); supportingName.className = 'trial-disclosure-title'; supportingName.textContent = 'Verification files and package guides';
  const supportingDescription = document.createElement('span'); supportingDescription.className = 'trial-disclosure-description';
  supportingCopy.append(supportingName, supportingDescription); supportingTitle.append(supportingCopy);
  const supportingBody = document.createElement('div'); supportingBody.className = 'trial-disclosure-body';
  const supportingGrid = document.createElement('div'); supportingGrid.id = 'trial-supporting-artifacts';
  supportingBody.append(supportingGrid); supporting.append(supportingTitle, supportingBody);
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
    if (asset.product === 'installer' && !asset.supporting) {
      installerPackages.push(renderInstallerCard(asset, button));
    } else {
      card.append(heading, detail, checksum, button);
      if (asset.supporting) supportingPackages.push({ asset, card, button });
      else packages.push({ asset, card, button });
    }
  }
  $('trial-installer-artifacts').replaceChildren(...installerPackages);
  supportingDescription.textContent = `${supportingPackages.length} ${supportingPackages.length === 1 ? 'file' : 'files'} · Checksums, release manifests, and setup guides`;
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
  try { const record = await (await api('/activate', { installationId: $('installation-id').value.trim() })).json(); showLicense(record); status('License activated. Download and install it on your server.'); }
  catch (error) { status(error.message); }
  finally { button.disabled = false; }
});
$('download-license').addEventListener('click', () => download('/license', 'trial-license.json').catch(error => status(error.message)));
$('download-subscription').addEventListener('click', () => download('/subscription', 'subscription.json').catch(error => status(error.message)));
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
