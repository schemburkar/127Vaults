// Fixture-only TLS proxy. It records identifiers and request hashes, never bodies
// or credentials. Publish its port to loopback only. The owned fixture upstream
// must temporarily move its host mapping to 12893 while retaining port 12892.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { createHash } from 'node:crypto';
const identity = '/identity', work = '/evidence';
const fixture = '14725fef-f5b4-4cb8-afe0-77aa3d80b268';
assert.equal((await readFile(identity + '/installation-id', 'utf8')).trim(), fixture);
const [cert, key, ca] = await Promise.all(['live/server.crt','live/server.key','ca/ca.crt'].map(path => readFile(identity + '/' + path)));
let dropped = false;
const attempts = [];
const server = createServer({ cert, key, minVersion: 'TLSv1.2' }, async (incoming, outgoing) => {
  try {
    assert.equal(incoming.headers.host, '127.0.0.1:12892');
    const chunks = []; let size = 0;
    for await (const chunk of incoming) { size += chunk.length; assert.ok(size <= 16 * 1024 * 1024); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    let arm = null;
    try { arm = JSON.parse(await readFile(work + '/arm.json', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const selected = arm?.fixtureServer === fixture && incoming.method === 'PUT' && incoming.url === arm.path;
    if (selected) assert.match(arm.path, /^\/api\/v1\/vaults\/[a-f0-9-]{36}\/items\/[a-f0-9-]{36}$/);
    const upstream = request({ hostname: 'server', port: 12892, path: incoming.url,
      method: incoming.method, headers: incoming.headers, ca, timeout: 30000, servername: '',
      checkServerIdentity: (_hostname, peer) => checkServerIdentity('127.0.0.1', peer) }, response => {
      const parts = []; let responseSize = 0;
      response.on('data', chunk => { responseSize += chunk.length; if (responseSize > 16 * 1024 * 1024) response.destroy(); else parts.push(chunk); });
      response.on('end', async () => {
        try {
          if (selected) {
            const body = JSON.parse(bytes);
            attempts.push({ method: incoming.method, path: incoming.url, status: response.statusCode,
              requestId: body.requestId, operationId: body.signedOperation?.opId,
              sha256: createHash('sha256').update(bytes).digest('hex') });
          }
          if (selected && !dropped && response.statusCode === 200) {
            dropped = true;
            await writeFile(work + '/proxy-evidence.json', JSON.stringify({ fixtureServer: fixture, acceptedReplyDropped: true, attempts }, null, 2) + '\n');
            outgoing.destroy(); return;
          }
          if (selected) await writeFile(work + '/proxy-evidence.json', JSON.stringify({ fixtureServer: fixture, acceptedReplyDropped: dropped, attempts }, null, 2) + '\n');
          outgoing.writeHead(response.statusCode, response.headers); outgoing.end(Buffer.concat(parts));
        } catch { outgoing.destroy(); }
      });
      response.on('error', () => outgoing.destroy());
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => outgoing.destroy());
    upstream.end(bytes);
  } catch { outgoing.destroy(); }
});
server.listen(12892, '0.0.0.0', () => console.log('Owned fictitious TLS response-loss proxy ready.'));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
