export const PASSKEY_META: string;
export const PASSKEY_KEY: string;
export type PasskeyMetadata = { version: 1; algorithm: -7; rpId: string; origin: string; credentialId: string; userHandle: string; username: string; displayName: string; signCount: 0 };
export function readMetadata(fields: { id: string; type: string; value: string }[]): PasskeyMetadata | null;
