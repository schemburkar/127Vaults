// Installer protocol versions are independent of the server/client release.
export const installerProtocol = 1;
export function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(v => Number.isSafeInteger(v) && v <= 65535) ? parts : null;
}
export function installerPolicy(version, minimum = '0.1.0') {
  const current = versionParts(version), required = versionParts(minimum);
  if (!required) throw Error('Invalid installer minimum version');
  if (!current) return false;
  for (let i = 0; i < 3; i++) {
    if (current[i] !== required[i]) return current[i] > required[i];
  }
  return true;
}
