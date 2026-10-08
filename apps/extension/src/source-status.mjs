export function sourceStatus(source, locale = undefined) {
  if (!source) return '';
  if (!source.active && !source.localUnlocked) return 'Local vault locked';
  const mode = source.id === 'desktop' ? 'Desktop vault on this device' : source.online ? 'Client unlocked; server not checked' : 'Offline copy; may be stale';
  const seconds = source.sync?.lastVerifiedSyncAt;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return `${mode} · sync time unknown`;
  return `${mode} · last synced ${new Date(seconds * 1000).toLocaleString(locale)}`;
}
