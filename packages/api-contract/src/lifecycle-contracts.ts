/** Draft later-slice ports. No endpoints or policy bypasses are implemented. */
import type { AuthMessage, CeremonyId, Ciphertext, DeviceId, Id, ItemId, KeyEnvelope, PendingCeremony, RequestContext, Result, SignedOperation, UserId, VaultId } from './contracts.js';

export interface OnboardingService {
  // Payload contents/combiner await reviewed OPAQUE and first-device design.
  beginBootstrap(message: AuthMessage, signal: AbortSignal): Promise<Result<CeremonyId>>;
  finishBootstrap(ceremony: CeremonyId, message: AuthMessage, signal: AbortSignal): Promise<Result<UserId>>;
  finishInvitedEnrollment(emailCeremony: CeremonyId, message: AuthMessage, signal: AbortSignal): Promise<Result<UserId>>;
}
export interface CredentialService {
  beginPasswordChange(context: RequestContext, registration: AuthMessage): Promise<Result<CeremonyId>>;
  finishPasswordChange(context: RequestContext, ceremony: CeremonyId, rootEnvelope: KeyEnvelope, proof: AuthMessage): Promise<Result<void>>;
  // Account-secret rotation also requires new password, online epoch change,
  // session revocation and other-device reenrollment in one reviewed ceremony.
  rotateAccountSecret(context: RequestContext, transition: SignedOperation): Promise<Result<void>>;
}
export interface MfaService {
  beginTotpSetup(context: RequestContext): Promise<Result<AuthMessage>>;
  confirmTotpSetup(context: RequestContext, code: string): Promise<Result<readonly string[]>>;
  disableTotp(context: RequestContext, proof: AuthMessage): Promise<Result<void>>;
  beginLostTotpRecovery(context: RequestContext, user: UserId): Promise<Result<PendingCeremony>>;
}
export interface HistoryService {
  list(context: RequestContext, vault: VaultId, item: ItemId): Promise<Result<readonly { id: Id<'history-entry'>; encryptedValue: Ciphertext; createdAt: string }[]>>;
  restoreItem(context: RequestContext, restoration: SignedOperation): Promise<Result<void>>;
  cancelVaultDeletion(context: RequestContext, vault: VaultId): Promise<Result<void>>;
  restoreVault(context: RequestContext, vault: VaultId): Promise<Result<void>>;
}
export interface IntegrityRepairService {
  beginRepair(context: RequestContext, vault: VaultId, proposedBranch: Id<'branch'>): Promise<Result<PendingCeremony>>;
  approveRepair(context: RequestContext, ceremony: CeremonyId, proof: SignedOperation): Promise<Result<void>>;
  applyRepair(context: RequestContext, ceremony: CeremonyId, replacement: SignedOperation): Promise<Result<void>>;
}
export interface RecoveryPolicyService {
  setPrivateVaultPolicy(context: RequestContext, vault: VaultId, policy:
    { enabled: false } | { enabled: true; eligibleAdmins: readonly UserId[]; recoveryEnvelope: KeyEnvelope }): Promise<Result<void>>;
}
export interface NotificationService {
  // Fixed metadata-only templates; delivery failure cannot silently cancel recovery.
  send(event: { id: Id<'notification'>; recipient: UserId; kind: 'recovery-started' | 'device-revoked' | 'vault-deletion' | 'history-repair' | 'role-changed'; ceremony: CeremonyId | null }): Promise<Result<'delivered' | 'unconfirmed'>>;
}
export interface LicenseService {
  status(context: RequestContext): Promise<Result<{ mode: 'experimental' | 'active' | 'read-only' | 'locked'; plan: 'personal' | 'commercial' | null; maxActiveUsers: number | null; expiresAt: string | null; readOnlyUntil: string | null; enforcement: 'disabled' | 'enabled' }>>;
  install(context: RequestContext, signedLicense: Id<'signed-license'>): Promise<Result<void>>;
  beginEmergencyExport(context: RequestContext): Promise<Result<Id<'export-job'>>>;
}
export interface RemoteWipeService {
  request(context: RequestContext, device: DeviceId, signedOptInRequest: SignedOperation): Promise<Result<void>>;
}
export interface OptionalCapabilities {
  // Deferred features must be reported unavailable until their own designs land.
  readonly attachments: false;
  // Website credential provider is experimental and opt-in per browser site.
  // This does not imply passkey authentication for the 127Vaults account.
  readonly passkeys: false | "experimental-website-provider";
  readonly transparencyNotary: false;
}
