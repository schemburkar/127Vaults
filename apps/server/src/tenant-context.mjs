// Shared Cloud boundary primitives. No caller may treat a client tenant field
// or a proxy-supplied hostname as an authenticated tenant context.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DNS = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function cloudTenantDirectory(rows, region) {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(region)) throw new Error('Invalid region.');
  const byHost = new Map();
  const byId = new Set();
  for (const row of rows) {
    const id = row?.id?.toLowerCase();
    const host = row?.host?.toLowerCase();
    if (!UUID.test(id ?? '') || !DNS.test(host ?? '') || row.region !== region ||
        !['reserved', 'prepared', 'active', 'suspended', 'deleting'].includes(row.state) || byHost.has(host) || byId.has(id)) {
      throw new Error('Invalid regional tenant directory.');
    }
    byHost.set(host, Object.freeze({ id, host, region, state: row.state }));
    byId.add(id);
  }
  return Object.freeze({ region, lookup: host => byHost.get(host) });
}

export function cloudRequestHost(request) {
  const hosts = request.rawHeaders?.filter((_, i) => i % 2 === 1 &&
    request.rawHeaders[i - 1].toLowerCase() === 'host') ?? [];
  if (hosts.length !== 1 || hosts[0] !== request.headers?.host ||
      Object.keys(request.headers).some(k => k === 'forwarded' || k.startsWith('x-forwarded-'))) {
    throw new Error('Invalid request authority.');
  }
  const host = hosts[0].toLowerCase();
  if (!DNS.test(host) || host !== hosts[0]) throw new Error('Invalid request authority.');
  const origin = `https://${host}`;
  if (request.headers.origin !== undefined && request.headers.origin !== origin) {
    throw new Error('Invalid request origin.');
  }
  return host;
}

export function resolveCloudTenant(request, directory) {
  const host = cloudRequestHost(request);
  const tenant = directory.lookup(host);
  if (!tenant || tenant.state !== 'active') throw new Error('Unknown or inactive tenant.');
  return tenant;
}

export function requireTenantPrincipal(tenant, principal) {
  if (!tenant || !principal || principal.tenantId !== tenant.id ||
      !UUID.test(principal.accountId ?? '') || !UUID.test(principal.deviceId ?? '')) {
    throw new Error('Tenant principal mismatch.');
  }
  return principal;
}

export async function withTenantTransaction(pool, tenantId, action) {
  if (!UUID.test(tenantId ?? '') || typeof action !== 'function') throw new Error('Invalid tenant transaction.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // set_config(..., true) is transaction-local, so pooled connections cannot
    // retain tenant identity after COMMIT or ROLLBACK.
    await client.query("SELECT set_config('vaults.tenant_id', $1, true)", [tenantId]);
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
