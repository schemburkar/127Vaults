const productNames = { server: 'Server', desktop: 'Desktop', cli: 'CLI', extension: 'Browser extension', installer: 'Installer' };

export function describe(asset) {
  const parts = (asset.label || '').split(' / ');
  const product = asset.product || parts[0] || 'Other';
  const platform = asset.platform || parts[1] || 'Other';
  const os = /^win/i.test(platform) ? 'Windows' : /^linux/i.test(platform) ? 'Linux'
    : /^(mac|darwin)/i.test(platform) ? 'macOS' : /extension|browser|chrome|edge/i.test(`${platform} ${product}`) ? 'Cross-platform browsers' : platform;
  return { os, app: productNames[product] || product, platform };
}

export function renderPackages(container, packages, layout) {
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

export function renderInstallerCard(asset, button, doc = document) {
  const card = doc.createElement('article'); card.className = 'trial-artifact trial-installer-card';
  const { os } = describe(asset);
  const badge = doc.createElement('span'); badge.className = 'trial-installer-platform'; badge.textContent = 'SETUP INSTALLER';
  const heading = doc.createElement('h3'); heading.textContent = os;
  const purpose = doc.createElement('p'); purpose.textContent = `Install ${os} apps or set up the server using Docker.`;
  const detail = doc.createElement('p'); detail.textContent = `x64 · ${(asset.sizeBytes / 1048576).toFixed(1)} MB · ${asset.filename.endsWith('.zip') ? 'ZIP archive' : 'tar.gz archive'}`;
  const verification = doc.createElement('details'); verification.className = 'trial-installer-verification';
  const summary = doc.createElement('summary'); summary.textContent = 'Verify download';
  const filename = doc.createElement('small'); filename.textContent = asset.filename;
  const checksum = doc.createElement('code'); checksum.textContent = `SHA-256: ${asset.sha256}`;
  verification.append(summary, filename, checksum);
  button.textContent = `Download for ${os}`; button.setAttribute('aria-label', `Download ${os} setup installer`);
  card.append(badge, heading, purpose, detail, button, verification);
  return card;
}

export function layoutToggle(onChange, doc = document) {
  const group = doc.createElement('div'); group.className = 'trial-layout'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Package layout');
  for (const [view, label, icon] of [
    ['table', 'Table view', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M10 9v11"/>'],
    ['cards', 'Card view', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'],
  ]) {
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'trial-layout-icon'; button.title = label;
    button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', String(view === 'table'));
    button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${icon}</svg>`;
    button.addEventListener('click', () => {
      for (const other of group.children) other.setAttribute('aria-pressed', String(other === button));
      onChange(view);
    });
    group.append(button);
  }
  return group;
}

