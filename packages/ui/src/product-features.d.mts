export type FeatureField = { id: string; label: string; type: string; value: string };
export const FAVORITE_ID: string;
export const TOTP_ID: string;
export function isFavorite(fields?: FeatureField[]): boolean;
export function setFavorite(fields: FeatureField[], favorite: boolean): FeatureField[];
export function setAuthenticator(fields: FeatureField[], value: string): FeatureField[];
export function parseTotp(value: string): { key: Uint8Array; algorithm: string; digits: number; period: number };
export function totp(value: string, seconds?: number): Promise<{ code: string; remaining: number; period: number }>;
export function passwordIssues(password: string): string[];
export type HealthItem = { itemId: string; vaultId?: string; title: string; website?: string; password: string; customFields: FeatureField[] };
export type HealthFinding = { itemId: string; vaultId?: string; title: string; website?: string; label: string; issues: string[] };
export function analyzePasswords(items: HealthItem[], breached?: Set<string>): HealthFinding[];

export function changePasswordUrl(website?: string): string | null;
export function breachedPasswords(items: HealthItem[], options?: { signal?: AbortSignal; request?: typeof fetch }): Promise<Set<string>>;
