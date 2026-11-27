import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { createLocalSites, defaultOrigins, validateOrigins, validatePreviewDirectory } from './local.mjs';
import { stageSite, siteAssets, repository } from './assets.mjs';
import { verifyLicenseFile } from '../../apps/server/src/license-status.mjs';

test('purchase preview links to local signup and keeps checkout disabled', async t => {
  const directory = await mkdtemp(join(tmpdir(), '127v-signup-preview-'));
  const local = await createLocalSites({ directory, purchasePreview: true });
  t.after(async () => { await local.close(); await rm(directory, { recursive: true, force: true }); });
  const pricing = await (await local.request('public', '/pricing')).text();
  assert.ok(pricing.includes(`${local.origins.customer}/portal?subscribe=personal`));
  const portal = await (await local.request('customer', '/portal?subscribe=personal')).text();
  assert.ok(portal.indexOf('id="portal-signup"') < portal.indexOf('id="portal-existing-title"'));
  assert.ok(portal.indexOf('id="portal-existing-title"') < portal.indexOf('id="portal-login"'));
  assert.match(portal, /Sign up with email/);
  const checkout = await local.request('customer', '/api/billing/personal-order', {
    method: 'POST', headers: { Origin: local.origins.customer, 'Content-Type': 'application/json' }, body: JSON.stringify({ acceptTerms: true }),
  });
  assert.equal(checkout.status, 404);
});

