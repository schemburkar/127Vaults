const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const encode = value => new TextEncoder().encode(canonical(value));
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const un = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));

export async function requestBrowserEnrollment(username, send) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{4,63}$/.test(username)) throw Error('INVALID_USERNAME');
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  const deviceId = crypto.randomUUID(), publicKey = b64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
  const requestSignature = b64(new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, encode({ deviceId, publicKey, purpose: 'enrollment-request', username }))));
  const response = await send('/api/v1/device-enrollment', { method: 'POST', body: { username, newDeviceId: deviceId, newDevicePublicKey: publicKey, requestSignature } });
  return { ...response, username, deviceId, publicKey, privateKey: keys.privateKey };
}
export async function finishBrowserEnrollment(pending, send, persistApproval = async () => {}) {
  if (!pending || (!pending.approval && Date.parse(pending.expiresAt) <= Date.now())) throw Error('ENROLLMENT_EXPIRED');
  const response = pending.approval || await send(`/api/v1/device-enrollment/${pending.enrollmentId}/poll`, { method: 'POST', body: { pollToken: pending.pollToken } });
  if (response.status === 'pending') return null;
  const binding = response.binding;
  if (response.status !== 'approved' || binding.enrollmentId !== pending.enrollmentId || binding.newDeviceId !== pending.deviceId || binding.newDevicePublicKey !== pending.publicKey || binding.expiresAt !== pending.expiresAt) throw Error('ENROLLMENT_INVALID');
  const approver = await crypto.subtle.importKey('raw', un(response.approverPublicKey), 'Ed25519', false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', approver, un(response.approvalSignature), encode(binding))) throw Error('ENROLLMENT_INVALID');
  await persistApproval({ ...pending, approval: response });
  const possessionSignature = b64(new Uint8Array(await crypto.subtle.sign('Ed25519', pending.privateKey, encode({ ...binding, purpose: 'device-possession' }))));
  const completed = await send(`/api/v1/device-enrollment/${pending.enrollmentId}/complete`, { method: 'POST', body: { pollToken: pending.pollToken, possessionSignature } });
  if (completed.deviceId !== pending.deviceId) throw Error('ENROLLMENT_INVALID');
  return { username: pending.username, accountId: binding.accountId, deviceId: pending.deviceId, publicKey: pending.publicKey, privateKey: pending.privateKey };
}
