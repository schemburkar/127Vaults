import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { InMemoryDeviceLifecycleService, SELECTED_ADMIN_DELAY_MS, signEnrollmentApproval, signNewDevicePossession } from "../src/index.mjs";

const keys = () => generateKeyPairSync("ed25519");
function fixture() {
  let time = 1_000_000;
  const first = keys(); const service = new InMemoryDeviceLifecycleService({ now: () => time, random: () => Buffer.alloc(16, 7) });
  service.registerAccount({ accountId: "acct-a", initialDeviceId: "device-a", publicKey: first.publicKey });
  const session = service.createSession({ accountId: "acct-a", deviceId: "device-a" });
  return { service, first, session, advance: (ms) => { time += ms; } };
}

test("trusted device approves a bound, one-time enrollment and QR payload", () => {
  const f = fixture(); const newcomer = keys();
  const start = f.service.beginEnrollment({ accountId: "acct-a", newDeviceId: "device-b", newDevicePublicKey: newcomer.publicKey, newDeviceSessionId: "new-session", approverSessionId: f.session.sessionId });
  const qr = JSON.parse(start.qrPayload);
  assert.equal(qr.code, start.code); assert.equal(qr.newDeviceId, "device-b"); assert.equal(qr.approverSessionId, f.session.sessionId);
  const approval = signEnrollmentApproval(start.pending, "device-a", f.first.privateKey);
  const possession = signNewDevicePossession(start.pending, newcomer.privateKey);
  assert.equal(f.service.approveEnrollment({ enrollmentId: start.pending.enrollmentId, code: start.code, approval, newDevicePossession: possession }).deviceId, "device-b");
  assert.throws(() => f.service.approveEnrollment({ enrollmentId: start.pending.enrollmentId, code: start.code, approval, newDevicePossession: possession }), { code: "enrollment_consumed" });
});

test("rejects code replay, device substitution, signer substitution, and expiry", () => {
  const f = fixture(); const newcomer = keys(); const attacker = keys();
  const start = f.service.beginEnrollment({ accountId: "acct-a", newDeviceId: "device-b", newDevicePublicKey: newcomer.publicKey, newDeviceSessionId: "new-session", approverSessionId: f.session.sessionId });
  const approval = signEnrollmentApproval(start.pending, "device-a", f.first.privateKey);
  assert.throws(() => f.service.approveEnrollment({ enrollmentId: start.pending.enrollmentId, code: "wrong", approval, newDevicePossession: signNewDevicePossession(start.pending, newcomer.privateKey) }), { code: "invalid_enrollment_code" });
  assert.throws(() => f.service.approveEnrollment({ enrollmentId: start.pending.enrollmentId, code: start.code, approval: { ...approval, newDeviceId: "attacker" }, newDevicePossession: signNewDevicePossession(start.pending, newcomer.privateKey) }), { code: "enrollment_substitution" });
  assert.throws(() => f.service.approveEnrollment({ enrollmentId: start.pending.enrollmentId, code: start.code, approval, newDevicePossession: signNewDevicePossession(start.pending, attacker.privateKey) }), { code: "invalid_device_possession" });
  f.advance(5 * 60 * 1000);
  assert.throws(() => f.service.approveEnrollment({ enrollmentId: start.pending.enrollmentId, code: start.code, approval, newDevicePossession: signNewDevicePossession(start.pending, newcomer.privateKey) }), { code: "enrollment_expired" });
});

test("revocation invalidates only the revoked device authorization and sessions", () => {
  const f = fixture(); const second = keys();
  const start = f.service.beginEnrollment({ accountId: "acct-a", newDeviceId: "device-b", newDevicePublicKey: second.publicKey, newDeviceSessionId: "new", approverSessionId: f.session.sessionId });
  f.service.approveEnrollment({ enrollmentId: start.pending.enrollmentId, code: start.code, approval: signEnrollmentApproval(start.pending, "device-a", f.first.privateKey), newDevicePossession: signNewDevicePossession(start.pending, second.privateKey) });
  const secondSession = f.service.createSession({ accountId: "acct-a", deviceId: "device-b" });
  f.service.revokeDevice({ accountId: "acct-a", deviceId: "device-a" });
  assert.throws(() => f.service.validateSession({ accountId: "acct-a", sessionId: f.session.sessionId }), { code: "session_invalid" });
  assert.equal(f.service.validateSession({ accountId: "acct-a", sessionId: secondSession.sessionId }).deviceId, "device-b");
});

test("password rotation advances epochs but preserves approval; account-secret rotation requires reenrollment", () => {
  const f = fixture(); const replacement = keys();
  let state = f.service.rotateMasterPassword({ accountId: "acct-a", initiatingDeviceId: "device-a" });
  assert.equal(state.credentialEpoch, 2); assert.equal(state.devices[0].status, "active");
  assert.throws(() => f.service.validateSession({ accountId: "acct-a", sessionId: f.session.sessionId }), { code: "session_invalid" });
  state = f.service.rotateAccountSecret({ accountId: "acct-a", initiatingDeviceId: "device-a", replacementDeviceId: "device-a-epoch3", replacementPublicKey: replacement.publicKey });
  assert.equal(state.credentialEpoch, 3); assert.equal(state.devices.find((d) => d.deviceId === "device-a").credentialState, "reenrollment_required");
  assert.equal(state.devices.find((d) => d.deviceId === "device-a-epoch3").status, "active");
});

test("lost-last-device recovery is explicit and selected-admin recovery enforces delay", () => {
  const f = fixture(); const replacement = keys(); f.service.revokeDevice({ accountId: "acct-a", deviceId: "device-a" });
  assert.equal(f.service.accountState("acct-a").recoveryState, "lost_last_device");
  assert.throws(() => f.service.beginLostDeviceRecovery({ accountId: "acct-a", mode: "offline-kit", replacementDeviceId: "device-r", replacementPublicKey: replacement.publicKey }), { code: "recovery_proof_required" });
  const pending = f.service.beginLostDeviceRecovery({ accountId: "acct-a", mode: "selected-admin", replacementDeviceId: "device-r", replacementPublicKey: replacement.publicKey, eligibleAdminId: "admin-a", selectedAdminPolicyEnabled: true });
  assert.equal(pending.status, "pending_delay"); assert.equal("vaultKey" in pending, false);
  assert.throws(() => f.service.completeLostDeviceRecovery({ recoveryId: pending.recoveryId, ceremonyVerified: true }), { code: "recovery_delay_active" });
  f.advance(SELECTED_ADMIN_DELAY_MS);
  const state = f.service.completeLostDeviceRecovery({ recoveryId: pending.recoveryId, ceremonyVerified: true });
  assert.equal(state.recoveryState, "available"); assert.equal(state.devices.find((d) => d.deviceId === "device-r").status, "active");
});

test("a pending selected-admin recovery can be cancelled without vault decryption", () => {
  const f = fixture(); const replacement = keys(); f.service.revokeDevice({ accountId: "acct-a", deviceId: "device-a" });
  const pending = f.service.beginLostDeviceRecovery({ accountId: "acct-a", mode: "selected-admin", replacementDeviceId: "device-r", replacementPublicKey: replacement.publicKey, eligibleAdminId: "admin-a", selectedAdminPolicyEnabled: true });
  assert.equal(f.service.cancelRecovery({ recoveryId: pending.recoveryId }).status, "cancelled");
  assert.equal(f.service.accountState("acct-a").recoveryState, "lost_last_device");
  assert.throws(() => f.service.completeLostDeviceRecovery({ recoveryId: pending.recoveryId, ceremonyVerified: true }), { code: "recovery_not_pending" });
});
