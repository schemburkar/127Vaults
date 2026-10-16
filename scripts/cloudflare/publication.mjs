import { createReadStream } from 'node:fs';
import { assetFiles, readPublicAsset } from './config.mjs';

const privatePem = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{32,}-----END (?:[A-Z]+ )?PRIVATE KEY-----/;
export function secretPatterns(secrets, environment = process.env) {
  const values = [...Object.values(secrets), ...['CLOUDFLARE_API_TOKEN', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
    .map(name => environment[name])].filter(value => typeof value === 'string' && value.length >= 16);
  const patterns = [...new Set(values.flatMap(value => [value, JSON.stringify(value).slice(1, -1)]))].map(value => Buffer.from(value));
  for (const value of values) {
    if (/^[a-f0-9]{64}$/i.test(value)) patterns.push(Buffer.from(value, 'hex'));
    if (/^-----BEGIN PRIVATE KEY-----/.test(value)) patterns.push(Buffer.from(value.replace(/-----[^\n]+-----|\s/g, ''), 'base64'));
  }
  return patterns.filter(value => value.length >= 16);
}
function check(bytes, patterns, detectPrivatePem = true) {
  const text = detectPrivatePem ? bytes.toString('latin1') : '';
  if ((detectPrivatePem && (privatePem.test(text) || privatePem.test(text.replaceAll('\\r', '\r').replaceAll('\\n', '\n'))))
    || patterns.some(value => bytes.includes(value))) {
    // Never print the matched bytes, field or token in an exception or CI log.
    throw Error('Publication blocked: private key material or a configured secret was found in a delivery payload');
  }
}
export async function scanPayload(chunks, patterns, { detectPrivatePem = true } = {}) {
  const overlap = Math.max(16384, ...patterns.map(value => value.length));
  let previous = Buffer.alloc(0);
  for await (const chunk of chunks) {
    const data = Buffer.concat([previous, Buffer.from(chunk)]); check(data, patterns, detectPrivatePem);
    previous = data.subarray(Math.max(0, data.length - overlap));
  }
}
export async function auditPublication(catalogue, secrets, { environment = process.env, readAsset = readPublicAsset } = {}) {
  const patterns = secretPatterns(secrets, environment);
  check(Buffer.from(JSON.stringify(catalogue)), patterns);
  for (const name of assetFiles) {
    const data = await readAsset(name); check(data, patterns);
    if (name === 'releases.json') {
      const value = JSON.parse(data.toString('utf8'));
      if (value.schemaVersion !== 1 || !Array.isArray(value.releases) || value.releases.length) throw Error('Private trial deployment requires an empty public release catalogue');
    }
  }
  // Binary vendor libraries/images can contain publicly distributed example keys.
  // Always reject actual configured secrets; generic PEM detection applies to public assets and standalone text files.
  for (const asset of catalogue.artifacts) await scanPayload(createReadStream(asset.path), patterns,
    { detectPrivatePem: /\.(?:md|mjs|json)$/.test(asset.filename) || asset.filename === 'SHA256SUMS' });
  return { publicFiles: assetFiles.length, privateArtifacts: catalogue.artifacts.length };
}
