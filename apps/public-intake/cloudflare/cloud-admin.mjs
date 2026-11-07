const encoder = new TextEncoder();
const decoder = new TextDecoder();
const commands = new Set(['list', 'provision', 'issue-setup', 'activate', 'suspend', 'resume', 'set-seats']);
const tokenPart = /^[A-Za-z0-9_-]+$/;
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
const reply = (status, value) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } });

async function verifyOperator(request, env, fetchImpl) {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every(part => tokenPart.test(part))) return null;
  const [headerPart, claimsPart, signaturePart] = parts;
  const header = JSON.parse(decoder.decode(decode(headerPart)));
  const claims = JSON.parse(decoder.decode(decode(claimsPart)));
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || claims.iss !== env.CLOUD_ADMIN_ACCESS_ISSUER ||
      !Array.isArray(claims.aud) || !claims.aud.includes(env.CLOUD_ADMIN_ACCESS_AUDIENCE) || claims.type !== 'app' ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= now ||
      (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now)) ||
      !Array.isArray(claims.custom?.amr) || !claims.custom.amr.includes('mfa') || typeof claims.email !== 'string' ||
      !env.CLOUD_ADMIN_OPERATORS.split(',').includes(claims.email.toLowerCase()) ||
      !/^[A-Za-z0-9][A-Za-z0-9_:@.-]{0,127}$/.test(claims.sub ?? '') || typeof claims.sub !== 'string') return null;

  const response = await fetchImpl(`${env.CLOUD_ADMIN_ACCESS_ISSUER}/cdn-cgi/access/certs`, {
    redirect: 'error', signal: AbortSignal.timeout(5000), cf: { cacheEverything: true, cacheTtl: 60 }
  });
  if (!response.ok) return null;
  const { keys } = await response.json();
  const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) return null;
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
  return await crypto.subtle.verify(algorithm, key, decode(signaturePart), encoder.encode(`${headerPart}.${claimsPart}`)) ? claims.sub : null;
}

export async function handleCloudAdmin(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  const command = /^\/cloud-tenants\/api\/([a-z-]+)$/.exec(url.pathname)?.[1];
  if (!commands.has(command) || url.origin !== env.ADMIN_ORIGIN) return reply(404, { error: 'not_found' });
  if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
  if (request.headers.get('origin') !== url.origin || request.headers.get('content-type') !== 'application/json') {
    return reply(403, { error: 'forbidden' });
  }
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.CLOUD_ADMIN_ACCESS_ISSUER ?? '') ||
      !/^[a-f0-9]{64}$/.test(env.CLOUD_ADMIN_ACCESS_AUDIENCE ?? '') || !env.CLOUD_ADMIN_OPERATORS ||
      !/^https:\/\/[a-z0-9.-]+$/.test(env.CLOUD_MANAGEMENT_ORIGIN ?? '') || !/^[a-f0-9]{64}$/.test(env.CLOUD_MANAGEMENT_TOKEN ?? '') ||
      !env.CLOUD_MANAGEMENT_ACCESS_ID || !env.CLOUD_MANAGEMENT_ACCESS_SECRET) {
    return reply(503, { error: 'cloud_unavailable' });
  }
  const actor = await verifyOperator(request, env, fetchImpl).catch(() => null);
  if (!actor) return reply(403, { error: 'cloud_operator_required' });
  try {
    const upstream = await fetchImpl(`${env.CLOUD_MANAGEMENT_ORIGIN}/internal/cloud/v1/${command}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000), body: request.body,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.CLOUD_MANAGEMENT_TOKEN}`, 'X-127V-Operator': actor,
        'CF-Access-Client-Id': env.CLOUD_MANAGEMENT_ACCESS_ID, 'CF-Access-Client-Secret': env.CLOUD_MANAGEMENT_ACCESS_SECRET }
    });
    if (![200, 400, 409, 413, 415].includes(upstream.status)) return reply(503, { error: 'cloud_unavailable' });
    return reply(upstream.status, await upstream.json());
  } catch { return reply(503, { error: 'cloud_unavailable' }); }
}
