import { hash } from './crypto.mjs';

const publicFields = new Set(['id', 'filename', 'label', 'sha256', 'sizeBytes', 'sourceRevision', 'product', 'platform', 'supporting']);
export function publicArtifact(asset) {
  // Retain field ordering for existing release identities, but never forward arbitrary operator configuration.
  return Object.fromEntries(Object.entries(asset).filter(([key]) => publicFields.has(key)));
}
export function validateCatalogue(value, { local = false } = {}) {
  if (value?.schemaVersion !== 1 || !/^[a-f0-9]{40,64}$/.test(value.sourceRevision)
    || Object.keys(value).some(key => !['schemaVersion', 'sourceRevision', 'issuerPublicKeys', 'requiredFeatureRevision', 'artifacts', 'serverMajorVersion', 'previousMajors'].includes(key))
    || !Array.isArray(value.artifacts) || !value.artifacts.length || value.artifacts.length > 100
    || !value.issuerPublicKeys || typeof value.issuerPublicKeys !== 'object' || Array.isArray(value.issuerPublicKeys)
    || !Object.keys(value.issuerPublicKeys).length || Object.keys(value.issuerPublicKeys).length > 8
    || Object.entries(value.issuerPublicKeys).some(([id, pem]) => !/^[A-Za-z0-9_-]{1,40}$/.test(id)
      || typeof pem !== 'string' || !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(pem))) throw Error('Invalid catalogue');
  if (value.serverMajorVersion !== undefined && (!Number.isSafeInteger(value.serverMajorVersion) || value.serverMajorVersion < 0)) throw Error('Invalid server major');
  if (value.previousMajors !== undefined && (!Array.isArray(value.previousMajors) || value.previousMajors.length > 50
    || new Set(value.previousMajors.map(v => v?.majorVersion)).size !== value.previousMajors.length
    || value.previousMajors.some(v => !v || Object.keys(v).sort().join(',') !== 'majorVersion,objectKey,sha256'
      || !Number.isSafeInteger(v.majorVersion) || v.majorVersion < 0
      || !/^releases\/[A-Za-z0-9/_.-]+$/.test(v.objectKey ?? '') || v.objectKey.split('/').some(p => p === '..' || p === '.' || !p)
      || !/^[a-f0-9]{64}$/.test(v.sha256 ?? '')))) throw Error('Invalid previous major catalogues');
  const ids = new Set();
  for (const asset of value.artifacts) {
    if (!asset || typeof asset !== 'object' || Object.keys(asset).some(key => !publicFields.has(key)
      && !(local ? key === 'path' : ['objectKey', 'etag'].includes(key)))
      || !/^[a-z0-9-]{1,60}$/.test(asset.id) || ids.has(asset.id)
      || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$/.test(asset.filename)
      || (!/\.(?:tar(?:\.gz)?|zip|exe|AppImage|deb|md|mjs|json)$/.test(asset.filename) && asset.filename !== 'SHA256SUMS')
      || /(?:^|[_.-])(?:secret|secrets|token|credentials|requests|backup|revocation|trial-license)(?:[_.-]|$)/i.test(asset.filename)
      || typeof asset.label !== 'string' || asset.label.length > 240
      || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 1
      || (local ? typeof asset.path !== 'string' || !asset.path :
        typeof asset.objectKey !== 'string' || !/^[A-Za-z0-9/_.-]{1,500}$/.test(asset.objectKey)
        || asset.objectKey.split('/').some(part => !part || part === '.' || part === '..')
        || !/^[a-f0-9-]{1,100}$/i.test(asset.etag ?? ''))) throw Error('Invalid artifact');
    ids.add(asset.id);
  }
  if (!ids.has('server')) throw Error('Missing server artifact');
  serverMajor(value);
  return value;
}
export async function catalogueIdentity(catalogue) {
  // Same logical identity as disk distribution; R2 locations and ETags are transport metadata.
  return hash(JSON.stringify({ sourceRevision: catalogue.sourceRevision, issuerPublicKeys: catalogue.issuerPublicKeys,
    artifacts: catalogue.artifacts.map(publicArtifact),
    ...(catalogue.serverMajorVersion !== undefined ? { serverMajorVersion: catalogue.serverMajorVersion } : {}),
    ...(catalogue.previousMajors ? { previousMajors: catalogue.previousMajors } : {}) }));
}

export function serverMajor(catalogue) {
  const match = /(?:^|-)server-(\d+)\.\d+\.\d+(?:-|\.)/.exec(catalogue.artifacts.find(a => a.id === 'server')?.filename ?? '');
  const inferred = match ? Number(match[1]) : 0;
  if (catalogue.serverMajorVersion !== undefined && match && catalogue.serverMajorVersion !== inferred) throw Error('Server major mismatch');
  return catalogue.serverMajorVersion ?? inferred;
}
