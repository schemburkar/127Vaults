import { isIP } from 'node:net';

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
  const portText = env.PORT ?? '12780';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  if (!['loopback', 'private-lan'].includes(mode)) throw new Error('Unsupported access mode.');
  if (mode === 'loopback') {
    if (!['127.0.0.1', '::1'].includes(publication)) throw new Error('Loopback mode requires loopback publication.');
    if (!['localhost', '127.0.0.1', '::1'].includes(endpoint)) throw new Error('Loopback endpoint must be localhost or literal loopback.');
  } else if (!privateV4(endpoint) || publication !== endpoint) {
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
  const hosts = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host');
  if (hosts.length !== 1 || req.headers.host !== config.authority) return false;
  if (req.headers.origin !== undefined && req.headers.origin !== config.origin) return false;
  return !Object.keys(req.headers).some(name => name === 'forwarded' || name.startsWith('x-forwarded-'));
}

export function sniAllowed(servername, config) {
  return servername === '' ? config.ipEndpoint : servername === config.endpoint;
}
