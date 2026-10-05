export function sourceStatus(source, locale = undefined) {
  if (!source) return '';
  if (!source.active && !source.localUnlocked) return 'Local replica is locked. Unlock to inspect its offline snapshot.';
  const mode = source.online ? 'Client session; server connection not rechecked' : 'Offline snapshot; data may be stale';
  const seconds = source.sync?.lastVerifiedSyncAt;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return `${mode}. Last verified sync is unknown.`;
  return `${mode}. Last verified sync: ${new Date(seconds * 1000).toLocaleString(locale)}.`;
}
