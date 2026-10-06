import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntakeHandler } from '../src/server.mjs';

test('waitlist accepts a consented request without storing plaintext and rejects cross-origin POST', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-intake-'));
  const file = join(dir, 'requests.jsonl');
  const server = createServer(createIntakeHandler({ origin: 'https://127vaults.example', key: randomBytes(32), dataFile: file }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/waitlist`;
  try {
    const body = JSON.stringify({ email: 'Alex@Example.com', organization: '', plan: 'personal', consent: true, website: '' });
    const denied = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body });
    assert.equal(denied.status, 403);
    const accepted = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://127vaults.example' }, body });
    assert.equal(accepted.status, 202);
    const saved = await readFile(file, 'utf8');
    assert.ok(!saved.includes('Alex@Example.com'));
    assert.ok(!saved.includes('alex@example.com'));
    assert.equal(JSON.parse(saved).version, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
