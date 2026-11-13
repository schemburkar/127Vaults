export function invitationStatus(row, now = Date.now()) {
  if (row.state !== 'approved') return { label: 'Closed', usable: false, detail: 'This request no longer permits invitation access.' };
  if (!row.canPreviewInvitation) return { label: 'No invitation', usable: false, detail: 'No shareable invitation is available for this record.' };
  const expiry = Date.parse(row.linkExpiresAt);
  if (!Number.isFinite(expiry)) return { label: 'Expiry unavailable', usable: false, detail: 'Refresh this request before sharing the link.' };
  return expiry > now
    ? { label: 'Valid', usable: true, detail: 'The existing link can be shared until its expiry.' }
    : { label: 'Expired', usable: false, detail: 'Do not share this link. Extend its expiry to keep the same URL, or replace it if it is no longer trusted.' };
}