test('live Personal signup unifies trials and subscriptions while retaining Commercial intake', async t => {
  const dir = await mkdtemp(join(tmpdir(), '127v-live-plans-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const live = await stageSite('public', join(dir, 'live'), {
    personalBuyUrl: 'https://manage.example.com/portal', personalSubscriptionTrial: true,
  });
  for (const name of ['index.html', 'pricing.html']) {
    const html = await readFile(join(live.directory,name),'utf8');
    assert.match(html, /class="plan-cta" href="https:\/\/manage.example.com\/portal">Subscribe now/);
    assert.doesNotMatch(html, /Request trial access/);
    const personal = [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)].find(match => match[0].includes('Subscribe now'))?.[0];
    assert.ok(personal);
    assert.ok(personal.indexOf('Subscribe now') < personal.indexOf('Five users included'));
    assert.ok(personal.indexOf('Five users included') < personal.indexOf('<ul>'));
    if (name === 'index.html') {
      assert.match(html, /class="button primary" data-personal-subscribe href="https:\/\/manage.example.com\/portal">Subscribe to Personal/);
      assert.match(html, /<summary aria-label="More subscription options">/);
      assert.match(html, /plan=commercial">Request Commercial Access<\/a>/);
      assert.doesNotMatch(html, />Get access<\/a>/);
    }
    assert.match(html, /plan=commercial">Request access/);
  }
  const downloads = await readFile(join(live.directory,'downloads.html'),'utf8');
  assert.match(downloads,/Subscribe to Personal/);
  assert.match(downloads,/Manage downloads/);
  const access = await readFile(join(live.directory, 'get-started.html'), 'utf8');
  assert.doesNotMatch(access, /name="plan" value="personal"/);
  assert.match(access, /name="plan" value="commercial" checked/);
  const testBuild = await stageSite('public',join(dir,'test'));
  const testPricing = await readFile(join(testBuild.directory,'pricing.html'),'utf8');
  assert.doesNotMatch(testPricing,/Subscribe now/);
  assert.match(testPricing,/plan=personal">Request access/);
});

test('separate site builds contain only their own executable pages and modules', async t => {
  const dir = await mkdtemp(join(tmpdir(), '127v-site-assets-')); t.after(() => rm(dir, { recursive: true, force: true }));
  for (const surface of ['public', 'admin', 'customer']) {
    const built = await stageSite(surface, join(dir, surface), { publicOrigin: defaultOrigins.public }), files = await readdir(built.directory);
    for (const file of siteAssets[surface]) assert.ok(files.includes(file));
    for (const file of files.filter(v => /\.(?:html|mjs)$/.test(v))) {
      const source = await readFile(join(built.directory, file), 'utf8');
      if (surface !== 'admin') assert.ok(!source.includes('/api/access-admin/'), `${surface}/${file} includes operator code`);
      if (surface !== 'public' && file.endsWith('.html')) for (const [, href] of source.matchAll(/href="([^"]+)"/g)) {
        if (href.startsWith('#') || /^https?:/.test(href)) continue;
        const path = href.split(/[?#]/)[0].replace(/^\//, '');
        assert.ok(!path || files.includes(path) || files.includes(`${path}.html`), `Broken local link: ${surface}/${file}: ${href}`);
      }
      assert.ok(!/https?:\/\/[^\s"']+\.(?:mjs|css)/.test(source), 'Site must not fetch executable assets from another origin');
    }
    if (surface === 'public') for (const name of ['access-admin.html', 'access-admin.mjs', 'billing-admin.mjs', 'trial.html', 'trial.mjs', 'billing.html', 'releases.mjs']) assert.ok(!files.includes(name));
    if (surface === 'admin') for (const name of ['get-started.html', 'access.mjs', 'trial.mjs', 'billing.mjs']) assert.ok(!files.includes(name));
  }
});
test('local site configuration uses separate host cookies and refuses non-loopback origins', () => {
  assert.deepEqual(validateOrigins(defaultOrigins), defaultOrigins);
  assert.throws(() => validateOrigins({ ...defaultOrigins, admin: 'http://localhost:12952' }));
  assert.throws(() => validateOrigins({ ...defaultOrigins, public: 'https://public.example.com' }));
  assert.throws(() => validateOrigins({ ...defaultOrigins, admin: 'http://localhost:12951' }));
  for (const path of [repository, join(repository, '..'), join(repository, 'public-website'), join(repository, '.tools')]) assert.throws(() => validatePreviewDirectory(path));
  assert.equal(validatePreviewDirectory(join(repository, '.tools', 'site-preview')), join(repository, '.tools', 'site-preview'));
});

test('local HTTP listeners bind only loopback and enforce their own Host, pages and API boundary', async t => {
  const ports = await Promise.all(Array.from({ length: 3 }, async () => {
    const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done)); return server;
  }));
  const origins = Object.fromEntries(Object.entries(defaultOrigins).map(([surface, origin], index) => {
    const url = new URL(origin); url.port = String(ports[index].address().port); return [surface, url.origin];
  }));
  await Promise.all(ports.map(server => new Promise(done => server.close(done))));
  const dir = await mkdtemp(join(tmpdir(), '127v-site-http-')); let local;
  t.after(async () => { await local?.close(); await rm(dir, { recursive: true, force: true }); });
  local = await createLocalSites({ directory: dir, origins }); await local.listen();
  // Connect to the listener's actual bind address while preserving each
  // virtual host. Windows name resolution can send *.localhost to IPv6.
  const request = (surface, path = '/', { method = 'GET', headers = {}, body } = {}) => {
    const url = new URL(origins[surface]);
    return new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: url.port, path, method,
        headers: { Host: url.host, ...headers } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Loopback HTTP request timed out')));
      req.end(body);
    });
  };
  const home = await request('admin'); assert.equal(home.status, 200); assert.match(home.body, /127Vaults Admin/);
  for (const surface of ['public', 'customer']) {
    const wrongSurface = await request('admin', '/', { headers: { Host: new URL(origins[surface]).host } });
    assert.equal(wrongSurface.status, 403);
  }
  const wrongHost = await request('public', '/', { headers: { Host: 'malicious.example.com' } });
  assert.equal(wrongHost.status, 403);
  assert.equal((await request('public', '/access-admin')).status, 404);
  assert.equal((await request('admin', '/trial')).status, 404);
  assert.equal((await request('customer', '/access-admin')).status, 404);
  const input = { email: 'http@example.com', plan: 'personal', requestedSeats: 2, consent: true, organization: '', website: '' };
  const submitted = await request('public', '/api/waitlist', { method: 'POST', headers: { Origin: origins.public, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(submitted.status, 202, submitted.body);
  const inbox = await request('admin', '/api/access-admin/requests', { headers: { Authorization: `Bearer ${local.operatorToken}` } });
  assert.equal(inbox.status, 200); assert.equal(JSON.parse(inbox.body).requests[0].email, input.email);
});
test('local public request reaches the private admin; public and customer routes reject all operator capabilities', async t => {
  const dir = await mkdtemp(join(tmpdir(), '127v-local-sites-')); let resumed;
  const local = await createLocalSites({ directory: dir });
  t.after(async () => { await resumed?.close(); await local.close(); await rm(dir, { recursive: true, force: true }); });
  const post = (surface, path, value, token, origin = local.origins[surface]) => local.request(surface, path, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(value) });
  const get = (surface, path, token, cookie) => local.request(surface, path, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
  for (const path of ['/', '/get-started', '/access.mjs']) assert.equal((await get('public', path)).status, 200, path);
  for (const path of ['/access-admin', '/access-admin.html', '/access-admin.mjs', '/billing-admin.mjs', '/releases', '/trial', '/billing', '/api/access-admin/session', '/api/access-admin/requests', '/api/access-admin/billing/plans']) {
    assert.equal((await get('public', path, local.operatorToken)).status, 404, path);
  }
  for (const path of ['/api/access-admin/requests', '/api/access-admin/releases', '/api/access-admin/billing/plans']) assert.equal((await get('customer', path, local.operatorToken)).status, 404, path);
  assert.equal((await get('admin', '/api/waitlist')).status, 404);
  assert.equal((await get('customer', '/api/waitlist')).status, 404);
  const adminPage = await get('admin', '/'); assert.equal(adminPage.status, 200, await adminPage.clone().text());
  for (const page of ['/licenses', '/subscriptions', '/coupons', '/admin-shell.mjs', '/admin.css']) {
    assert.equal((await get('admin', page)).status, 200, page);
    assert.equal((await get('public', page)).status, 404, page);
    assert.equal((await get('customer', page)).status, 404, page);
  }
  const reviewPage = await get('admin', '/releases'); assert.equal(reviewPage.status, 200, await reviewPage.clone().text());
  assert.equal((await get('admin', '/api/access-admin/requests')).status, 401);
  const submission = { email: 'local-review@example.com', plan: 'commercial', organization: 'Local test', contactName: 'Local user', requestedSeats: 3, consent: true, website: '' };
  assert.equal((await post('public', '/api/waitlist', submission, undefined, local.origins.admin)).status, 403);
  const submitted = await post('public', '/api/waitlist', submission); assert.equal(submitted.status, 202, await submitted.clone().text());
  const login = await post('admin', '/api/access-admin/session', {}, local.operatorToken);
  assert.equal(login.status, 200, await login.clone().text()); const cookie = login.headers.get('set-cookie'); assert.ok(cookie.includes('HttpOnly')); assert.ok(!cookie.includes('Domain='));
  const inbox = await get('admin', '/api/access-admin/requests', null, cookie); assert.equal(inbox.status, 200, await inbox.clone().text());
  const requests = (await inbox.json()).requests; assert.equal(requests.length, 1); assert.equal(requests[0].email, submission.email);
  assert.equal((await post('admin', '/api/access-admin/session', {}, local.operatorToken, local.origins.public)).status, 403);
  assert.equal((await get('public', '/api/access-admin/requests', null, cookie)).status, 404);
  const id = requests[0].id;
  const approve = await post('admin', `/api/access-admin/requests/${id}/approve`, { maxUsers: 3 }, local.operatorToken);
  assert.equal(approve.status, 200, await approve.clone().text()); const invitation = await approve.json();
  assert.equal(new URL(invitation.link).origin, local.origins.customer); const token = invitation.link.split('.').at(-1);
  const base = `/api/trials/${id}`, installationId = randomUUID();
  assert.equal((await get('admin', base, token)).status, 404);
  assert.equal((await get('public', base, token)).status, 404);
  assert.equal((await get('customer', base, token)).status, 200);
  const active = await post('customer', `${base}/activate`, { installationId }, token); assert.equal(active.status, 200, await active.clone().text());
  const source = await (await get('customer', `${base}/license`, token)).text();
  const keys = JSON.parse(await (await get('customer', `${base}/public-keys`, token)).text());
  assert.equal(verifyLicenseFile(source, keys, installationId).maxActiveUsers, 3);
  const packages = await get('admin', '/api/access-admin/releases', null, cookie); assert.equal(packages.status, 200);
  const download = await get('admin', '/api/access-admin/releases/artifacts/server', null, cookie); assert.equal(download.status, 200);
  assert.ok((await download.text()).includes('not an installable server package'));
  await local.close();
  resumed = await createLocalSites({ directory: dir });
  const restored = await resumed.request('admin', '/api/access-admin/requests', { headers: { Authorization: `Bearer ${local.operatorToken}` } });
  assert.equal(restored.status, 200); assert.equal((await restored.json()).requests[0].installationId, installationId);
});
