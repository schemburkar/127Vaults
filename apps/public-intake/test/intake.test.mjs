import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntakeHandler, validateRequest } from '../src/server.mjs';
import { validIntakeOrigin } from '../src/intake-origin.mjs';

test('HTTP dry runs require explicit opt-in and stay on loopback origins', () => {
  assert.equal(validIntakeOrigin('https://public.example'), true);
  assert.equal(validIntakeOrigin('http://localhost:12951'), false);
  assert.equal(validIntakeOrigin('http://localhost:12951', true), true);
  assert.equal(validIntakeOrigin('http://127.0.0.1:12951', true), true);
  for (const host of ['admin.localhost', 'manage.localhost', 'admin.127vaults.localhost']) {
    assert.equal(validIntakeOrigin(`http://${host}:12952`, true), true);
    assert.equal(validIntakeOrigin(`http://${host}:12952`), false);
  }
  for (const origin of ['http://admin.localhost.attacker.example', 'http://notlocalhost', 'http://bad..localhost', 'http://admin.localhost:12952/path', 'http://192.168.1.50:12951', 'http://public.example', 'http://localhost.attacker.example', 'http://localhost:12951/path']) {
    assert.equal(validIntakeOrigin(origin, true), false);
  }
});

test('waitlist accepts a consented request without storing plaintext and rejects cross-origin POST', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-intake-'));
  const file = join(dir, 'requests.jsonl');
  const key = randomBytes(32);
  const server = createServer(createIntakeHandler({ origin: 'https://127vaults.example', key, dataFile: file }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/waitlist`;
  try {
    const body = JSON.stringify({ email: 'Alex@Example.com', organization: '', plan: 'personal', requestedSeats: 2, consent: true, website: '' });
    const denied = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body });
    assert.equal(denied.status, 403);
    const accepted = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://127vaults.example' }, body });
    assert.equal(accepted.status, 202);
    const commercial = JSON.stringify({ email: 'buyer@example.com', contactName: 'Alex Example', organization: 'Example Team', plan: 'commercial', requestedSeats: 10,
      consent: true, website: '' });
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://127vaults.example' }, body: commercial })).status, 202);
    const saved = await readFile(file, 'utf8');
    assert.ok(!saved.includes('Alex@Example.com'));
    assert.ok(!saved.includes('alex@example.com'));
    const lines = saved.trim().split('\n').map(JSON.parse);
    assert.equal(lines[0].version, 1);
    const entry = lines[1];
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.nonce, 'base64url'));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64url'));
    const detail = JSON.parse(Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, 'base64url')), decipher.final()]).toString());
    assert.equal(detail.requestedSeats, 10);
    assert.equal(detail.plan, 'commercial');
    assert.equal(detail.contactName, 'Alex Example');
    assert.equal(detail.organization, 'Example Team');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('self-hosted requests require user counts, commercial contacts, and reject unavailable plans', () => {
  const request = { email: 'buyer@example.com', organization: '', plan: 'personal', consent: true, website: '' };
  assert.equal(validateRequest({ ...request, requestedSeats: 1 }).requestedSeats, 1);
  for (const requestedSeats of [0, 101, 1.5, '10', null, undefined]) {
    assert.equal(validateRequest({ ...request, requestedSeats }), null);
  }
  assert.equal(validateRequest({ ...request, requestedSeats: 10 }).requestedSeats, 10);
  for (const plan of ['cloud', 'undecided']) assert.equal(validateRequest({ ...request, plan, requestedSeats: 1 }), null);
  assert.equal(validateRequest({ ...request, plan: 'commercial', requestedSeats: 5 }), null);
  assert.equal(validateRequest({ ...request, plan: 'commercial', requestedSeats: 5, organization: 'Team' }), null);
  assert.equal(validateRequest({ ...request, plan: 'commercial', requestedSeats: 5, contactName: 'Alex' }), null);
  assert.equal(validateRequest({ ...request, plan: 'commercial', requestedSeats: 5, contactName: 'Alex', organization: 'Team' }).contactName, 'Alex');
});
