/** Planning contracts, revision 1. No stable wire encoding or implemented API implied. */
declare const brand: unique symbol;
export type Id<Kind extends string> = string & { readonly [brand]: Kind };
export type UserId = Id<'user'>;
export type TenantId = Id<'tenant'>;
export type VaultId = Id<'vault'>;
export type DeviceId = Id<'device'>;
export type ItemId = Id<'item'>;
export type OperationId = Id<'operation'>;
export type CeremonyId = Id<'ceremony'>;
export type Revision = Id<'revision'>;
export type Cursor = Id<'cursor'>;
/** Opaque transport payloads; actual encodings await crypto/protocol review. */
export type Ciphertext = Id<'ciphertext'>;
export type SignedOperation = Id<'signed-operation'>;
export type VerifiedOperation = Id<'verified-operation'>;
export type Checkpoint = Id<'checkpoint'>;
export type AuthMessage = Id<'auth-message'>;
export type KeyEnvelope = Id<'key-envelope'>;
export type PublicDeviceBundle = Id<'public-device-bundle'>;
export type SessionProof = Id<'session-proof'>;
export type KeyHandle = Id<'local-key-handle'>;
export type ServerRole = 'user' | 'admin' | 'owner';
export type VaultRole = 'reader' | 'writer' | 'manager' | 'owner';
export interface Actor { readonly tenant: TenantId; readonly user: UserId; readonly device: DeviceId }
export type Result<T> = { readonly ok: true; readonly value: T } |
  { readonly ok: false; readonly error: 'unavailable' | 'unauthorized' | 'invalid-input' | 'conflict' | 'revoked' | 'integrity-failure' | 'unsupported-version' };
export interface RequestContext { readonly proof: SessionProof; readonly signal: AbortSignal }
export interface CipherContext {
  readonly tenant: TenantId; readonly user: UserId; readonly vault: VaultId;
  readonly item: ItemId; readonly field: string; readonly schemaVersion: number; readonly keyEpoch: number;
}
export interface EncryptedItem { readonly id: ItemId; readonly revision: Revision; readonly index: Ciphertext; readonly body: Ciphertext }
export interface PendingCeremony { readonly id: CeremonyId; readonly notBefore: string; readonly expiresAt: string }

/** Server-facing ports: never accept plaintext passwords, vault keys or item bodies. */
export interface AuthenticationService {
  begin(message: AuthMessage, signal: AbortSignal): Promise<Result<{ ceremony: CeremonyId; reply: AuthMessage }>>;
  finish(ceremony: CeremonyId, message: AuthMessage, signal: AbortSignal): Promise<Result<SessionProof>>;
  revokeSession(context: RequestContext): Promise<Result<void>>;
}
export interface AccountService {
  self(context: RequestContext): Promise<Result<{ id: UserId; username: string; displayName: string; role: ServerRole }>>;
  createInvitation(context: RequestContext, emails: readonly string[], expiryHours: 24 | 48): Promise<Result<{ code: string; expiresAt: string }>>;
  beginEmailVerification(code: string, email: string, signal: AbortSignal): Promise<Result<CeremonyId>>;
  // Final registration combines email proof and reviewed first-device/PAKE ceremony.
  requestOwnership(context: RequestContext, recipient: UserId): Promise<Result<PendingCeremony>>;
  acceptOwnership(context: RequestContext, ceremony: CeremonyId): Promise<Result<void>>;
  unlockAuthentication(context: RequestContext, user: UserId): Promise<Result<void>>;
}
export interface DeviceService {
  beginEnrollment(context: RequestContext, candidate: PublicDeviceBundle): Promise<Result<PendingCeremony>>;
  approveEnrollment(context: RequestContext, ceremony: CeremonyId, proof: AuthMessage): Promise<Result<void>>;
  revoke(context: RequestContext, device: DeviceId): Promise<Result<void>>;
}
export interface VaultService {
  list(context: RequestContext): Promise<Result<readonly { id: VaultId; role: VaultRole; keyEpoch: number }[]>>;
  createPrivate(context: RequestContext, envelope: KeyEnvelope): Promise<Result<VaultId>>;
  grantMembership(context: RequestContext, vault: VaultId, user: UserId, role: VaultRole, envelope: KeyEnvelope): Promise<Result<void>>;
  // Signed epoch transition must include only remaining members' envelopes.
  removeMember(context: RequestContext, transition: SignedOperation): Promise<Result<void>>;
  requestDeletion(context: RequestContext, vault: VaultId): Promise<Result<PendingCeremony>>;
}
export interface SyncTransport {
  submit(context: RequestContext, operations: readonly SignedOperation[]): Promise<Result<readonly { id: OperationId; revision: Revision }[]>>;
  pull(context: RequestContext, vault: VaultId, cursor: Cursor | null): Promise<Result<
    { kind: 'incremental'; operations: readonly SignedOperation[]; cursor: Cursor; checkpoint: Checkpoint } |
    { kind: 'snapshot-required' }>>;
  snapshot(context: RequestContext, vault: VaultId): Promise<Result<{ items: readonly EncryptedItem[]; checkpoint: Checkpoint; cursor: Cursor }>>;
}
export interface RecoveryService {
  begin(context: RequestContext, vault: VaultId, recipient: PublicDeviceBundle): Promise<Result<PendingCeremony>>;
  cancel(context: RequestContext, ceremony: CeremonyId): Promise<Result<void>>;
  complete(context: RequestContext, ceremony: CeremonyId, proof: AuthMessage): Promise<Result<KeyEnvelope>>;
}
export interface OperationsService {
  readiness(context: RequestContext): Promise<Result<{ schemaVersion: number; experimental: true }>>;
  createBackup(context: RequestContext): Promise<Result<Id<'backup-job'>>>;
  verifyRestore(context: RequestContext, backup: Id<'backup-job'>): Promise<Result<Id<'restore-evidence'>>>;
}
