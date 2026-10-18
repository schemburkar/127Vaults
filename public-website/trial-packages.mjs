const productNames = { server: 'Server', desktop: 'Desktop', cli: 'CLI', extension: 'Browser extension' };

function describe(asset) {
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
