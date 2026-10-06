import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseCatalog } from './validate-releases.mjs';

test('published release entries require signed artifacts and release-specific license metadata', () => {
  const entry = { platform: 'desktop-windows', version: '1.0.0-beta.1', channel: 'beta',
    url: 'https://downloads.example/desktop.exe', signatureUrl: 'https://downloads.example/desktop.exe.sig',
    licenseUrl: 'https://downloads.example/LICENSE', sha256: 'a'.repeat(64), signingKeyId: 'release-1',
    publishedAt: '2026-10-06', changeDate: '2030-10-06', sizeBytes: 12345, minServerVersion: '1.0.0' };
  assert.equal(validateReleaseCatalog({ schemaVersion: 1, releases: [entry] }).releases.length, 1);
  assert.throws(() => validateReleaseCatalog({ schemaVersion: 1, releases: [{ ...entry, licenseUrl: null }] }));
  assert.throws(() => validateReleaseCatalog({ schemaVersion: 1, releases: [entry, entry] }));
});
