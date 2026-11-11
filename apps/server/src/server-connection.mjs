import { createHash, X509Certificate } from 'node:crypto';

// Public connection material only; never include runtime credentials or private keys.
export function serverConnection({ serverUrl, installationId, caCertificate, serverName = '127Vaults private server', leafCertificate }) {
  const url = new URL(serverUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installationId)
    || typeof serverName !== 'string' || !serverName.trim() || serverName.length > 100 || /[\x00-\x1f\x7f]/.test(serverName)
    || Buffer.byteLength(caCertificate) > 16384 || caCertificate.includes('PRIVATE KEY')) throw Error('Invalid server connection');
  const ca = new X509Certificate(caCertificate);
  if (!ca.ca) throw Error('Connection requires a CA certificate');
  if (leafCertificate && !new X509Certificate(leafCertificate).verify(ca.publicKey)) throw Error('CA does not verify server certificate');
  const pem = ca.toString();
  return { schemaVersion: 1, kind: '127vaults-server-connection', serverName: serverName.trim(),
    serverUrl: url.origin, installationId, caCertificate: pem,
    caSha256: createHash('sha256').update(pem).digest('hex') };
}
