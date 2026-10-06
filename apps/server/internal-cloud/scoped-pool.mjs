// Internal Cloud data-access adapter. Construct one instance from a tenant
// resolved by the trusted request boundary; never from a client JSON field.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const tenantSetting = "SELECT set_config('vaults.tenant_id',$1,true)";

function assertTenant(tenantId) {
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) throw new Error('Verified tenant UUID required.');
}

function command(sql) {
  if (typeof sql !== 'string') throw new Error('Cloud SQL must be a text query.');
  return sql.trim().toUpperCase();
}

export function createTenantScopedPool(basePool, tenantId) {
  assertTenant(tenantId);
  if (typeof basePool?.connect !== 'function') throw new Error('Cloud database pool required.');
  return Object.freeze({
    async query(sql, values) {
      const cmd = command(sql);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(cmd)) throw new Error('Transaction control requires a scoped connection.');
      const client = await basePool.connect();
      let destroy = false;
      try {
        await client.query('BEGIN');
        await client.query(tenantSetting, [tenantId]);
        const result = await client.query(sql, values);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); }
        catch { destroy = true; }
        throw error;
      } finally {
        client.release(destroy);
      }
    },
    async connect() {
      const client = await basePool.connect();
      let state = 'idle';
      let busy = false;
      return Object.freeze({
        async query(sql, values) {
          const cmd = command(sql);
          if (state === 'closed') throw new Error('Cloud connection is released.');
          if (busy) throw new Error('Concurrent Cloud queries on one connection are unavailable.');
          busy = true;
          try {
            if (cmd === 'BEGIN') {
              if (state !== 'idle') throw new Error('Cloud transaction already started.');
              try { await client.query('BEGIN'); }
              catch (error) { state = 'poisoned'; throw error; }
              state = 'active';
              try { await client.query(tenantSetting, [tenantId]); }
              catch (error) {
                try { await client.query('ROLLBACK'); state = 'idle'; }
                catch { state = 'poisoned'; }
                throw error;
              }
              return { rows: [], rowCount: null };
            }
            if (cmd === 'COMMIT' || cmd === 'ROLLBACK') {
              if (state !== 'active') throw new Error('Cloud transaction is not active.');
              const result = await client.query(cmd);
              state = 'idle';
              return result;
            }
            if (state !== 'active') throw new Error('Cloud query requires an active tenant transaction.');
            return await client.query(sql, values);
          } finally { busy = false; }
        },
        release() {
          if (state === 'closed') return;
          const unfinished = state !== 'idle' || busy;
          state = 'closed';
          // A pool client with an unfinished transaction must be destroyed,
          // never returned for another tenant's request.
          client.release(unfinished);
        }
      });
    }
  });
}

export async function verifyCloudRuntimeRole(pool) {
  const result = await pool.query(`SELECT r.rolcanlogin,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication,
    current_user=session_user AS is_login_identity,
    pg_has_role(current_user,'vaults_cloud_runtime','USAGE') AS has_runtime_role,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped
      WHERE n.nspname='vaults' AND c.relowner=r.oid) AS owns_tenant_table,
    EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid
      WHERE m.member=r.oid AND parent.rolname<>'vaults_cloud_runtime') AS has_extra_role
    FROM pg_roles r WHERE r.rolname=current_user`);
  const role = result.rows[0];
  if (!role || !role.rolcanlogin || role.rolsuper || role.rolbypassrls || role.rolcreatedb ||
      role.rolcreaterole || role.rolreplication || !role.is_login_identity || !role.has_runtime_role ||
      role.owns_tenant_table || role.has_extra_role) throw new Error('Unsafe Cloud database login role.');
}
