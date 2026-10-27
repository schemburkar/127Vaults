import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderReleaseNotes } from './build-release-notes.mjs';
import { assetFiles } from '../scripts/cloudflare/config.mjs';

test('release notes keep exactly two latest entries on Downloads and retain the rest in history', async () => {
  const entries = JSON.parse(await readFile(new URL('./release-notes.json', import.meta.url), 'utf8'));
  const { latest, history } = renderReleaseNotes(entries.slice().reverse());
  const downloads = await readFile(new URL('./downloads.html', import.meta.url), 'utf8');
  const archive = await readFile(new URL('./release-notes-history.html', import.meta.url), 'utf8');
  assert.equal((latest.match(/<article /g) || []).length, 2);
  assert.equal((history.match(/<article /g) || []).length, entries.length - 2);
  assert.ok(downloads.includes(latest));
  assert.ok(archive.includes(history));
  assert.match(downloads, /href="release-notes-history.html"/);
  assert.match(archive, /href="downloads.html#release-notes"/);
  assert.ok(assetFiles.includes('release-notes-history.html'));
  for (const entry of entries) {
    const id = `id="version-${entry.version.replaceAll('.', '-')}"`;
    assert.equal(Number(downloads.includes(id)) + Number(archive.includes(id)), 1);
  }
});

test('release note rendering rejects duplicates and escapes content', () => {
  const entry = { version: '1.2.3', date: '2026-10-27', summary: '<summary>', changes: ['<script>'] };
  assert.throws(() => renderReleaseNotes([entry, entry]));
  assert.match(renderReleaseNotes([entry]).latest, /&lt;script&gt;/);
});
