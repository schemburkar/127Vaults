import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function renderReleaseNotes(entries) {
  const seen = new Set();
  for (const entry of entries) {
    if (!/^\d+\.\d+\.\d+$/.test(entry.version) || seen.has(entry.version)
      || !/^\d{4}-\d\d-\d\d$/.test(entry.date) || !Number.isFinite(Date.parse(entry.date))
      || typeof entry.summary !== 'string' || !Array.isArray(entry.changes) || !entry.changes.length
      || entry.changes.some(change => typeof change !== 'string')) throw Error('Invalid release notes entry');
    seen.add(entry.version);
  }
  const sorted = [...entries].sort((a, b) => {
    const x = a.version.split('.').map(Number), y = b.version.split('.').map(Number);
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  });
  const render = list => list.map(entry => `<article class="release-note"><h2 id="version-${entry.version.replaceAll('.', '-')}">Version ${entry.version}</h2><p><time datetime="${entry.date}">${new Date(`${entry.date}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}</time> · ${escape(entry.summary)}</p><ul>${entry.changes.map(change => `<li>${escape(change)}</li>`).join('')}</ul></article>`).join('');
  return { latest: render(sorted.slice(0, 2)), history: render(sorted.slice(2)), historyCount: Math.max(0, sorted.length - 2) };
}

export async function buildReleaseNotes() {
  const notes = renderReleaseNotes(JSON.parse(await readFile(new URL('./release-notes.json', import.meta.url), 'utf8')));
  const source = await readFile(new URL('./downloads.html', import.meta.url), 'utf8');
  const section = `<section class="page-section" id="release-notes"><div class="container prose"><span class="kicker">LATEST RELEASE NOTES</span>${notes.latest}<nav aria-label="Release notes pages"><a class="inline-cta" href="release-notes-history.html">Earlier release notes (${notes.historyCount}) →</a></nav><p>Packages remain available through approved private download links. Back up existing installations and follow the included upgrade instructions.</p></div></section>`;
  if (!source.includes('id="release-notes"')) throw Error('Downloads release notes section missing');
  const downloads = source.replace(/<section class="page-section" id="release-notes">[\s\S]*?<\/section>/, section);
  await writeFile(new URL('./downloads.html', import.meta.url), downloads);
  const history = downloads.replace(/<title>[^<]+<\/title>/, '<title>Release notes history — 127 Vaults</title>')
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="Earlier 127Vaults release notes for Desktop, browser extension, CLI and self-hosted server.">')
    .replace(/\s*<script src="downloads\.mjs[^>]*><\/script>/, '')
    .replace(/<main id="main">[\s\S]*?<\/main>/, `<main id="main"><section class="page-hero"><div class="container"><span class="kicker">RELEASE NOTES</span><h1>Release notes history.</h1><p>Earlier improvements and fixes across 127Vaults.</p><a class="inline-cta" href="downloads.html#release-notes">← Latest two releases</a></div></section><section class="page-section"><div class="container prose">${notes.history || '<p>No earlier releases yet.</p>'}</div></section></main>`);
  await writeFile(new URL('./release-notes-history.html', import.meta.url), history);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildReleaseNotes();
