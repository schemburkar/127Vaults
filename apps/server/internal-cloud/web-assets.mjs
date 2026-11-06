import { readFile } from 'node:fs/promises';

const contentTypes = new Map([
  ['html', 'text/html; charset=utf-8'], ['css', 'text/css; charset=utf-8'],
  ['js', 'text/javascript; charset=utf-8'], ['mjs', 'text/javascript; charset=utf-8'],
  ['svg', 'image/svg+xml'], ['png', 'image/png'], ['webmanifest', 'application/manifest+json'], ['wasm', 'application/wasm']
]);

export const cloudWebAssets = {
  match(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return null;
    const path = req.url?.split('?')[0];
    if (path === '/') return 'index.html';
    if (!/^\/(?:brand-mark\.svg|wordmark\.svg|manifest\.webmanifest|sw\.js|icons\/[\w-]+\.png|(?:app|wasm)\/(?:[\w-]+\/)*[\w-]+\.(?:js|mjs|css|wasm))$/.test(path ?? '')) return null;
    return path.slice(1);
  },
  async serve(req, res, asset) {
    const data = await readFile(new URL(`../../web/dist/${asset}`, import.meta.url));
    res.writeHead(200, {
      'Content-Type': contentTypes.get(asset.split('.').at(-1)),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; manifest-src 'self'; style-src 'self'; connect-src 'self' https://api.pwnedpasswords.com; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }
};
