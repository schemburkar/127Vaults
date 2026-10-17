import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { relayConfig, createPrivateRelay } from '../src/private-relay.mjs';

test('relay binds exactly the ingress interface and refuses public or ambiguous routing', () => {
  const interfaces = { backend: [{ family: 'IPv4', address: '172.28.102.4', internal: false }],
    ingress: [{ family: 'IPv4', address: '10.89.1.2', internal: false }] };
  assert.deepEqual(relayConfig({ VAULTS_RELAY_TARGET: '172.28.102.2' }, interfaces),
    { bind: '10.89.1.2', backendBind: '172.28.102.4', target: '172.28.102.2', port: 12780 });
  assert.throws(() => relayConfig({ VAULTS_RELAY_TARGET: '8.8.8.8' }, interfaces));
  assert.throws(() => relayConfig({ VAULTS_RELAY_TARGET: '172.28.102.2' }, { backend: interfaces.backend }));
  assert.throws(() => relayConfig({ VAULTS_RELAY_TARGET: '172.28.102.2' }, { ...interfaces,
    extra: [{ family: 'IPv4', address: '192.168.1.2', internal: false }] }));
});

test('relay transparently forwards bytes in both directions and closes after the target disconnects', async t => {
  const target = createServer(socket => socket.once('data', data => socket.end(Buffer.concat([Buffer.from('reply:'), data]))));
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  t.after(() => new Promise(resolve => target.close(resolve)));
  const relay = createPrivateRelay({ bind: '127.0.0.1', target: '127.0.0.1', port: 0, targetPort: target.address().port });
  await relay.start(); t.after(() => relay.stop());
  const client = connect(relay.address().port, '127.0.0.1');
  t.after(() => client.destroy());
  const chunks = []; client.on('data', data => chunks.push(data));
  client.write('opaque TLS bytes'); await once(client, 'close');
  assert.equal(Buffer.concat(chunks).toString(), 'reply:opaque TLS bytes');
});
