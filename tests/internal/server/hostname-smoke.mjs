// Isolated private-CA hostname acceptance. Does not change installed DNS or servers.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { createServer, request } from 'node:https';
import { once } from 'node:events';
import { runTls } from '../../../scripts/tls.mjs';
import { transportConfig, requestAllowed, sniAllowed } from '../../../apps/server/src/transport.mjs';

const output = process.argv[process.argv.indexOf('--output') + 1];
if (!process.argv.includes('--output') || !output) throw Error('Use --output <new receipt path>.');
const temporary = await mkdtemp(join(tmpdir(), '127vaults-hostname-'));
let server;
try {
  runTls(['init', 'vault.home.arpa', temporary]);
  const cert = await readFile(join(temporary,'live/server.crt'));
  const ca = await readFile(join(temporary,'ca/ca.crt'));
  const certificate = new X509Certificate(cert);
  assert.equal(certificate.checkHost('vault.home.arpa'),'vault.home.arpa');
  assert.equal(certificate.checkHost('evil.example.com'),undefined);
  const config = transportConfig({ VAULTS_ACCESS_MODE:'private-lan', VAULTS_BIND:'172.28.127.2',
    VAULTS_ENDPOINT_HOST:'vault.home.arpa', VAULTS_NETWORK_ADDRESS:'192.168.1.20', VAULTS_PUBLISH_ADDRESS:'192.168.1.20' });
  server = createServer({ cert, key:await readFile(join(temporary,'live/server.key')) }, (req,res) => {
    res.writeHead(sniAllowed(req.socket.servername ?? '',config) && requestAllowed(req,config) ? 200 : 403); res.end();
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const fetch = (host = config.authority, origin = config.origin, servername = config.endpoint) => new Promise((done,reject) => {
    const req = request({ hostname:'127.0.0.1', port:server.address().port, servername, ca,
      headers:{Host:host,Origin:origin}, timeout:3000 }, res => {res.resume();res.on('end',()=>done(res.statusCode));});
    req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Timed out')));req.end();
  });
  assert.equal(await fetch(),200);
  assert.equal(await fetch('192.168.1.20:12780'),403);
  assert.equal(await fetch(config.authority,'https://evil.example.com'),403);
  await assert.rejects(fetch(config.authority,config.origin,'evil.example.com'),/Hostname\/IP does not match/);
  await mkdir(resolve(output,'..'),{recursive:true});
  await writeFile(output,JSON.stringify({status:'passed',testedAt:new Date().toISOString(),checks:[
    'Real private-CA DNS certificate generated and verified', 'Trusted HTTPS with exact hostname succeeds',
    'IP Host and wrong Origin refused', 'Wrong TLS hostname fails certificate validation',
    'No installed DNS, identity, server or catalogue changed']},null,2)+'\n',{flag:'wx'});
  console.log(`Hostname acceptance passed: ${output}`);
} finally {
  if(server) await new Promise(done => server.close(done));
  if (!relative(tmpdir(),temporary).startsWith('127vaults-hostname-')) throw Error('Unexpected cleanup directory');
  await rm(temporary,{recursive:true,force:true});
}
