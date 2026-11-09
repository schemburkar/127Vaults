import { readFile } from 'node:fs/promises';
import { HttpBoundaryError } from '../src/http-boundary.mjs';

export const cloudLandingHost = 'cloud.127vaults.com';
const pages = new Map([
  ['/', ['landing.html', 'text/html; charset=utf-8']],
  ['/landing.css', ['landing.css', 'text/css; charset=utf-8']]
]);

export async function serveCloudLanding(req, res) {
  const page = pages.get(req.url);
  if (!page) throw new HttpBoundaryError(404, 'not_found');
  if (!['GET', 'HEAD'].includes(req.method)) throw new HttpBoundaryError(405, 'method_not_allowed');
  const [file, contentType] = page;
  const bytes = await readFile(new URL(file, import.meta.url));
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow'
  });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}
