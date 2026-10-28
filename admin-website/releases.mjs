const status = document.getElementById('release-status');
async function open() {
  const response = await fetch('/api/access-admin/releases', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw Error(response.status === 401 ? 'Sign in on the access requests page, then return to review releases.' : 'Release review is temporarily unavailable.');
  const record = await response.json();
  status.textContent = `Current release: ${record.sourceRevision}`;
  for (const asset of record.artifacts) {
    const card = document.createElement('article'); card.className = 'access-card';
    const title = document.createElement('h2'); title.textContent = asset.label;
    const detail = document.createElement('p'); detail.textContent = `${asset.filename} · ${(asset.sizeBytes / 1048576).toFixed(1)} MB`;
    const checksum = document.createElement('code'); checksum.textContent = `SHA-256: ${asset.sha256}`;
    const download = document.createElement('a'); download.className = 'button'; download.textContent = 'Download for review';
    download.href = `/api/access-admin/releases/artifacts/${encodeURIComponent(asset.id)}`; download.download = asset.filename;
    card.append(title, detail, checksum, download); document.getElementById('release-artifacts').append(card);
  }
}
open().catch(error => { status.textContent = error.message; });
