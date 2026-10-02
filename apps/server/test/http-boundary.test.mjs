import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { HttpBoundaryError, normalizeErrorCode, parseJsonObject, readRequestBody, writeError, writeJson } from '../src/http-boundary.mjs';

const request = (chunks, contentType = 'application/json') => Object.assign(Readable.from(chunks), { headers: { 'content-type': contentType } });
const response = () => ({ status: 0, headers: {}, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } });

test('body reader enforces its byte limit while preserving exact bytes', async () => {
  assert.deepEqual(await readRequestBody(request([Buffer.from('{"x"'), Buffer.from(':1}')]), 7), Buffer.from('{"x":1}'));
  await assert.rejects(readRequestBody(request([Buffer.alloc(8)]), 7), error => error instanceof HttpBoundaryError && error.status === 413 && error.code === 'too_large');
});

test('JSON parser requires the exact media type, object shape, UTF-8, and allowed properties', () => {
  const req = request([]);
  assert.deepEqual(parseJsonObject(req, Buffer.from('{"x":1}'), ['x']), { x: 1 });
  for (const [candidate, allowed = ['x']] of [[Buffer.from('[]')], [Buffer.from('{"y":1}')], [Buffer.from([0xff])]]) {
    assert.throws(() => parseJsonObject(req, candidate, allowed), HttpBoundaryError);
  }
  assert.throws(() => parseJsonObject(request([], 'text/plain'), Buffer.from('{"x":1}'), ['x']), error => error.code === 'unsupported_media_type');
});

test('responses apply security headers and normalize public error codes', () => {
  assert.equal(normalizeErrorCode('AUTH_REQUIRED'), 'auth_required');
  assert.equal(normalizeErrorCode('deviceFork'), 'device_fork');
  const ok = response(); writeJson(ok, 200, { ok: true });
  assert.equal(ok.headers['Cache-Control'], 'no-store');
  assert.equal(ok.headers['X-Content-Type-Options'], 'nosniff');
  const failed = response(); writeError(failed, 400, 'INVALID_REQUEST');
  assert.deepEqual(JSON.parse(failed.body), { error: 'invalid_request' });
});
