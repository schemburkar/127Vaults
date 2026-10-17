export function createSessionRevocation() {
  let current = 0, revoked = 0, request = 0, pending = 0;
  return {
    beginUnlock() { pending = ++request; return pending; },
    acceptUnlock(ticket, epoch) {
      if (ticket !== pending || !Number.isSafeInteger(epoch) || epoch <= revoked) return false;
      current = epoch; pending = 0; return true;
    },
    failUnlock(ticket) { if (pending === ticket) pending = 0; },
    revoke(epoch) {
      if (!Number.isSafeInteger(epoch) || epoch < 1) return false;
      revoked = Math.max(revoked, epoch);
      return !pending && current === epoch;
    },
    lock() { current = 0; pending = 0; request++; },
  };
}
