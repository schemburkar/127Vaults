export const LOCKED_MESSAGE: string;
export function createDragSession(options?: { now?: () => number; timeoutMs?: number }): {
  unlock(): void; lock(): void; touch(): void;
  begin(kind: string, value: string): string; end(): void;
  isUnlocked(): boolean; hasActivePayload(): boolean;
};
