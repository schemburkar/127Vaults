export const LOCKED_MESSAGE = "Unlock the POC to drag a field.";

export function createDragSession({ now = () => Date.now(), timeoutMs = 30 * 60_000 } = {}) {
  let unlocked = false;
  let active = null;
  let lastActivity = now();

  function clear() {
    if (active) active.value = "";
    active = null;
  }

  return {
    unlock() {
      unlocked = true;
      lastActivity = now();
    },
    lock() {
      unlocked = false;
      clear();
    },
    touch() {
      if (unlocked) lastActivity = now();
    },
    begin(kind, value) {
      if (!unlocked || now() - lastActivity >= timeoutMs) {
        this.lock();
        throw new Error(LOCKED_MESSAGE);
      }
      clear();
      active = { kind, value };
      lastActivity = now();
      return value;
    },
    end() {
      clear();
    },
    isUnlocked() {
      if (unlocked && now() - lastActivity >= timeoutMs) this.lock();
      return unlocked;
    },
    hasActivePayload() {
      return active !== null;
    },
  };
}
