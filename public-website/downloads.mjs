const grid = document.querySelector('.download-grid');
const state = document.querySelector('.download-state');
const names = { 'desktop-windows': 'Desktop for Windows', 'desktop-linux': 'Desktop for Linux', 'extension-chrome': 'Chrome extension',
  'extension-edge': 'Edge extension', 'cli-windows': 'CLI for Windows', 'cli-linux': 'CLI for Linux', server: 'Self-hosted server' };

try {
  const response = await fetch('releases.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('catalogue unavailable');
  const catalog = await response.json();
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.releases) || catalog.releases.length === 0) throw new Error('no releases');
  const cards = [];
  for (const release of catalog.releases) {
    if (!names[release.platform] || !/^https:\/\//.test(release.url) || !/^https:\/\//.test(release.signatureUrl) || !/^https:\/\//.test(release.licenseUrl)
      || !/^[a-f0-9]{64}$/.test(release.sha256)) throw new Error('invalid release');
    const card = document.createElement('article');
    const title = document.createElement('h3');
    title.textContent = names[release.platform];
    const version = document.createElement('p');
    version.textContent = `${release.version} · ${release.channel}`;
    const file = document.createElement('a');
    file.className = 'inline-cta';
    file.href = release.url;
    file.textContent = 'Download release';
    const signature = document.createElement('a');
    signature.className = 'inline-cta';
    signature.href = release.signatureUrl;
    signature.textContent = 'Download signature';
    const digest = document.createElement('code');
    digest.className = 'download-digest';
    digest.textContent = `SHA-256 ${release.sha256}`;
    const license = document.createElement('a');
    license.className = 'inline-cta';
    license.href = release.licenseUrl;
    license.textContent = 'Read release license';
    const compatibility = document.createElement('small');
    compatibility.textContent = `Minimum server ${release.minServerVersion} · BSL change date ${release.changeDate}`;
    card.append(title, version, file, signature, license, compatibility, digest);
    cards.push(card);
  }
  grid.replaceChildren(...cards);
  state.textContent = `${cards.length} published release${cards.length === 1 ? '' : 's'}`;
} catch { /* The page's unavailable state remains visible. */ }
