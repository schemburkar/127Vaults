import test from 'node:test';
import assert from 'node:assert/strict';

test('OS lock covers both local agents and only the configured vault tab after worker start', async () => {
  let listener, interval, injected = [], nativeRequests = [];
  const messageListeners = [];
  const port = {
    onMessage: { addListener(callback) { messageListeners.push(callback); } },
    onDisconnect: { addListener() {} },
    postMessage(request) {
      nativeRequests.push(request);
      queueMicrotask(() => messageListeners.forEach(callback => callback({ id: request.id, ok: true, value: { locked: true } })));
    },
    disconnect() {},
  };
  globalThis.chrome = {
    runtime: { id: 'test-extension', onMessage: { addListener() {} }, connectNative() { return port; } },
    idle: { setDetectionInterval(value) { interval = value; }, onStateChanged: { addListener(value) { listener = value; } } },
    storage: { local: { async get() { return { vaultOrigin: 'https://vault.example.test:12781' }; } } },
    permissions: { async contains() { return true; } },
    tabs: { async query() { return [
      { id: 1, url: 'https://vault.example.test:12781/' },
      { id: 2, url: 'https://vault.example.test:443/' },
      { id: 3, url: 'https://other.example.test/' },
    ]; } },
    scripting: { async executeScript(request) { injected.push(request); } },
  };
  await import('../src/background.mjs');
  assert.equal(interval, 1800);
  await listener('active');
  assert.equal(injected.length, 0);
  await listener('locked');
  assert.equal(injected.length, 1);
  assert.equal(injected[0].target.tabId, 1);
  assert.equal(injected[0].world, 'MAIN');
  assert.deepEqual(nativeRequests.map(request => request.source), ['desktop', 'cli']);
});
