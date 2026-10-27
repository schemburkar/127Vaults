// Test-only compatibility: establish the old owner before upgrading the server.
// Never retry a rejected modern registration using the older request shape.
export function legacyRegistrationBaseline(archive) {
  if (!archive) return false;
  const match = /127vaults-server-(\d+)\.(\d+)\.(\d+)-/.exec(archive);
  if (!match) throw Error('Cannot determine upgrade baseline registration protocol.');
  const [major, minor, patch] = match.slice(1).map(Number);
  return major === 0 && (minor === 0 || minor === 1 && patch < 17);
}

export function registrationFixtureRequest(input, legacy = false) {
  const { accountId, deviceId, request, token, email } = input;
  return legacy ? { accountId, deviceId, request } : { accountId, deviceId, request, token, email };
}
