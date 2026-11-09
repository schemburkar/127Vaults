import { createServer, connect, isIP } from 'node:net';

const addresses=new Map();
const requests=new WeakMap();
export const normalizeAddress=value=>typeof value==='string'&&value.startsWith('::ffff:')&&isIP(value.slice(7))===4?value.slice(7):value;
const incomingKey=socket=>[socket.remoteAddress,socket.remotePort,socket.localAddress,socket.localPort].join('|');
const outgoingKey=socket=>[socket.localAddress,socket.localPort,socket.remoteAddress,socket.remotePort].join('|');

// The private ingress records the connection tuple. A verified Cloud ingress
// can also attach a source before any handler reads it.
export function setVerifiedRequestSource(req, address) {
  const source = normalizeAddress(address);
  if (!isIP(source) || requests.has(req)) throw new Error('Invalid verified request source.');
  requests.set(req, source);
}

export function requestSource(req) {
  if(requests.has(req))return requests.get(req);
  if(!req.socket)return 'unknown';
  const source=addresses.get(incomingKey(req.socket))??normalizeAddress(req.socket.remoteAddress)??'unknown';
  requests.set(req,source);return source;
}

export function relayPreface(incoming,target,targetPort) {
  const source=normalizeAddress(incoming.remoteAddress),destination=normalizeAddress(target);
  const family=isIP(source);
  if(!family||isIP(destination)!==family)throw Error('Unsupported relay address family.');
  return Buffer.from(`PROXY TCP${family} ${source} ${destination} ${incoming.remotePort} ${targetPort}\r\n`,'ascii');
}

export function parseRelayPreface(line,socket) {
  const match=/^PROXY TCP(4|6) ([0-9a-fA-F:.]+) ([0-9a-fA-F:.]+) ([1-9][0-9]{0,4}) ([1-9][0-9]{0,4})\r\n$/.exec(line);
  if(!match||isIP(match[2])!==Number(match[1])||isIP(match[3])!==Number(match[1])
      ||normalizeAddress(match[3])!==normalizeAddress(socket.localAddress)
      ||Number(match[4])>65535||Number(match[5])!==socket.localPort)throw Error('Invalid relay preface.');
  return normalizeAddress(match[2]);
}

// The HTTPS server retains its normal listener and timeout/connection tracking
// on isolated loopback. This bounded TCP ingress removes trusted PROXY metadata
// and forwards the untouched TLS stream to it. No TLS keys are held by relays.
export function createRelayIngress({targetPort,trustedRelayPeer=null}) {
  if(!Number.isInteger(targetPort)||targetPort<1||targetPort>65535)throw Error('Invalid HTTPS target port.');
  if(trustedRelayPeer!==null&&!isIP(trustedRelayPeer))throw Error('Trusted relay must be an exact IP address.');
  const sockets=new Set();
  const server=createServer({pauseOnConnect:true},incoming=>{
    if(sockets.size>=128){incoming.destroy();return;}
    sockets.add(incoming);
    let outgoing,timer,key,buffer=Buffer.alloc(0);
    const close=()=>{clearTimeout(timer);incoming.destroy();outgoing?.destroy();sockets.delete(incoming);if(key)addresses.delete(key);};
    incoming.on('error',close);incoming.on('close',close);incoming.setTimeout(120000,close);
    const forward=(source,tail)=>{
      incoming.pause();
      outgoing=connect({host:'127.0.0.1',port:targetPort});
      timer=setTimeout(close,2000);timer.unref();
      outgoing.on('error',close);outgoing.on('close',close);
      outgoing.once('connect',()=>{
        clearTimeout(timer);key=outgoingKey(outgoing);addresses.set(key,source);
        if(tail.length)outgoing.write(tail);
        incoming.pipe(outgoing);outgoing.pipe(incoming);incoming.resume();
      });
    };
    if(normalizeAddress(incoming.remoteAddress)!==normalizeAddress(trustedRelayPeer)) {
      forward(normalizeAddress(incoming.remoteAddress),Buffer.alloc(0));return;
    }
    // Exactly this peer, on the private backend network, is trusted to provide
    // metadata. A second caller-supplied PROXY line is passed to TLS and fails.
    timer=setTimeout(close,2000);timer.unref();
    const receive=chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      const end=buffer.indexOf('\r\n');
      if(end<0){if(buffer.length>108)close();return;}
      if(end+2>108){close();return;}
      incoming.off('data',receive);clearTimeout(timer);
      try{forward(parseRelayPreface(buffer.subarray(0,end+2).toString('ascii'),incoming),buffer.subarray(end+2));}
      catch{close();}
    };
    incoming.on('data',receive);incoming.resume();
  });
  server.maxConnections=128;
  server.stop=()=>{for(const socket of sockets)socket.destroy();return new Promise(done=>server.close(done));};
  return server;
}
