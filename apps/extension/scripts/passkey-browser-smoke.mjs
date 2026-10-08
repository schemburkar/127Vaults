// Optional real-browser adapter acceptance, with an isolated synthetic key holder.
// Run with an installed Playwright module and Edge, or set VAULTS_BROWSER_CHANNEL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createPublicKey, createHash, verify } from 'node:crypto';
import { decode } from '../src/passkeys.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.VAULTS_BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const context = await browser.newContext();
  const core = await readFile(new URL('../src/passkeys.mjs', import.meta.url), 'utf8');
  const shim = await readFile(new URL('../src/passkey-page.js', import.meta.url), 'utf8');
  await context.route('https://passkey.example.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('/core.mjs') ? 'text/javascript' : 'text/html', body: route.request().url().endsWith('/core.mjs') ? core : '<!doctype html><title>Disposable passkey test</title>' }));
  const holder = await context.newPage(), page = await context.newPage();
  await holder.goto('https://passkey.example.test/holder');
  await page.goto('https://passkey.example.test/');
  await page.exposeFunction('syntheticVaultRequest', async request => holder.evaluate(async request => {
    const api = await import('/core.mjs');
    if (request.operation === 'create') {
      window.testCredential = await api.createPasskey(request.options, location.origin, true);
      return window.testCredential.response;
    }
    const credential = window.testCredential;
    return api.assertPasskey(credential.metadata, credential.privateKey, request.options, location.origin, true);
  }, request));
  await page.evaluate(() => {
    // Record fallthrough without opening an OS authenticator prompt.
    navigator.credentials.get = async () => ({ browserFallback: true });
    window.addEventListener('message', async event => {
      if (event.source !== window || event.data?.channel !== '127vaults.passkey.request') return;
      const value = await window.syntheticVaultRequest(event.data);
      window.postMessage({ channel: '127vaults.passkey.response', id: event.data.id, value }, location.origin);
    });
  });
  await page.addScriptTag({ content: shim });
  const result = await page.evaluate(async () => {
    const backing = new Uint8Array(40).fill(8), challenge = new DataView(backing.buffer, 4, 32);
    const registered = await navigator.credentials.create({ publicKey: { challenge, rp: { id: location.hostname, name: 'Test' }, user: { id: new Uint8Array([1]), name: 'sample', displayName: 'Sample' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, extensions: { credProps: true } } });
    const signed = await navigator.credentials.get({ publicKey: { challenge: new Uint8Array(32).fill(9), rpId: location.hostname, userVerification: 'required', allowCredentials: [{ type: 'public-key', id: registered.rawId }] } });
    return { registered: registered.toJSON(), signed: signed.toJSON(), credentialPrototype: registered instanceof PublicKeyCredential && signed instanceof PublicKeyCredential, responsePrototypes: registered.response instanceof AuthenticatorAttestationResponse && signed.response instanceof AuthenticatorAssertionResponse, buffers: registered.rawId instanceof ArrayBuffer && registered.response.getPublicKey() instanceof ArrayBuffer && signed.response.signature instanceof ArrayBuffer, transports: registered.response.getTransports(), fallback: await navigator.credentials.get({ publicKey: { challenge: new Uint8Array(32) }, mediation: 'conditional' }) };
  });
  assert(result.credentialPrototype && result.responsePrototypes && result.buffers);
  assert.equal(result.fallback.browserFallback, true);
  assert.deepEqual(result.registered.clientExtensionResults, { credProps: { rk: true } });
  assert.equal(result.signed.id, result.registered.id);
  const publicKey = createPublicKey({ key: Buffer.from(decode(result.registered.response.publicKey)), format: 'der', type: 'spki' });
  const auth = decode(result.signed.response.authenticatorData), client = decode(result.signed.response.clientDataJSON);
  assert(verify('sha256', Buffer.concat([auth, createHash('sha256').update(client).digest()]), publicKey, decode(result.signed.response.signature)));
  assert.equal(decode(JSON.parse(Buffer.from(decode(result.registered.response.clientDataJSON)).toString()).challenge).length, 32);
  console.log(JSON.stringify({ ok: true, realBrowserAdapter: true, typedBuffers: true, nativeFallback: true, es256SignatureVerified: true }));
} finally { await browser.close(); }
