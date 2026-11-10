import { createServer, connect, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { relayPreface } from './relay-ingress.mjs';

function privateV4(value) {
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function relayConfig(env, interfaces = networkInterfaces()) {
  const target = env.VAULTS_RELAY_TARGET;
  if (!privateV4(target)) throw Error('Relay target must be a private container IPv4 address.');
  const backendPrefix = target.split('.').slice(0, 3).join('.') + '.';
  const addresses = Object.values(interfaces).flat().filter(row => row.family === 'IPv4' && !row.internal
    && privateV4(row.address) && !row.address.startsWith(backendPrefix)).map(row => row.address);
  if (addresses.length !== 1) throw Error('Relay requires exactly one separate ingress interface.');
  const backend = Object.values(interfaces).flat().filter(row => row.family === 'IPv4' && !row.internal && row.address.startsWith(backendPrefix));
  if (backend.length !== 1) throw Error('Relay requires exactly one backend interface.');
  return { bind: addresses[0], backendBind: backend[0].address, target, port: 12780 };
}

// TLS is passed through unchanged. This relay has no private keys, account
// credentials, database access credentials, or visitor-selected destination.
export function createPrivateRelay({ bind, target, port = 12780, targetPort = 12780, backendBind, sourceMetadata = false }) {
  const sockets = new Set();
  const server = createServer({ pauseOnConnect: true }, incoming => {
    if (sockets.size >= 128) { incoming.destroy(); return; }
    sockets.add(incoming);
    const outgoing = connect({ host: target, port: targetPort, ...(backendBind?{localAddress:backendBind}:{}) });
    const deadline = setTimeout(() => outgoing.destroy(), 3000);
    deadline.unref();
    const close = () => { clearTimeout(deadline); incoming.destroy(); outgoing.destroy(); sockets.delete(incoming); };
    incoming.on('error', close); outgoing.on('error', close);
    incoming.on('close', () => { clearTimeout(deadline); outgoing.destroy(); sockets.delete(incoming); });
    outgoing.on('close', () => { if (!outgoing.readableEnded) close(); });
    incoming.setTimeout(120000, close); outgoing.setTimeout(120000, close);
    outgoing.once('connect', () => {
      clearTimeout(deadline);
      if(sourceMetadata){try{outgoing.write(relayPreface(incoming,target,targetPort));}catch{close();return;}}
      incoming.pipe(outgoing); outgoing.pipe(incoming); incoming.resume();
    });
  });
  server.maxConnections = 128;
  server.stop = () => { for (const socket of sockets) socket.destroy(); return new Promise(resolve => server.close(resolve)); };
  server.start = () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, bind, resolve); });
  return server;
}

export async function runPrivateRelay() {
  const config = relayConfig(process.env);
  // Rootless providers may forward to the first attached interface. Listen on
  // both exact container addresses; never use an all-interface listener.
  const relays = [config.bind, config.backendBind].map(bind => createPrivateRelay({ ...config, bind, sourceMetadata:true }));
  if (process.env.VAULTS_LOCAL_ADMIN === '1') {
    for (const bind of [config.bind, config.backendBind]) {
      relays.push(createPrivateRelay({ ...config, bind, port: 12781, targetPort: 12781 }));
    }
  }
  await Promise.all(relays.map(relay => relay.start()));
  const stop = () => { for (const relay of relays) void relay.stop(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}

export async function runRelayHealthcheck() {
  process.env.VAULTS_BIND = relayConfig(process.env).bind;
  await (await import('./healthcheck.mjs')).runHealthcheck();
}
