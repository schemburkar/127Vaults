import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { fileHash } from '../release/verify-release.mjs';
import { validateCatalogue, publicArtifact } from '../../apps/public-intake/cloudflare/catalogue.mjs';

export function objectKey(releaseId, asset) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(releaseId)) throw Error('Invalid release ID');
  return `releases/${releaseId}/${asset.id}/${asset.sha256}/${asset.filename}`;
}
export async function checkLocalCatalogue(file) {
  const catalogue = validateCatalogue(JSON.parse(await readFile(file, 'utf8')), { local: true });
  const cloud = { ...catalogue, artifacts: [] };
  for (const asset of catalogue.artifacts ?? []) {
    if (typeof asset.path !== 'string') throw Error('Local catalogue requires artifact paths');
    const info = await lstat(asset.path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== asset.sizeBytes || await fileHash(asset.path) !== asset.sha256) throw Error(`Local checksum mismatch: ${asset.id}`);
    cloud.artifacts.push({ ...publicArtifact(asset), objectKey: objectKey('preflight', asset), etag: '0' });
  }
  validateCatalogue(cloud);
  return catalogue;
}
export function r2Client(accountId, credentials = process.env) {
  if (!credentials.R2_ACCESS_KEY_ID || !credentials.R2_SECRET_ACCESS_KEY) throw Error('Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY for private multipart uploads');
  return new S3Client({ region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: credentials.R2_ACCESS_KEY_ID, secretAccessKey: credentials.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
}
export async function head(client, bucket, key) {
  try { return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); }
  catch (error) { if (error.$metadata?.httpStatusCode === 404 || error.name === 'NotFound') return null; throw error; }
}
export async function remoteHash(client, bucket, key, etag, size, log = () => {}) {
  if (!Number.isSafeInteger(size) || size < 1) throw Error('Invalid remote verification size');
  const digest = createHash('sha256');
  // Large full-object streams can stall on the delivery path. Bounded ranges
  // retain complete byte verification while pinning every request to one ETag.
  const part = 16 * 1024 * 1024;
  for (let offset = 0; offset < size; offset += part) {
    const end = Math.min(size, offset + part) - 1, length = end - offset + 1;
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: etag,
      Range: `bytes=${offset}-${end}` }), { abortSignal: AbortSignal.timeout(30000) });
    if (response.ContentRange !== `bytes ${offset}-${end}/${size}` || response.ContentLength !== length) {
      response.Body?.destroy(); throw Error('Remote verification range mismatch');
    }
    let received = 0;
    for await (const chunk of response.Body) {
      received += chunk.length;
      if (received > length) { response.Body.destroy(); throw Error('Remote verification range overflow'); }
      digest.update(chunk);
    }
    if (received !== length) throw Error('Remote verification range truncated');
    if ((end + 1) % (128 * 1024 * 1024) === 0 || end + 1 === size && size > part) log(`  ${end + 1}/${size} bytes verified`);
  }
  return digest.digest('hex');
}
export async function uploadArtifacts({ client, bucket, releaseId, catalogue, log = console.log }) {
  validateCatalogue(catalogue, { local: true });
  const artifacts = [];
  for (const asset of catalogue.artifacts) {
    const key = objectKey(releaseId, asset);
    let existing = await head(client, bucket, key);
    if (!existing) {
      log(`Uploading ${asset.filename} (${asset.sizeBytes} bytes)`);
      // Wrangler object put is limited to 315 MB. Multipart handles our 835 MB server archive and larger future releases.
      await new Upload({ client, queueSize: 2, partSize: 16 * 1024 * 1024, leavePartsOnError: false,
        params: { Bucket: bucket, Key: key, Body: createReadStream(asset.path), ContentLength: asset.sizeBytes,
          ContentType: 'application/octet-stream', CacheControl: 'private, no-store',
          Metadata: { sha256: asset.sha256 }, StorageClass: 'STANDARD' } }).done();
      existing = await head(client, bucket, key);
    }
    if (!existing || existing.ContentLength !== asset.sizeBytes || existing.Metadata?.sha256 !== asset.sha256) throw Error(`R2 object metadata mismatch: ${asset.id}; refusing overwrite`);
    log(`Verifying R2 SHA-256: ${asset.filename}`);
    if (await remoteHash(client, bucket, key, existing.ETag, asset.sizeBytes, log) !== asset.sha256) throw Error(`R2 checksum mismatch: ${asset.id}`);
    artifacts.push({ ...publicArtifact(asset), objectKey: key, etag: existing.ETag.replaceAll('"', '') });
  }
  const cloudCatalogue = validateCatalogue({ ...catalogue, artifacts });
  const text = JSON.stringify(cloudCatalogue, null, 2) + '\n';
  const sha256 = createHash('sha256').update(text).digest('hex');
  const catalogueKey = `releases/${releaseId}/catalogues/${sha256}.json`;
  const existing = await head(client, bucket, catalogueKey);
  if (!existing) await client.send(new PutObjectCommand({ Bucket: bucket, Key: catalogueKey, Body: text,
    ContentType: 'application/json', CacheControl: 'private, no-store', Metadata: { sha256 } }));
  const verified = await head(client, bucket, catalogueKey);
  if (!verified || await remoteHash(client, bucket, catalogueKey, verified.ETag, Buffer.byteLength(text)) !== sha256) throw Error('R2 catalogue verification failed');
  return { catalogue: cloudCatalogue, catalogueKey, catalogueSha256: sha256 };
}
