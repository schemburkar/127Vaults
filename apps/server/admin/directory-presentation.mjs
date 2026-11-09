const labels = new Map([
  ['active', 'Active'], ['suspended', 'Suspended'], ['pending', 'Pending'],
  ['owner', 'Owner'], ['admin', 'Admin'], ['user', 'Member'],
  ['redeemed', 'Accepted'], ['revoked', 'Revoked'], ['expired', 'Expired']
]);

export function directoryStatus(value) {
  const tone = ['active', 'owner', 'redeemed'].includes(value) ? 'good'
    : ['pending', 'suspended', 'expired'].includes(value) ? 'warn' : '';
  return { label: labels.get(value) ?? String(value ?? 'Unknown'), tone };
}

export function invitationRecipientStatus(invitation, recipient, now = Date.now()) {
  if (recipient.redeemedAt) return 'redeemed';
  if (invitation.revokedAt) return 'revoked';
  return Date.parse(invitation.expiresAt) <= now ? 'expired' : 'pending';
}
