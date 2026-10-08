// MAIN-world adapter. No vault data or keys are ever delivered to this world.
(() => {
  if (window.top !== window || window.__127vaultsPasskeyProvider) return;
  window.__127vaultsPasskeyProvider = true;
  const credentials = navigator.credentials;
  if (!credentials) return;
  const native = { create: credentials.create.bind(credentials), get: credentials.get.bind(credentials) };
  const pending = new Map();
  const encode = value => btoa(String.fromCharCode(...(ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)).buffer;
  function serialize(operation, input) {
    const publicKey = input.publicKey;
    if (['conditional', 'silent'].includes(input.mediation) || publicKey.extensions && Object.entries(publicKey.extensions).some(([key, value]) => operation !== 'create' || key !== 'credProps' || typeof value !== 'boolean') || publicKey.attestation && publicKey.attestation !== 'none') return null;
    const rpId = operation === 'create' ? publicKey.rp?.id : publicKey.rpId;
    if (rpId && rpId !== location.hostname || publicKey.authenticatorSelection?.authenticatorAttachment === 'platform') return null;
    const key = operation === 'create' ? 'excludeCredentials' : 'allowCredentials';
    const result = { challenge: encode(publicKey.challenge), timeout: publicKey.timeout, extensions: publicKey.extensions, [key]: publicKey[key]?.map(c => ({ type: c.type, id: encode(c.id) })) };
    if (operation === 'create') Object.assign(result, { rp: { id: publicKey.rp?.id, name: publicKey.rp?.name }, user: { id: encode(publicKey.user.id), name: publicKey.user.name, displayName: publicKey.user.displayName }, pubKeyCredParams: publicKey.pubKeyCredParams, authenticatorSelection: publicKey.authenticatorSelection, attestation: publicKey.attestation });
    else Object.assign(result, { rpId: publicKey.rpId, userVerification: publicKey.userVerification });
    return result;
  }
  function credential(value) {
    const response = { clientDataJSON: decode(value.response.clientDataJSON) };
    if (value.response.attestationObject) Object.assign(response, { attestationObject: decode(value.response.attestationObject), getTransports: () => [...value.response.transports], getAuthenticatorData: () => decode(value.response.authenticatorData), getPublicKey: () => decode(value.response.publicKey), getPublicKeyAlgorithm: () => value.response.publicKeyAlgorithm });
    else Object.assign(response, { authenticatorData: decode(value.response.authenticatorData), signature: decode(value.response.signature), userHandle: value.response.userHandle ? decode(value.response.userHandle) : null });
    Object.setPrototypeOf(response, value.response.attestationObject ? AuthenticatorAttestationResponse.prototype : AuthenticatorAssertionResponse.prototype);
    const result = { id: value.id, rawId: decode(value.rawId), type: 'public-key', authenticatorAttachment: value.authenticatorAttachment, response, getClientExtensionResults: () => ({ ...value.clientExtensionResults }), toJSON: () => value };
    Object.setPrototypeOf(result, PublicKeyCredential.prototype);
    return result;
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== '127vaults.passkey.response') return;
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id); entry.cleanup();
    if (event.data.useBrowser) entry.fallback();
    else if (event.data.error) entry.reject(new DOMException(event.data.error, 'NotAllowedError'));
    else { try { entry.resolve(credential(event.data.value)); } catch { entry.reject(new DOMException('Invalid provider response.', 'UnknownError')); } }
  });
  for (const operation of ['create', 'get']) {
    credentials[operation] = function (input) {
      if (!input?.publicKey || input.signal?.aborted) return native[operation](input);
      let options;
      try { options = serialize(operation, input); } catch { return native[operation](input); }
      if (!options) return native[operation](input);
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const abort = () => { if (!pending.delete(id)) return; cleanup(); window.postMessage({ channel: '127vaults.passkey.cancel', id }, location.origin); reject(new DOMException('Passkey request was aborted.', 'AbortError')); };
        const timeout = setTimeout(() => { if (!pending.delete(id)) return; cleanup(); window.postMessage({ channel: '127vaults.passkey.cancel', id }, location.origin); reject(new DOMException('Passkey request expired.', 'NotAllowedError')); }, Math.min(120000, Math.max(1000, options.timeout || 120000)));
        const cleanup = () => { clearTimeout(timeout); input.signal?.removeEventListener('abort', abort); };
        pending.set(id, { resolve, reject, cleanup, fallback: () => native[operation](input).then(resolve, reject) });
        input.signal?.addEventListener('abort', abort, { once: true });
        window.postMessage({ channel: '127vaults.passkey.request', id, operation, options }, location.origin);
      });
    };
  }
})();
