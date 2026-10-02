/** Trusted-client-only ports. Never re-export these from a server transport module. */
import type { CipherContext, Ciphertext, Checkpoint, EncryptedItem, ItemId, KeyEnvelope, KeyHandle, Result, SignedOperation, VerifiedOperation, VaultId } from './contracts.js';
export interface LoginItem {
  readonly title: string; readonly username: string; readonly password: string;
  readonly urls: readonly string[];
  readonly customFields: readonly { readonly name: string; readonly value: string; readonly concealed: boolean }[];
}
export interface LoginIndex { readonly title: string; readonly domains: readonly string[] }
/** Binding-local API; secret inputs must never enter the server transport. */
export interface CryptoCore {
  capabilities(): { readonly interfaceRevision: number; readonly experimental: true; readonly supportedFormats: readonly number[] };
  unlockRoot(passwordUtf8: Uint8Array, accountSecret: Uint8Array, envelope: KeyEnvelope): Promise<Result<KeyHandle>>;
  unlockVault(root: KeyHandle, envelope: KeyEnvelope): Promise<Result<KeyHandle>>;
  encrypt(key: KeyHandle, plaintext: Uint8Array, context: CipherContext): Promise<Result<Ciphertext>>;
  decrypt(key: KeyHandle, ciphertext: Ciphertext, context: CipherContext): Promise<Result<Uint8Array>>;
  verifyOperation(operation: SignedOperation, checkpoint: Checkpoint): Promise<Result<VerifiedOperation>>;
  release(key: KeyHandle): void;
  lock(): void;
}
export interface EncryptedReplica {
  load(vault: VaultId): Promise<Result<readonly EncryptedItem[]>>;
  commitVerified(vault: VaultId, operations: readonly VerifiedOperation[], checkpoint: Checkpoint): Promise<Result<void>>;
  enqueue(operation: SignedOperation): Promise<Result<void>>;
  pending(vault: VaultId): Promise<Result<readonly SignedOperation[]>>;
}
export interface ItemController {
  list(vault: VaultId): Promise<Result<readonly { id: ItemId; index: LoginIndex }[]>>;
  open(vault: VaultId, item: ItemId): Promise<Result<LoginItem>>;
  save(vault: VaultId, item: ItemId | null, value: LoginItem): Promise<Result<ItemId>>;
  close(): void;
  lock(): void;
}
export interface ConflictController {
  list(vault: VaultId): Promise<Result<readonly { id: string; item: ItemId; kind: 'field' | 'delete-edit' }[]>>;
  resolveField(conflict: string, choice: 'a' | 'b' | 'both'): Promise<Result<void>>;
  resolveDeletion(conflict: string, choice: 'keep-original' | 'keep-edit' | 'both' | 'delete'): Promise<Result<void>>;
}
export interface ClientPlatform {
  readonly connectivity: 'online-only' | 'offline-capable';
  subscribeLock(callback: () => void): () => void;
  copySensitive(value: string): Promise<Result<void>>;
  // Best effort clearing after 30 seconds; never claim clipboard-history erasure.
}
