const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.origin !== env.PUBLIC_INTAKE_ORIGIN) return new Response('{}', { status: 403, headers });
  if (url.pathname === '/api/waitlist') return env.INTAKE.fetch(request);
  if (url.pathname.startsWith('/api/')) return new Response('{"error":"not_found"}', { status: 404, headers });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('{}', { status: 405, headers });
  return env.ASSETS.fetch(request);
} };
