import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { S3Client } from '@aws-sdk/client-s3';
import { uploadArtifacts, checkLocalCatalogue, objectKey, remoteHash } from './artifacts.mjs';
import { catalogueIdentity } from '../../apps/public-intake/cloudflare/catalogue.mjs';

// A disposable S3 HTTP endpoint exercises the real SDK's single/multipart upload,
// metadata, ETag and streaming download paths without Cloudflare credentials.
async function s3Fixture(t) {
  const objects = new Map(), uploads = new Map(), operations = [];
  let uploadCounter = 0;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost'), key = decodeURIComponent(url.pathname.slice('/private/'.length));
      operations.push({ method: request.method, key, range: request.headers.range, multipart: url.searchParams.has('uploadId') || url.searchParams.has('uploads') });
      const all = async () => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks); };
      if (request.method === 'POST' && url.searchParams.has('uploads')) {
        const id = String(++uploadCounter); uploads.set(id, { key, parts: new Map(), sha256: request.headers['x-amz-meta-sha256'] });
        response.setHeader('Content-Type', 'application/xml');
        response.end(`<InitiateMultipartUploadResult><Bucket>private</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`); return;
      }
      if (request.method === 'PUT' && url.searchParams.has('uploadId')) {
        const upload = uploads.get(url.searchParams.get('uploadId')); const bytes = await all();
        upload.parts.set(Number(url.searchParams.get('partNumber')), bytes);
        response.setHeader('ETag', '"' + createHash('md5').update(bytes).digest('hex') + '"'); response.end(); return;
      }
      if (request.method === 'POST' && url.searchParams.has('uploadId')) {
        await all(); const upload = uploads.get(url.searchParams.get('uploadId'));
        const bytes = Buffer.concat([...upload.parts].sort((a, b) => a[0] - b[0]).map(([, data]) => data));
        const etag = '"' + createHash('md5').update(bytes).digest('hex') + `-${upload.parts.size}"`;
        objects.set(key, { bytes, etag, sha256: upload.sha256 }); uploads.delete(url.searchParams.get('uploadId'));
        response.setHeader('Content-Type', 'application/xml');
        response.end(`<CompleteMultipartUploadResult><Bucket>private</Bucket><Key>${key}</Key><ETag>${etag}</ETag></CompleteMultipartUploadResult>`); return;
      }
      if (request.method === 'DELETE') { uploads.delete(url.searchParams.get('uploadId')); response.writeHead(204).end(); return; }
      if (request.method === 'PUT') {
        const bytes = await all(), etag = '"' + createHash('md5').update(bytes).digest('hex') + '"';
        objects.set(key, { bytes, etag, sha256: request.headers['x-amz-meta-sha256'] });
        response.setHeader('ETag', etag); response.end(); return;
      }
      const object = objects.get(key);
      if (!object) { response.writeHead(404).end(); return; }
      if (request.headers['if-match'] && request.headers['if-match'] !== object.etag) { response.writeHead(412).end(); return; }
      response.setHeader('Content-Length', object.bytes.length); response.setHeader('ETag', object.etag);
      response.setHeader('x-amz-meta-sha256', object.sha256); response.setHeader('Last-Modified', new Date().toUTCString());
      if (request.method === 'GET' && request.headers.range) {
        const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range);
        const bytes = object.bytes.subarray(Number(start), Number(end) + 1);
        response.statusCode = 206; response.setHeader('Content-Length', bytes.length);
        response.setHeader('Content-Range', `bytes ${start}-${end}/${object.bytes.length}`);
        response.end(bytes); return;
      }
      response.end(request.method === 'HEAD' ? undefined : object.bytes);
    } catch { response.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new S3Client({ region: 'auto', endpoint: `http://127.0.0.1:${server.address().port}`, forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  t.after(async () => { client.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { client, objects, operations, uploads };
}

test('real S3 multipart upload verifies bytes, produces a pinned private catalogue and resumes without overwrites', async t => {
  const f = await s3Fixture(t), directory = await mkdtemp(join(tmpdir(), '127v-r2-upload-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.alloc(33 * 1024 * 1024, 0x5a), path = join(directory, 'server.tar');
  await writeFile(path, bytes);
  const catalogue = { schemaVersion: 1, sourceRevision: 'a'.repeat(40), issuerPublicKeys: {
    trial: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }),
  }, artifacts: [{ id: 'server', filename: 'server.tar', label: 'Server', path, sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') }] };
  const file = join(directory, 'catalogue.json'); await writeFile(file, JSON.stringify(catalogue));
  await checkLocalCatalogue(file);
  const options = { client: f.client, bucket: 'private', releaseId: 'test', catalogue, log: () => {} };
  const result = await uploadArtifacts(options);
  assert.equal(await catalogueIdentity(result.catalogue), await catalogueIdentity(catalogue));
  const historicalDigest = createHash('sha256').update(JSON.stringify({ sourceRevision: catalogue.sourceRevision,
    issuerPublicKeys: catalogue.issuerPublicKeys, artifacts: catalogue.artifacts.map(({ path: _, ...asset }) => asset) })).digest('hex');
  assert.equal(await catalogueIdentity(result.catalogue), historicalDigest);
  assert.equal(f.uploads.size, 0); assert.ok(f.operations.some(op => op.method === 'PUT' && op.multipart));
  assert.equal(result.catalogue.artifacts[0].path, undefined);
  assert.match(result.catalogue.artifacts[0].etag, /-3$/);
  assert.ok(f.objects.has(result.catalogueKey));
  assert.equal(f.operations.filter(op => op.method === 'GET' && op.key.endsWith('/server.tar')).length, 3);
  const writes = f.operations.filter(op => ['PUT', 'POST'].includes(op.method)).length;
  const resumed = await uploadArtifacts(options);
  assert.equal(resumed.catalogueKey, result.catalogueKey);
  assert.equal(f.operations.filter(op => ['PUT', 'POST'].includes(op.method)).length, writes);
  // A same-size replacement with forged metadata is still caught by remote SHA-256 verification.
  const object = f.objects.get(objectKey('test', catalogue.artifacts[0])); object.bytes = Buffer.alloc(bytes.length, 0x58);
  await assert.rejects(uploadArtifacts(options), /R2 checksum mismatch/);
});

test('artifact preflight refuses local tampering and traversal identifiers', async t => {
  const directory = await mkdtemp(join(tmpdir(), '127v-r2-preflight-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'artifact'));
  const file = join(directory, 'catalogue.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1, sourceRevision: 'a'.repeat(40), issuerPublicKeys: {
    trial: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }),
  }, artifacts: [{ id: 'server', filename: 'server.tar', label: 'Server', path: join(directory, 'artifact'), sizeBytes: 1, sha256: 'a'.repeat(64) }] }));
  await assert.rejects(checkLocalCatalogue(file), /Local checksum mismatch/);
  assert.throws(() => objectKey('../escape', { id: 'server' }), /Invalid release ID/);
  assert.ok(await readFile(file, 'utf8'));
});

test('remote verification refuses ignored ranges, short bodies and changed object identity', async () => {
  const { Readable } = await import('node:stream');
  const response = overrides => ({ ContentRange: 'bytes 0-2/3', ContentLength: 3, Body: Readable.from([Buffer.from('abc')]), ...overrides });
  for (const value of [response({ ContentRange: undefined }), response({ ContentLength: 4 }), response({ Body: Readable.from([Buffer.from('a')]) })]) {
    await assert.rejects(remoteHash({ send: async command => { assert.equal(command.input.IfMatch, 'pinned'); return value; } }, 'private', 'object', 'pinned', 3), /range/);
  }
  await assert.rejects(remoteHash({ send: async () => { throw Error('precondition failed'); } }, 'private', 'object', 'pinned', 3), /precondition/);
});
