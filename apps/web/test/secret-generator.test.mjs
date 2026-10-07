import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const binding = new URL('../wasm/vaults_browser_fixture.js', import.meta.url);
const binary = new URL('../wasm/vaults_browser_fixture_bg.wasm', import.meta.url);
let available = true;
try { await access(binding); await access(binary); } catch { available = false; }

test('actual Rust WASM generator supports all modes and rejects invalid options', { skip: !available && 'Run pnpm fixture:build first' }, async () => {
  const { default: init, generate_secret } = await import(binding.href);
  await init({ module_or_path: await readFile(binary) });
  const generate = options => generate_secret(JSON.stringify(options));
  for (let index = 0; index < 32; index++) {
    const password = generate({ mode: 'password', length: 24, excludeAmbiguous: true });
    assert.equal(password.length, 24);
    assert.match(password, /[a-z]/); assert.match(password, /[A-Z]/);
    assert.match(password, /[0-9]/); assert.match(password, /[^a-zA-Z0-9]/);
    assert.doesNotMatch(password, /[Il1O0o]/);
    assert.match(generate({ mode: 'pin', length: 8 }), /^[0-9]{8}$/);
  }
  const phrase = generate({ mode: 'passphrase', words: 6, separator: ' ', capitalize: true, appendNumber: true });
  assert.match(phrase, /^[A-Z][a-z-]*( [A-Z][a-z-]*){5}[0-9]$/);
  const noSpaces = generate({ mode: 'passphrase', words: 6, separator: '' });
  assert.doesNotMatch(noSpaces, /\s/);
  for (const options of [{ mode: 'pin', length: 0 }, { mode: 'password', length: 129 },
    { mode: 'passphrase', words: 2 }, { mode: 'passphrase', separator: '\n' },
    { mode: 'password', lowercase: false, uppercase: false, numbers: false, symbols: false },
    { mode: 'not-a-mode' }, { length: -1 }, { unknown: true }]) {
    assert.throws(() => generate(options));
  }
  assert.throws(() => generate_secret('{'));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      getRandomValues() { throw new Error('Simulated unavailable entropy'); },
    } });
    for (const mode of ['password', 'passphrase', 'pin']) {
      assert.throws(() => generate({ mode }), /Secure randomness is unavailable/);
    }
  } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
});
