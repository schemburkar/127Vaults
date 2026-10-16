import { hash } from './crypto.mjs';

export function publicArtifact({ objectKey: _, etag: __, path: ___, ...asset }) { return asset; }
export function validateCatalogue(value) {
  if (value?.schemaVersion !== 1 || !/^[a-f0-9]{40,64}$/.test(value.sourceRevision)
    || !Array.isArray(value.artifacts) || !value.artifacts.length || value.artifacts.length > 100
    || !value.issuerPublicKeys || typeof value.issuerPublicKeys !== 'object') throw Error('Invalid catalogue');
  const ids = new Set();
  for (const asset of value.artifacts) {
    if (!/^[a-z0-9-]{1,60}$/.test(asset.id) || ids.has(asset.id)
      || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$/.test(asset.filename)
      || typeof asset.label !== 'string' || asset.label.length > 240
      || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 1
      || typeof asset.objectKey !== 'string' || !/^[A-Za-z0-9/_.-]{1,500}$/.test(asset.objectKey)
      || asset.objectKey.split('/').some(part => !part || part === '.' || part === '..')
      || !/^[a-f0-9-]{1,100}$/i.test(asset.etag ?? '') || Object.hasOwn(asset, 'path')) throw Error('Invalid artifact');
    ids.add(asset.id);
  }
  if (!ids.has('server')) throw Error('Missing server artifact');
  return value;
}
export async function catalogueIdentity(catalogue) {
  // Same logical identity as disk distribution; R2 locations and ETags are transport metadata.
  return hash(JSON.stringify({ sourceRevision: catalogue.sourceRevision, issuerPublicKeys: catalogue.issuerPublicKeys,
    artifacts: catalogue.artifacts.map(publicArtifact) }));
}
