import { createLoginItem } from '../../../packages/domain/src/login-item.mjs';

export const IDLE_LOCK_MS = 30 * 60 * 1000;

// In-memory component only. The caller must complete reviewed authentication and
// key unlock before beginAfterUnlock(); this method does not authenticate anyone.
export function createLoginSession({ now = Date.now, schedule = setTimeout, cancel = clearTimeout, onLock = () => {} } = {}) {
  let locked = true;
  let disposed = false;
  let lastActivity = 0;
  let timer;
  let currentItem = null;
  let reason = 'initial';
  function lock(why = 'manual') {
    locked = true;
    reason = why;
    currentItem = null;
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    // Synchronous integration hook: invalidate Rust keys before returning to UI.
    onLock(why);
  }
  function checkDeadline() {
    if (locked) return;
    const time = now();
    if (!Number.isFinite(time) || time < lastActivity || time - lastActivity >= IDLE_LOCK_MS) lock('idle');
  }
  function arm() {
    if (timer !== undefined) cancel(timer);
    timer = schedule(() => {
      timer = undefined;
      checkDeadline();
      if (!locked) arm();
    }, Math.max(1, IDLE_LOCK_MS - (now() - lastActivity)));
  }
  function requireUnlocked() {
    checkDeadline();
    if (locked || disposed) throw new Error('Session is locked.');
  }
  return Object.freeze({
    beginAfterUnlock() {
      if (disposed) throw new Error('Session is disposed.');
      lock('unlock-reset');
      lastActivity = now();
      if (!Number.isFinite(lastActivity)) throw new Error('Invalid session clock.');
      locked = false;
      reason = null;
      arm();
    },
    recordUserActivity() {
      requireUnlocked();
      lastActivity = now();
      arm();
    },
    openItem(input) {
      requireUnlocked();
      currentItem = null;
      currentItem = createLoginItem(input);
    },
    readItem() { requireUnlocked(); return currentItem; },
    closeItem() { currentItem = null; },
    lock,
    status() { checkDeadline(); return Object.freeze({ locked, reason, hasOpenItem: currentItem !== null }); },
    dispose() { lock('disposed'); disposed = true; },
  });
}
