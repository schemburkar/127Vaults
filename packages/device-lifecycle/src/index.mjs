import { createHash, randomBytes, randomUUID, sign, verify } from "node:crypto";

export const DEVICE_PROTOCOL_VERSION = 1;
export const ENROLLMENT_TTL_MS = 5 * 60 * 1000;
export const SELECTED_ADMIN_DELAY_MS = 4 * 60 * 60 * 1000;

export class DeviceLifecycleError extends Error {
  constructor(code, message = code) { super(message); this.name = "DeviceLifecycleError"; this.code = code; }
}

function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!plain(value)) throw new TypeError("canonical data must contain only JSON-safe values");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
const bytes = (value) => Buffer.from(canonicalJson(value), "utf8");
const keyText = (key) => key.export({ type: "spki", format: "pem" }).toString();
const digest = (value) => createHash("sha256").update(value).digest("base64url");
const fail = (code) => { throw new DeviceLifecycleError(code); };

export function enrollmentBinding(pending) {
  return {
    protocolVersion: DEVICE_PROTOCOL_VERSION,
    purpose: "127vaults.device-enrollment.v1",
    accountId: pending.accountId,
    enrollmentId: pending.enrollmentId,
    approverSessionId: pending.approverSessionId,
    newDeviceSessionId: pending.newDeviceSessionId,
    newDeviceId: pending.newDeviceId,
    newDevicePublicKey: pending.newDevicePublicKey,
    expiresAt: pending.expiresAt
  };
}

export function signEnrollmentApproval(pending, approverDeviceId, privateKey) {
  const body = { ...enrollmentBinding(pending), approverDeviceId };
  return { ...body, signature: sign(null, bytes(body), privateKey).toString("base64url") };
}

export function signNewDevicePossession(pending, privateKey) {
  const body = { ...enrollmentBinding(pending), purpose: "127vaults.new-device-possession.v1" };
  return sign(null, bytes(body), privateKey).toString("base64url");
}

export class InMemoryDeviceLifecycleService {
  #accounts = new Map();
  #enrollments = new Map();
  #recoveries = new Map();
  constructor({ now = () => Date.now(), random = (size) => randomBytes(size) } = {}) { this.now = now; this.random = random; }

