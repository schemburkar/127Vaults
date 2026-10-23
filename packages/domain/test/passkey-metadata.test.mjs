import test from 'node:test';
import assert from 'node:assert/strict';
import { PASSKEY_META, encode, decode, readMetadata } from '../src/passkey-metadata.mjs';

const metadata = { version: 1, algorithm: -7, rpId: 'login.example.test', origin: 'https://login.example.test', credentialId: encode(new Uint8Array(32).fill(9)), userHandle: 'AQ', username: 'sample', displayName: 'Sample', signCount: 0 };
const fields = value => [{ id: PASSKEY_META, type: 'metadata', value: JSON.stringify(value) }];

test('metadata parsing preserves the stored representation and ignores ordinary fields', () => {
  assert.deepEqual(readMetadata([...fields(metadata), { id: 'note', type: 'text', value: 'unchanged' }]), metadata);
  assert.equal(readMetadata([]), null);
});

test('metadata rejects ambiguous records, invalid origins, counters and malformed identifiers', () => {
  assert.throws(() => readMetadata([...fields(metadata), ...fields(metadata)]));
  assert.throws(() => readMetadata([{ ...fields(metadata)[0], type: 'text' }]));
  for (const change of [{ origin: 'http://login.example.test' }, { rpId: 'example.test' }, { origin: 'https://login.example.test/' }, { credentialId: 'AQ' }, { signCount: 1 }, { userHandle: 'AB' }]) {
    assert.throws(() => readMetadata(fields({ ...metadata, ...change })));
  }
});

test('base64url is canonical and honors caller size bounds without changing bytes', () => {
  const bytes = Uint8Array.of(0, 127, 128, 255);
  assert.deepEqual(decode(encode(bytes), 4, 4), bytes);
  for (const value of ['AB', 'AQ==', '*', '']) assert.throws(() => decode(value));
  assert.throws(() => decode(encode(bytes), 5, 6));
  assert.throws(() => decode(encode(bytes), 1, 3));
});
