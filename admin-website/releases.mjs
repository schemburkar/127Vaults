import { adminReady, adminFetch } from './admin-shell.mjs';
import { renderPackages, renderInstallerCard, layoutToggle } from './package-list.mjs';
const status = document.getElementById('release-status');
async function open() {
  const response = await adminFetch('/api/access-admin/releases', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw Error(response.status === 401 ? 'Sign in on the access requests page, then return to review releases.' : 'Release review is temporarily unavailable.');
  const record = await response.json();
  status.textContent = `Current release: ${record.sourceRevision}`;
  const root = document.getElementById('release-downloads'); root.replaceChildren();
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const installers = make('section', undefined, 'access-card trial-recommended');
  installers.append(make('span', 'Setup installers', 'trial-section-label'), make('h2', 'Review the installer downloads.'),
    make('p', 'The same Windows and Linux installers offered through customer invitations.', 'trial-section-intro'));
  const installerGrid = make('div', undefined, 'trial-installer-grid'); installers.append(installerGrid);
  const manual = make('section', undefined, 'access-card');
  const heading = make('div', undefined, 'trial-package-heading'); heading.append(make('h2', 'Individual packages'));
  const packages = make('div'); packages.id = 'release-artifacts';
  const supporting = make('details', undefined, 'trial-disclosure trial-supporting');
  const summary = make('summary'), copy = make('span', undefined, 'trial-disclosure-copy');
  const description = make('span', undefined, 'trial-disclosure-description');
  copy.append(make('span', 'Verification files and package guides', 'trial-disclosure-title'), description); summary.append(copy);
  const body = make('div', undefined, 'trial-disclosure-body');
  const supportingGrid = make('div'); supportingGrid.id = 'release-supporting-artifacts'; body.append(supportingGrid); supporting.append(summary, body);
  const entries = [], supportingEntries = [];
  for (const asset of record.artifacts) {
    const card = document.createElement('article'); card.className = 'trial-artifact';
    const title = document.createElement('h3'); title.textContent = asset.label;
    const detail = document.createElement('p'); detail.textContent = `${asset.filename} · ${(asset.sizeBytes / 1048576).toFixed(1)} MB`;
    const checksum = document.createElement('code'); checksum.textContent = `SHA-256: ${asset.sha256}`;
    const download = document.createElement('a'); download.className = 'button primary'; download.textContent = 'Download';
    download.href = `/api/access-admin/releases/artifacts/${encodeURIComponent(asset.id)}`; download.download = asset.filename;
    if (asset.product === 'installer' && !asset.supporting) installerGrid.append(renderInstallerCard(asset, download));
    else {
      card.append(title, detail, checksum, download);
      (asset.supporting ? supportingEntries : entries).push({ asset, card, button: download });
    }
  }
  const toggle = layoutToggle(layout => {
    renderPackages(packages, entries, layout);
    renderPackages(supportingGrid, supportingEntries, layout);
  });
  for (const button of toggle.children) button.setAttribute('aria-controls', 'release-artifacts release-supporting-artifacts');
  heading.append(toggle); manual.append(heading, make('p', 'Downloads grouped by operating system and app type. Review access uses your admin session.'), packages);
  renderPackages(packages, entries, 'table'); renderPackages(supportingGrid, supportingEntries, 'table');
  description.textContent = `${supportingEntries.length} ${supportingEntries.length === 1 ? 'file' : 'files'} · Checksums, release manifests, and setup guides`;
  if (installerGrid.children.length) root.append(installers);
  root.append(manual);
  if (supportingEntries.length) root.append(supporting);
}
adminReady.then(ready => { if (ready) return open(); }).catch(error => { status.textContent = error.message; });
