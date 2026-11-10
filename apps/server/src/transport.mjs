import { isIP } from 'node:net';
import { validServerHostname } from './hostname.mjs';

const privateV4 = value => {
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

export function transportConfig(env) {
  const mode = env.VAULTS_ACCESS_MODE ?? 'loopback';
  const bind = env.VAULTS_BIND ?? '127.0.0.1';
  const endpoint = env.VAULTS_ENDPOINT_HOST ?? '127.0.0.1';
  const publication = env.VAULTS_PUBLISH_ADDRESS ?? '127.0.0.1';
  const networkAddress = env.VAULTS_NETWORK_ADDRESS ?? endpoint;
  const portText = env.PORT ?? '12780';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  if (!['loopback', 'private-lan', 'tailscale'].includes(mode)) throw new Error('Unsupported access mode.');
  if (mode === 'loopback') {
    if (!['127.0.0.1', '::1'].includes(publication)) throw new Error('Loopback mode requires loopback publication.');
    if (!['localhost', '127.0.0.1', '::1'].includes(endpoint)) throw new Error('Loopback endpoint must be localhost or literal loopback.');
  } else if (mode === 'tailscale') {
    const [a, b] = networkAddress.split('.').map(Number);
    if (isIP(networkAddress) !== 4 || a !== 100 || b < 64 || b > 127
      || (endpoint !== networkAddress && !validServerHostname(endpoint))
      || publication !== '127.0.0.1' || !privateV4(bind)) throw new Error('Tailscale mode requires a tailnet IPv4 address, exact hostname and loopback-only publication.');
  } else if (!privateV4(networkAddress) || publication !== networkAddress
    || (endpoint !== networkAddress && !validServerHostname(endpoint))) {
    throw new Error('Private-LAN mode requires one identical private IPv4 endpoint and publication address.');
  }
  if (['0.0.0.0', '::'].includes(bind)) throw new Error('Wildcard bind is forbidden.');
  if (mode === 'loopback' && bind !== '127.0.0.1' && bind !== '::1' && !privateV4(bind)) throw new Error('Invalid container bind.');
  if (mode === 'private-lan' && !privateV4(bind)) throw new Error('Private-LAN container bind must be private.');
  const displayHost = endpoint.includes(':') ? `[${endpoint}]` : endpoint;
  const authority = `${displayHost}:${port}`;
  return { mode, bind, endpoint, publication, port, authority, origin: `https://${authority}`, ipEndpoint: isIP(endpoint) !== 0 };
}

export function requestAllowed(req, config) {
  // This is an origin server, not a proxy. Reject targets whose URL parsing
  // could throw in a downstream handler or select another authority.
  if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')
    || /[\\#\u0000-\u0020\u007f]/.test(req.url)) return false;
  try { if (new URL(req.url, config.origin).origin !== config.origin) return false; }
  catch { return false; }
  const hosts = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host');
  if (hosts.length !== 1 || req.headers.host !== config.authority) return false;
  if (req.headers.origin !== undefined && req.headers.origin !== config.origin) return false;
  return !Object.keys(req.headers).some(name => name === 'forwarded' || name.startsWith('x-forwarded-'));
}

export function sniAllowed(servername, config) {
  return servername === '' ? config.ipEndpoint : servername === config.endpoint;
}

export function localAdminRequestAllowed(req, config, relayPeer) {
  return isIP(relayPeer) === 4 && req.socket.remoteAddress === relayPeer && requestAllowed(req, config);
}
