// Reserve outside the caller's transaction: invalid requests must also count.
export async function reserveSecurityRequest(pool, { tenantId, purpose, source, now = new Date(), limit = 10 }) {
  if (typeof source !== 'string' || source.length < 1 || Buffer.byteLength(source) > 128) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,127))', [`security:${tenantId}:${purpose}:${source}`]);
    await client.query("DELETE FROM vaults.security_request_limits WHERE tenant_id=$1 AND purpose=$2 AND source=$3 AND created_at<$4::timestamptz-interval '1 minute'", [tenantId,purpose,source,now]);
    const count = (await client.query('SELECT count(*)::int n FROM vaults.security_request_limits WHERE tenant_id=$1 AND purpose=$2 AND source=$3', [tenantId,purpose,source])).rows[0].n;
    if (count >= limit) { await client.query('COMMIT'); return false; }
    await client.query('INSERT INTO vaults.security_request_limits(tenant_id,purpose,source,created_at) VALUES($1,$2,$3,$4)', [tenantId,purpose,source,now]);
    // Remove idle-source buckets too, without retaining IP addresses indefinitely.
    await client.query("DELETE FROM vaults.security_request_limits WHERE tenant_id=$2 AND created_at<$1::timestamptz-interval '1 hour'", [now,tenantId]);
    await client.query('COMMIT');
    return true;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
