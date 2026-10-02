// One bridge per facade. No raw token/pointer or fixture bytes escape to the UI.
export function createFixtureFacade(RustCore) {
  const core = new RustCore();
  const tokens = new Map();
  let disposed = false;
  return Object.freeze({
    capabilities() {
      if (disposed) throw new Error('Core disposed.');
      return { interfaceRevision: core.interface_revision(), experimental: core.experimental(),
        supportedFormats: Array.from(core.supported_formats()) };
    },
    createFixture() {
      if (disposed) throw new Error('Core disposed.');
      if (tokens.size >= 2) throw new Error('Release the oldest display token first.');
      const token = Object.freeze({});
      tokens.set(token, core.create_fixture());
      return token;
    },
    isValid(token) {
      if (disposed || !tokens.has(token)) return false;
      return core.is_valid(tokens.get(token));
    },
    forget(token) {
      tokens.get(token)?.free();
      tokens.delete(token);
    },
    lock() { if (!disposed) core.lock(); },
    dispose() {
      if (disposed) return;
      core.lock();
      for (const token of tokens.values()) token.free();
      tokens.clear();
      core.free();
      disposed = true;
    },
  });
}