  registerAccount({ accountId, initialDeviceId, publicKey, protection = { class: "software", verified: false } }) {
    if (this.#accounts.has(accountId)) fail("account_exists");
    const account = { accountId, credentialEpoch: 1, sessionEpoch: 1, recoveryState: "available", devices: new Map(), sessions: new Map() };
    account.devices.set(initialDeviceId, this.#device(initialDeviceId, publicKey, 1, protection));
    this.#accounts.set(accountId, account);
    return this.accountState(accountId);
  }

  createSession({ accountId, deviceId }) {
    const account = this.#account(accountId); const device = this.#activeDevice(account, deviceId);
    const sessionId = randomUUID();
    account.sessions.set(sessionId, { sessionId, deviceId, sessionEpoch: account.sessionEpoch, deviceAuthEpoch: device.authEpoch, valid: true });
    return { sessionId, sessionEpoch: account.sessionEpoch, credentialEpoch: account.credentialEpoch };
  }

  validateSession({ accountId, sessionId }) {
    const account = this.#account(accountId); const session = account.sessions.get(sessionId);
    if (!session?.valid || session.sessionEpoch !== account.sessionEpoch) fail("session_invalid");
    const device = this.#activeDevice(account, session.deviceId);
    if (session.deviceAuthEpoch !== device.authEpoch) fail("session_invalid");
    return { deviceId: device.deviceId, credentialEpoch: account.credentialEpoch };
  }

  beginEnrollment({ accountId, newDeviceId, newDevicePublicKey, newDeviceSessionId, approverSessionId, protection = { class: "software", verified: false } }) {
    const account = this.#account(accountId); this.validateSession({ accountId, sessionId: approverSessionId });
    if (account.devices.has(newDeviceId)) fail("device_id_in_use");
    const enrollmentId = randomUUID(); const code = this.random(16).toString("base64url");
    const pending = { accountId, enrollmentId, approverSessionId, newDeviceSessionId, newDeviceId, newDevicePublicKey: keyText(newDevicePublicKey), protection, credentialEpoch: account.credentialEpoch, expiresAt: this.now() + ENROLLMENT_TTL_MS, codeHash: digest(code), used: false };
    this.#enrollments.set(enrollmentId, pending);
    const payload = { ...enrollmentBinding(pending), code };
    return { pending: enrollmentBinding(pending), code, qrPayload: canonicalJson(payload) };
  }

  approveEnrollment({ enrollmentId, code, approval, newDevicePossession }) {
    const pending = this.#enrollments.get(enrollmentId); if (!pending || pending.used) fail("enrollment_consumed");
    if (this.now() >= pending.expiresAt) fail("enrollment_expired");
    if (digest(code) !== pending.codeHash) fail("invalid_enrollment_code");
    const account = this.#account(pending.accountId);
    if (pending.credentialEpoch !== account.credentialEpoch) fail("stale_credential_epoch");
    const approverSession = this.validateSession({ accountId: pending.accountId, sessionId: pending.approverSessionId });
    if (approval.approverDeviceId !== approverSession.deviceId) fail("wrong_approver");
    const expectedApproval = { ...enrollmentBinding(pending), approverDeviceId: approval.approverDeviceId };
    if (Object.keys(expectedApproval).some((key) => approval[key] !== expectedApproval[key])) fail("enrollment_substitution");
    const approver = this.#activeDevice(account, approval.approverDeviceId);
    if (!verify(null, bytes(expectedApproval), approver.publicKey, Buffer.from(approval.signature ?? "", "base64url"))) fail("invalid_approval_signature");
    const possessionBody = { ...enrollmentBinding(pending), purpose: "127vaults.new-device-possession.v1" };
    if (!verify(null, bytes(possessionBody), pending.newDevicePublicKey, Buffer.from(newDevicePossession ?? "", "base64url"))) fail("invalid_device_possession");
    pending.used = true;
    account.devices.set(pending.newDeviceId, this.#device(pending.newDeviceId, pending.newDevicePublicKey, account.credentialEpoch, pending.protection));
    return { deviceId: pending.newDeviceId, credentialEpoch: account.credentialEpoch };
  }

  revokeDevice({ accountId, deviceId }) {
    const account = this.#account(accountId); const device = this.#activeDevice(account, deviceId);
    device.status = "revoked"; device.authEpoch += 1;
    for (const session of account.sessions.values()) if (session.deviceId === deviceId) session.valid = false;
    account.recoveryState = [...account.devices.values()].some((d) => d.status === "active") ? "available" : "lost_last_device";
    return this.accountState(accountId);
  }

  rotateMasterPassword({ accountId, initiatingDeviceId }) {
    const account = this.#account(accountId); this.#activeDevice(account, initiatingDeviceId);
    account.credentialEpoch += 1; account.sessionEpoch += 1;
    for (const session of account.sessions.values()) session.valid = false;
    for (const device of account.devices.values()) if (device.status === "active") device.credentialState = device.deviceId === initiatingDeviceId ? "current" : "password_refresh_required";
    account.devices.get(initiatingDeviceId).credentialEpochSeen = account.credentialEpoch;
    return this.accountState(accountId);
  }

  rotateAccountSecret({ accountId, initiatingDeviceId, replacementDeviceId, replacementPublicKey, protection = { class: "software", verified: false } }) {
    const account = this.#account(accountId); this.#activeDevice(account, initiatingDeviceId);
    account.credentialEpoch += 1; account.sessionEpoch += 1;
    for (const session of account.sessions.values()) session.valid = false;
    for (const device of account.devices.values()) { device.status = "revoked"; device.authEpoch += 1; device.credentialState = "reenrollment_required"; }
    account.devices.set(replacementDeviceId, this.#device(replacementDeviceId, replacementPublicKey, account.credentialEpoch, protection));
    account.recoveryState = "available";
    return this.accountState(accountId);
  }

  beginLostDeviceRecovery({ accountId, mode, replacementDeviceId, replacementPublicKey, recoveryProofVerified = false, eligibleAdminId, selectedAdminPolicyEnabled = false }) {
    const account = this.#account(accountId);
    if ([...account.devices.values()].some((d) => d.status === "active")) fail("trusted_device_still_available");
    if (mode === "offline-kit" && !recoveryProofVerified) fail("recovery_proof_required");
    if (mode === "selected-admin" && (!selectedAdminPolicyEnabled || !eligibleAdminId)) fail("recovery_policy_not_enabled");
    const recoveryId = randomUUID(); const createdAt = this.now();
    const recovery = { recoveryId, accountId, mode, status: mode === "offline-kit" ? "proof_verified" : "pending_delay", createdAt, completesAt: mode === "selected-admin" ? createdAt + SELECTED_ADMIN_DELAY_MS : createdAt, replacementDeviceId, replacementPublicKey: keyText(replacementPublicKey), eligibleAdminId: eligibleAdminId ?? null };
    this.#recoveries.set(recoveryId, recovery); account.recoveryState = recovery.status;
    return { ...recovery };
  }

  cancelRecovery({ recoveryId }) { const recovery = this.#recovery(recoveryId); if (recovery.status !== "pending_delay") fail("recovery_not_pending"); recovery.status = "cancelled"; this.#account(recovery.accountId).recoveryState = "lost_last_device"; return { ...recovery }; }
  completeLostDeviceRecovery({ recoveryId, ceremonyVerified = false }) {
    const recovery = this.#recovery(recoveryId); const account = this.#account(recovery.accountId);
    if (!["proof_verified", "pending_delay"].includes(recovery.status)) fail("recovery_not_pending");
    if (this.now() < recovery.completesAt) fail("recovery_delay_active");
    if (!ceremonyVerified) fail("recovery_ceremony_required");
    account.credentialEpoch += 1; account.sessionEpoch += 1;
    account.devices.set(recovery.replacementDeviceId, this.#device(recovery.replacementDeviceId, recovery.replacementPublicKey, account.credentialEpoch, { class: "unverified", verified: false }));
    recovery.status = "completed"; account.recoveryState = "available";
    return this.accountState(account.accountId);
  }

  accountState(accountId) { const a = this.#account(accountId); return { accountId, credentialEpoch: a.credentialEpoch, sessionEpoch: a.sessionEpoch, recoveryState: a.recoveryState, devices: [...a.devices.values()].map((d) => ({ deviceId: d.deviceId, status: d.status, authEpoch: d.authEpoch, credentialEpochSeen: d.credentialEpochSeen, credentialState: d.credentialState, protection: d.protection })) }; }
  #device(deviceId, publicKey, epoch, protection) { return { deviceId, publicKey, status: "active", authEpoch: 1, credentialEpochSeen: epoch, credentialState: "current", protection }; }
  #account(id) { const value = this.#accounts.get(id); if (!value) fail("account_not_found"); return value; }
  #activeDevice(account, id) { const value = account.devices.get(id); if (!value || value.status !== "active") fail("device_revoked_or_unknown"); return value; }
  #recovery(id) { const value = this.#recoveries.get(id); if (!value) fail("recovery_not_found"); return value; }
}
