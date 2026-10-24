// Stable IDs preserve colors across sessions, renames and ordering changes.
export function markerClass(id: string) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `desktop-vault-marker marker-${(hash >>> 0) % 12}`;
}
