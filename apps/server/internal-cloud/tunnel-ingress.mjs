import { isIP } from 'node:net';
import { HttpBoundaryError } from '../src/http-boundary.mjs';
import { normalizeAddress, setVerifiedRequestSource } from '../src/relay-ingress.mjs';

export function applyCloudTunnelIngress(req) {
  if (!req.socket?.encrypted || normalizeAddress(req.socket.remoteAddress) !== '127.0.0.1' ||
      req.headers['cf-worker'] !== undefined) throw new HttpBoundaryError(403, 'untrusted_ingress');
  const addresses = req.rawHeaders.filter((value, index) => index % 2 === 1 &&
    req.rawHeaders[index - 1].toLowerCase() === 'cf-connecting-ip');
  if (addresses.length !== 1 || !isIP(addresses[0])) throw new HttpBoundaryError(403, 'untrusted_ingress');
  setVerifiedRequestSource(req, addresses[0]);
  for (const name of Object.keys(req.headers)) {
    if (name === 'forwarded' || name.startsWith('x-forwarded-')) delete req.headers[name];
  }
}
