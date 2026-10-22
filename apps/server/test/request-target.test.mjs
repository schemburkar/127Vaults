import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import test from 'node:test';
import { createAdminHandler } from '../src/admin/handler.mjs';
import { requestAllowed, transportConfig } from '../src/transport.mjs';

test('real HTTP parser targets cannot escape the transport URL boundary', async () => {
  const config = transportConfig({});
  const admin = createAdminHandler({ pool: null, operators: [], origin: config.origin, localOnly: false });
  let routeErrors = 0, allowed = 0;
  const server = createServer((req, res) => {
    if (!requestAllowed(req, config)) { res.writeHead(403); res.end(); return; }
    allowed++;
    // Observe rejection without stopping the test runner. Production dispatch
    // uses this same async handler without this fixture's containment catch.
    admin(req, res).then(handled => {
      if (!handled) { res.writeHead(404); res.end(); }
    }).catch(() => { routeErrors++; res.writeHead(500); res.end(); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    for (const target of ['http://[', '//[', '//%']) {
      const socket = connect(server.address().port, '127.0.0.1');
      await once(socket, 'connect');
      socket.end(`GET ${target} HTTP/1.1\r\nHost: ${config.authority}\r\nConnection: close\r\n\r\n`);
      let response = ''; for await (const chunk of socket) response += chunk;
      assert.match(response, /^HTTP\/1\.1 (400|403)/);
    }
    assert.equal(routeErrors, 0);
    assert.equal(allowed, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
