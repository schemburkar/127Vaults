import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const files = new Map([
  ['/', ['./fixture/index.html', 'text/html; charset=utf-8']],
  ['/login-item', ['./fixture/login-item.html', 'text/html; charset=utf-8']],
  ['/ecf1-smoke', ['./fixture/ecf1-smoke.html', 'text/html; charset=utf-8']],
  ['/fixture/style.css', ['./fixture/style.css', 'text/css; charset=utf-8']],
  ...['fixture-demo', 'fixture-core', 'login-session', 'ecf1-worker-client', 'login-item-demo'].map(name => [`/src/${name}.mjs`, [`./src/${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ['/fixture/ecf1-smoke.mjs', ['./fixture/ecf1-smoke.mjs', 'text/javascript; charset=utf-8']],
  ['/fixture/ecf1-worker.mjs', ['./fixture/ecf1-worker.mjs', 'text/javascript; charset=utf-8']],
  ['/packages/domain/src/login-item.mjs', ['../../packages/domain/src/login-item.mjs', 'text/javascript; charset=utf-8']],
  ['/wasm/vaults_browser_fixture.js', ['./wasm/vaults_browser_fixture.js', 'text/javascript; charset=utf-8']],
  ['/wasm/vaults_browser_fixture_bg.wasm', ['./wasm/vaults_browser_fixture_bg.wasm', 'application/wasm']],
]);
const authorities = new Set(['localhost:12781', '127.0.0.1:12781']);
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; connect-src 'self' https://api.pwnedpasswords.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  const hosts = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host');
  if (hosts.length !== 1 || !authorities.has(req.headers.host) ||
      (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) ||
      Object.keys(req.headers).some(name => name === 'forwarded' || name.startsWith('x-forwarded-'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  // Exact allowlist only: no filesystem path derived from a request.
  const file = files.get(req.url.split('?')[0]);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await readFile(fileURLToPath(new URL(file[0], import.meta.url)));
    res.writeHead(200, { 'Content-Type': file[1] });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Build assets unavailable. Run pnpm fixture:build.'); }
});
server.headersTimeout = 5000;
server.requestTimeout = 5000;
server.on('upgrade', (_req, socket) => socket.destroy());
server.on('error', () => { console.error('Fixture server failed to bind localhost:12781. Check for an existing process.'); process.exitCode = 1; });
server.listen(12781, '127.0.0.1', () => console.log('Experimental Rust browser fixture: http://localhost:12781 — disposable fixture only.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
