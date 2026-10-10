const filters = {
  users: { status: ['pending', 'active'], role: ['owner', 'admin', 'user'] },
  devices: { status: ['pending', 'active', 'revoked', 'replaced'], protection: ['unknown', 'software', 'platform', 'hardware'] },
  invitations: { status: ['pending', 'expired', 'revoked', 'redeemed'] },
};
const sorts = {
  users: { newest: 'a.created_at DESC,a.id,a.tenant_id', oldest: 'a.created_at ASC,a.id,a.tenant_id', username: 'a.username_key,a.id,a.tenant_id' },
  devices: { newest: 'd.created_at DESC,d.id,d.tenant_id', oldest: 'd.created_at ASC,d.id,d.tenant_id', account: 'a.username_key,d.created_at DESC,d.id,d.tenant_id' },
  invitations: { newest: 'r.created_at DESC,r.id,e.email,r.tenant_id', oldest: 'r.created_at ASC,r.id,e.email,r.tenant_id', expires: 'r.expires_at ASC,r.id,e.email,r.tenant_id', email: 'lower(e.email) COLLATE "C",r.created_at DESC,r.id,e.email,r.tenant_id' },
};

export class DirectoryInputError extends Error {}

export function directoryInput(params, kind) {
  const allowed = ['q', 'page', 'pageSize', 'sort', ...Object.keys(filters[kind]), ...(kind === 'devices' ? ['accountId'] : [])];
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
  const sort = params.get('sort') ?? 'newest';
  if (!Object.hasOwn(sorts[kind], sort)) throw new DirectoryInputError('Invalid sort.');
  const input = { q, page: integer('page', 1, 1_000_000), pageSize: integer('pageSize', 25, 100), sort };
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
  const invitationStatus = "CASE WHEN e.redeemed_at IS NOT NULL THEN 'redeemed' WHEN r.revoked_at IS NOT NULL THEN 'revoked' WHEN r.expires_at <= now() THEN 'expired' ELSE 'pending' END";
  const from = kind === 'users' ? 'vaults.accounts a' : kind === 'devices'
    ? 'vaults.devices d JOIN vaults.accounts a ON a.tenant_id=d.tenant_id AND a.id=d.account_id'
    : 'vaults.invitation_records r JOIN vaults.invitation_emails e ON e.tenant_id=r.tenant_id AND e.id=r.id JOIN vaults.accounts a ON a.tenant_id=r.tenant_id AND a.id=r.created_by';
  if (input.q) add(kind === 'users'
    ? "position(lower(?) in lower(concat_ws(' ',a.username,a.display_name,a.email,a.id::text))) > 0"
    : kind === 'devices' ? "position(lower(?) in lower(concat_ws(' ',d.id::text,a.username,a.display_name))) > 0"
    : "position(lower(?) in lower(concat_ws(' ',e.email,a.username,r.id::text))) > 0", input.q);
  if (input.status) add(kind === 'users' ? 'a.enrollment_state=?' : kind === 'devices' ? 'd.lifecycle_status=?' : `${invitationStatus}=?`, input.status);
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
    : kind === 'devices' ? 'd.id,d.account_id,a.username,a.display_name,d.lifecycle_status,d.protection_class,d.credential_state,d.created_at,d.revoked_at'
    : `r.id,e.email,a.username AS created_by,r.created_at,r.expires_at,r.revoked_at,e.redeemed_at,${invitationStatus} AS status`;
  const order = sorts[kind][input.sort];
  const rows = await pool.query(`SELECT ${fields} FROM ${from}${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, input.pageSize, offset]);
  const items = rows.rows.map(r => kind === 'users'
    ? { id: r.id, username: r.username, displayName: r.display_name, email: r.email, role: r.server_role, status: r.enrollment_state, emailVerified: r.email_verified, createdAt: r.created_at, deviceCount: r.device_count }
    : kind === 'devices' ? { id: r.id, accountId: r.account_id, username: r.username, displayName: r.display_name, status: r.lifecycle_status, protection: r.protection_class, credentialState: r.credential_state, createdAt: r.created_at, revokedAt: r.revoked_at }
    : { id: r.id, email: r.email, createdBy: r.created_by, status: r.status, createdAt: r.created_at, expiresAt: r.expires_at, revokedAt: r.revoked_at, redeemedAt: r.redeemed_at });
  return { [kind]: items, total, page, pageSize: input.pageSize, pageCount, hasPrevious: page > 1, hasNext: page < pageCount };
}
