import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingLogin, savedWebsiteOrigin, originOf } from '../src/match.mjs';

test('bare saved domains match every HTTPS path on exactly that host', () => {
  for (const saved of ['vercel.com', ' VERCEL.COM ', 'vercel.com/login', 'https://vercel.com/login', 'vercel.com:443']) {
    for (const page of ['https://vercel.com/', 'https://vercel.com/dashboard?tab=all#items']) {
      assert.equal(matchingLogin(saved, page), true, `${saved} -> ${page}`);
    }
    for (const page of ['http://vercel.com/', 'https://app.vercel.com/', 'https://vercel.com.evil.test/', 'https://vercel.com:444/']) {
      assert.equal(matchingLogin(saved, page), false, `${saved} -> ${page}`);
    }
  }
  assert.equal(matchingLogin('vercel.com:444/path', 'https://vercel.com:444/other'), true);
  assert.equal(originOf('vercel.com'), null, 'page and permission URLs still require explicit HTTPS');
});

test('saved website matching rejects unsafe or malformed values', () => {
  for (const saved of [undefined, '', '//vercel.com', 'http://vercel.com', 'https://user:pass@vercel.com', 'user@vercel.com', '*.vercel.com', 'vercel.com\\@evil.test', 'vercel.\tcom', 'https:vercel.com']) {
    assert.equal(savedWebsiteOrigin(saved), null, String(saved));
  }
});
