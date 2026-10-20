import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assetFiles } from '../scripts/cloudflare/config.mjs';

test('security overview links to published technical details with parameters matching the implementation', async () => {
  const [overview, technical, crypto, opaque] = await Promise.all([
    readFile(new URL('./security.html', import.meta.url), 'utf8'),
    readFile(new URL('./security-technical.html', import.meta.url), 'utf8'),
    readFile(new URL('../crates/crypto/src/ecf1.rs', import.meta.url), 'utf8'),
    readFile(new URL('../crates/crypto/src/opaque.rs', import.meta.url), 'utf8'),
  ]);
  assert.match(overview, /href="security-technical.html"/);
  assert.ok(assetFiles.includes('security-technical.html'));
  assert.match(technical, /64 MiB \(65,536 KiB\) of memory, 3 passes, 1 lane and a 32-byte output/);
  assert.match(crypto, /Params::new\(65_536, 3, 1, Some\(32\)\)/);
  assert.match(opaque, /Params::new\(65_536, 3, 1, Some\(L::USIZE\)\)/);
  for (const html of [overview, technical]) {
    assert.match(html, /persistent/i);
    assert.match(html, /metadata/);
    assert.match(html, /compromised server|server compromise/);
    assert.doesNotMatch(html, /private.test implementation|private testing|experimental|independent.*audit|security certification/i);
    assert.match(html, /src="wordmark.svg"/);
    assert.doesNotMatch(html, /wordmark-red.svg/);
  }
});
