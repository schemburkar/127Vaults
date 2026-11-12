import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloudflareCliEnvironment } from './cloudflare-cli-auth.mjs';

test('explicit Cloudflare CLI credentials reach only the child environment and preserve an existing API token', async t => {
  const root = await mkdtemp(join(tmpdir(), '127v-cf-auth-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'cloudflare/config'), { recursive: true });
  const file = join(root, 'cloudflare/config/default.json');
  const token = 'fixture-oauth-credential-123456789';
  await writeFile(file, JSON.stringify({ oauth_token: token, refresh_token: 'never-forward' }));
  const original = { XDG_CONFIG_HOME: root };
  const env = await cloudflareCliEnvironment(original);
  assert.equal(env.CLOUDFLARE_API_TOKEN, token);
  assert.equal(original.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(env.refresh_token, undefined);
  assert.equal((await cloudflareCliEnvironment({ CLOUDFLARE_API_TOKEN: 'explicit' })).CLOUDFLARE_API_TOKEN, 'explicit');
  await writeFile(file, JSON.stringify({ oauth_token: 'bad\ncredential' }));
  await assert.rejects(cloudflareCliEnvironment(original), /credentials are unavailable/);
});
