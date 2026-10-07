import { OnboardingError } from './onboarding.mjs';

// Called while the onboarding transaction holds the installation's advisory lock.
// Unredeemed, live invitation emails reserve seats until redeemed, revoked, or expired.
export async function readSeatUsage(client, tenantId, now) {
  const result = await client.query(`SELECT
    (SELECT count(*)::int FROM vaults.accounts WHERE tenant_id=$1 AND enrollment_state='active') AS active_users,
    (SELECT count(*)::int FROM vaults.invitation_emails e
      JOIN vaults.invitation_records i USING (tenant_id,id)
      WHERE e.tenant_id=$1 AND e.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>$2) AS reserved_seats`,
  [tenantId, now]);
  const row = result.rows[0];
  const activeUsers = Number(row?.active_users);
  const reservedSeats = Number(row?.reserved_seats);
  if (!Number.isSafeInteger(activeUsers) || activeUsers < 0
    || !Number.isSafeInteger(reservedSeats) || reservedSeats < 0) throw Error('seat_usage_unavailable');
  return { activeUsers, reservedSeats };
}

export async function requireLicenseSeats(client, tenantId, additions, now, loadEntitlement) {
  if (!loadEntitlement) return;
  let entitlement;
  try { entitlement = await loadEntitlement(tenantId, now); }
  catch { throw new OnboardingError('license_unavailable', 503); }
  if (entitlement.mode === 'experimental') return;
  if (entitlement.mode !== 'active') throw new OnboardingError('license_inactive', 403);
  const usage = await readSeatUsage(client, tenantId, now);
  if (!Number.isSafeInteger(entitlement.maxActiveUsers)
    || usage.activeUsers + usage.reservedSeats + additions > entitlement.maxActiveUsers) {
    throw new OnboardingError('seat_limit_reached', 409);
  }
}
