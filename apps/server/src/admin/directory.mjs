const filters = {
  users: { status: ['pending', 'active'], role: ['owner', 'admin', 'user'] },
  devices: { status: ['pending', 'active', 'revoked', 'replaced'], protection: ['unknown', 'software', 'platform', 'hardware'] },
};

export class DirectoryInputError extends Error {}

export function directoryInput(params, kind) {
  const allowed = ['q', 'page', 'pageSize', ...Object.keys(filters[kind]), ...(kind === 'devices' ? ['accountId'] : [])];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new DirectoryInputError('Invalid directory filter.');
  }
  const integer = (name, fallback, maximum) => {
    const value = params.get(name);
    if (value === null) return fallback;
    if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum) throw new DirectoryInputError(`Invalid ${name}.`);
    return Number(value);
  };
  const q = (params.get('q') ?? '').trim();
  if (q.length > 120 || /[\u0000-\u001f\u007f]/.test(q)) throw new DirectoryInputError('Invalid search.');
  const input = { q, page: integer('page', 1, 1_000_000), pageSize: integer('pageSize', 25, 100) };
  for (const [key, values] of Object.entries(filters[kind])) {
    const value = params.get(key) ?? '';
    if (value && !values.includes(value)) throw new DirectoryInputError(`Invalid ${key}.`);
    input[key] = value;
  }
  if (kind === 'devices') {
    input.accountId = params.get('accountId') ?? '';
    if (input.accountId && !/^[a-zA-Z0-9-]{1,128}$/.test(input.accountId)) throw new DirectoryInputError('Invalid account.');
  }
  return input;
}

export async function readDirectory(pool, kind, input) {
  const values = [];
  const conditions = [];
  const add = (expression, value) => {
    values.push(value);
    conditions.push(expression.replace('?', `$${values.length}`));
  };
  const from = kind === 'users' ? 'vaults.accounts a' : 'vaults.devices d JOIN vaults.accounts a ON a.tenant_id=d.tenant_id AND a.id=d.account_id';
  if (input.q) add(kind === 'users'
    ? "position(lower(?) in lower(concat_ws(' ',a.username,a.display_name,a.email,a.id::text))) > 0"
    : "position(lower(?) in lower(concat_ws(' ',d.id::text,a.username,a.display_name))) > 0", input.q);
  if (input.status) add(kind === 'users' ? 'a.enrollment_state=?' : 'd.lifecycle_status=?', input.status);
  if (input.role) add('a.server_role=?', input.role);
  if (input.protection) add('d.protection_class=?', input.protection);
  if (input.accountId) add('d.account_id::text=?', input.accountId);
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const count = await pool.query(`SELECT count(*)::int AS total FROM ${from}${where}`, values);
  const total = count.rows[0].total;
  const pageCount = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, pageCount);
  const offset = (page - 1) * input.pageSize;
  const fields = kind === 'users'
    ? `a.id,a.username,a.display_name,a.email,a.server_role,a.enrollment_state,a.email_verified,a.created_at,
      (SELECT count(*)::int FROM vaults.devices d WHERE d.tenant_id=a.tenant_id AND d.account_id=a.id AND d.lifecycle_status='active') AS device_count`
    : 'd.id,d.account_id,a.username,a.display_name,d.lifecycle_status,d.protection_class,d.credential_state,d.created_at,d.revoked_at';
  const order = kind === 'users' ? 'a.created_at DESC,a.id,a.tenant_id' : 'd.created_at DESC,d.id,d.tenant_id';
  const rows = await pool.query(`SELECT ${fields} FROM ${from}${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, input.pageSize, offset]);
  const items = rows.rows.map(r => kind === 'users'
    ? { id: r.id, username: r.username, displayName: r.display_name, email: r.email, role: r.server_role, status: r.enrollment_state, emailVerified: r.email_verified, createdAt: r.created_at, deviceCount: r.device_count }
    : { id: r.id, accountId: r.account_id, username: r.username, displayName: r.display_name, status: r.lifecycle_status, protection: r.protection_class, credentialState: r.credential_state, createdAt: r.created_at, revokedAt: r.revoked_at });
  return { [kind]: items, total, page, pageSize: input.pageSize, pageCount, hasPrevious: page > 1, hasNext: page < pageCount };
}
