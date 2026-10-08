import { validateRequest } from './passkeys.mjs';

export function createPasskeyQueue({ now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const pending = new Map();
  function finish(id, result) {
    const row = pending.get(id);
    if (!row) return;
    pending.delete(id); cancel(row.timer); row.respond(result);
  }
  return {
    add(message, sender, respond) {
      if (!sender.tab?.id || sender.frameId !== 0 || sender.documentLifecycle && sender.documentLifecycle !== 'active') throw Error('Passkeys require the active top-level page.');
      const origin = new URL(sender.url).origin;
      if (new URL(sender.tab.url).origin !== origin || typeof message.id !== 'string' || message.id.length > 64 || JSON.stringify(message.options).length > 20000) throw Error('Invalid passkey request.');
      validateRequest(message.operation, message.options, origin);
      if (pending.size >= 8 || [...pending.values()].some(row => row.tabId === sender.tab.id)) throw Error('A passkey request is already pending.');
      const id = crypto.randomUUID(), timeout = Math.min(120000, Math.max(1000, Number(message.options.timeout) || 120000));
      const row = { id, pageId: message.id, tabId: sender.tab.id, documentId: sender.documentId, origin, operation: message.operation, options: structuredClone(message.options), expiresAt: now() + timeout, respond, processing: false };
      row.timer = schedule(() => finish(id, { error: 'Passkey request expired.' }), timeout);
      pending.set(id, row);
      return id;
    },
    get(id) { const row = pending.get(id); if (row && now() >= row.expiresAt) { finish(id, { error: 'Passkey request expired.' }); return null; } return row || null; },
    list(tabId) { return [...pending.values()].filter(row => row.tabId === tabId).map(({ id, origin, operation, options, expiresAt, processing }) => ({ id, origin, operation, options, expiresAt, processing })); },
    finish,
    cancelPage(sender, pageId) { for (const row of pending.values()) if (row.tabId === sender.tab?.id && row.documentId === sender.documentId && row.pageId === pageId) finish(row.id, { error: 'Passkey request cancelled.' }); },
    cancelTab(tabId) { for (const row of pending.values()) if (row.tabId === tabId) finish(row.id, { error: 'The page navigated or closed.' }); },
    cancelAll() { for (const row of pending.values()) finish(row.id, { error: 'Vault source locked.' }); },
  };
}
