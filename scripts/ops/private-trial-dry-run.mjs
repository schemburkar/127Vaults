// Local-only site + real intake/trial API, with encrypted simulated email.
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createIntakeHandler } from '../../apps/public-intake/src/server.mjs';
import { createTrialHandler, loadTrialArtifacts } from '../../apps/public-intake/src/trials.mjs';
import { seal } from '../../apps/public-intake/src/mock-selfhost.mjs';

const args = process.argv.slice(2), options = new Map();
for (let index = 0; index < args.length; index += 2) {
  if (!['--work', '--port'].includes(args[index]) || !args[index + 1] || options.has(args[index])) throw Error('Use --work <prepared private trial directory> [--port 12951].');
  options.set(args[index], args[index + 1]);
}
if (!options.has('--work')) throw Error('Supply the prepared private trial directory with --work.');
const work = resolve(options.get('--work')), port = Number(options.get('--port') ?? 12951);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local port.');
const origin = `http://localhost:${port}`, host = `localhost:${port}`;
const root = resolve(import.meta.dirname, '../../public-website'), data = join(work, 'dry-run');
await mkdir(data, { recursive: true, mode: 0o700 });
const key = Buffer.from((await readFile(join(work, 'intake-key'), 'utf8')).trim(), 'hex');
const operatorToken = (await readFile(join(work, 'operator-token'), 'utf8')).trim();
const catalogue = await loadTrialArtifacts(join(work, 'catalogue.json'));
const common = { origin, key, dataFile: join(data, 'requests.jsonl'), allowLoopbackHttp: true };
const waitlist = createIntakeHandler(common);
const emailKey = createHash('sha256').update(key).update('local-dry-run-email-v1').digest();
const trials = createTrialHandler({ ...common, operatorToken, dataDir: join(data, 'trials'),
  catalogue, issuerKeyId: 'trial', issuerPrivateKey: await readFile(join(work, 'issuer.pem'), 'utf8'),
  mailer: { mode: 'dry-run', sendInvitation: async message => {
    await appendFile(join(data, 'email-outbox.jsonl'), seal({ ...message, simulatedAt: new Date().toISOString() }, emailKey) + '\n', { mode: 0o600 });
    return { state: 'queued' };
  } } });
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  // Reject DNS rebinding and cross-site requests; listen on IPv4 loopback only.
  if (req.headers.host !== host || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); res.end(); return; }
  try {
    const path = new URL(req.url, origin).pathname;
    if (path === '/api/waitlist') return await waitlist(req, res);
    if (path.startsWith('/api/access-admin/') || path.startsWith('/api/trials/')) return await trials(req, res);
    if (path === '/api/dry-run/emails') {
      const actual = createHash('sha256').update(req.headers.authorization ?? '').digest();
      const expected = createHash('sha256').update(`Bearer ${operatorToken}`).digest();
      if (req.method !== 'GET' || !timingSafeEqual(actual, expected)) { res.writeHead(401); res.end(); return; }
      // The normal Review invitation action is the user-facing email preview.
      const source = await readFile(join(data, 'email-outbox.jsonl'), 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ simulated: true, count: source.split('\n').filter(Boolean).length })); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const file = resolve(root, '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
    const rel = relative(root, file), type = mime[extname(file)];
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || !type) { res.writeHead(404); res.end(); return; }
    let content = await readFile(file);
    if (extname(file) === '.html') content = Buffer.from(content.toString().replace('<body>', '<body><aside style="padding:12px;background:#f8d67a;color:#111;text-align:center;font:600 15px system-ui">LOCAL DRY RUN · Emails are saved locally, never sent. Use fictitious details.</aside>'));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
server.on('error', error => { console.error(`Local dry run: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', async () => {
  await writeFile(join(data, 'host.json'), JSON.stringify({ pid: process.pid, origin, startedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
  console.log(`Local public site and trial API: ${origin}/get-started.html\nOperator inbox: ${origin}/access-admin.html\nOperator key file: ${join(work, 'operator-token')}\nEmail: local simulation only. Existing data is preserved.`);
});
