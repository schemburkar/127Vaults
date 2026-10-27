export const JSON_CONTENT_TYPE = 'application/json';
export const DEFAULT_BODY_LIMIT = 16 * 1024;

// EventEmitter does not await an async request listener. Always terminate its
// promise here, including failures before a route's own error handler begins.
export function containRequestErrors(handler, onError = () => {}) {
  return (req, res) => {
    Promise.resolve().then(() => handler(req, res)).catch(error => {
      try { onError(error); } catch {}
      if (res.destroyed || res.writableEnded) return;
      if (req.destroyed || res.headersSent) { res.destroy(); return; }
      try { writeError(res, 503, 'unavailable'); } catch { res.destroy(); }
    });
  };
}

export class HttpBoundaryError extends Error {
  constructor(status = 400, code = 'invalid_request') {
    super(code);
    this.name = 'HttpBoundaryError';
    this.status = status;
    this.code = normalizeErrorCode(code);
  }
}

export async function readRequestBody(req, limit = DEFAULT_BODY_LIMIT) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('Body limit must be a non-negative safe integer.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpBoundaryError(413, 'too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function parseJsonObject(req, bytes, allowedProperties) {
  if (req.headers['content-type'] !== JSON_CONTENT_TYPE) throw new HttpBoundaryError(415, 'unsupported_media_type');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new HttpBoundaryError(400, 'invalid_request'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new HttpBoundaryError(400, 'invalid_request');
  if (allowedProperties && (Object.keys(value).some(key => !allowedProperties.includes(key)) || allowedProperties.some(key => !(key in value)))) throw new HttpBoundaryError(400, 'invalid_request');
  return value;
}

export function normalizeErrorCode(value, fallback = 'invalid_request') {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  const code = value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : fallback;
}

export function writeJson(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': JSON_CONTENT_TYPE, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(value));
}

export function writeError(res, status, code, headers = {}) {
  writeJson(res, status, { error: normalizeErrorCode(code) }, headers);
}
