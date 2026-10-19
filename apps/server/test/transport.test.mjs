import test from 'node:test';
import assert from 'node:assert/strict';
import { requestAllowed, sniAllowed, transportConfig } from '../src/transport.mjs';

test('accepts exact loopback and private-LAN configurations', () => {
  assert.equal(transportConfig({}).origin, 'https://127.0.0.1:12780');
  assert.equal(transportConfig({ VAULTS_ACCESS_MODE: 'private-lan', VAULTS_BIND: '172.28.127.2', VAULTS_ENDPOINT_HOST: '192.168.1.8', VAULTS_PUBLISH_ADDRESS: '192.168.1.8' }).authority, '192.168.1.8:12780');
});

test('tailnet endpoint retains loopback publication and exact Host/Origin checks', () => {
  const env = {VAULTS_ACCESS_MODE:'tailscale',VAULTS_BIND:'172.28.102.2',VAULTS_ENDPOINT_HOST:'100.64.0.10',VAULTS_PUBLISH_ADDRESS:'127.0.0.1'};
  const config=transportConfig(env);
  assert.equal(config.origin,'https://100.64.0.10:12780');
  for (const changes of [{VAULTS_PUBLISH_ADDRESS:'100.64.0.10'},{VAULTS_ENDPOINT_HOST:'8.8.8.8'},
    {VAULTS_ENDPOINT_HOST:'100.128.0.1'},{VAULTS_ENDPOINT_HOST:'vault.example.com'}]) assert.throws(()=>transportConfig({...env,...changes}));
});

test('refuses public, wildcard, mismatched, and custom-domain exposure', () => {
  for (const env of [
    { VAULTS_BIND: '0.0.0.0' },
    { VAULTS_ACCESS_MODE: 'private-lan', VAULTS_BIND: '172.28.127.2', VAULTS_ENDPOINT_HOST: '8.8.8.8', VAULTS_PUBLISH_ADDRESS: '8.8.8.8' },
    { VAULTS_ACCESS_MODE: 'private-lan', VAULTS_BIND: '172.28.127.2', VAULTS_ENDPOINT_HOST: '192.168.1.8', VAULTS_PUBLISH_ADDRESS: '192.168.1.9' },
    { VAULTS_ACCESS_MODE: 'private-lan', VAULTS_BIND: '172.28.127.2', VAULTS_ENDPOINT_HOST: 'vault.example.com', VAULTS_PUBLISH_ADDRESS: '192.168.1.8' }
  ]) assert.throws(() => transportConfig(env));
});

test('Host, Origin, forwarded headers, and SNI are exact', () => {
  const config = transportConfig({});
  const request = (host, origin, extra = {}) => ({ rawHeaders: ['Host', host], headers: { host, ...(origin ? { origin } : {}), ...extra } });
  assert.equal(requestAllowed(request(config.authority, config.origin), config), true);
  assert.equal(requestAllowed(request('evil.test:12780', config.origin), config), false);
  assert.equal(requestAllowed(request(config.authority, 'https://evil.test'), config), false);
  assert.equal(requestAllowed(request(config.authority, config.origin, { 'x-forwarded-host': config.authority }), config), false);
  assert.equal(sniAllowed('127.0.0.1', config), true);
  assert.equal(sniAllowed('', config), true);
  assert.equal(sniAllowed('evil.test', config), false);
});
