const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.origin !== env.PUBLIC_INTAKE_ORIGIN) return new Response('{}', { status: 403, headers });
  if (url.pathname === '/api/waitlist') return env.INTAKE.fetch(request);
  if (url.pathname.startsWith('/api/')) return new Response('{"error":"not_found"}', { status: 404, headers });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('{}', { status: 405, headers });
  // New host, same invitation credential and installation. API calls are never forwarded.
  if (env.CUSTOMER_ORIGIN && ['/trial', '/trial.html', '/billing', '/billing.html'].includes(url.pathname)) {
    const target = new URL(url.pathname.replace(/\.html$/, '') + url.search, env.CUSTOMER_ORIGIN);
    return new Response(null, { status: 302, headers: { ...headers, 'Referrer-Policy': 'no-referrer', Location: target.href } });
  }
  return env.ASSETS.fetch(request);
} };
