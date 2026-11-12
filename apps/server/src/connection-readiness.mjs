export function connectionReadiness(connection,tlsExpiresAt,now=Date.now()) {
  const u=new URL(connection.serverUrl),host=u.hostname.replace(/^\[|\]$/g,'');
  const local=host==='localhost'||host==='::1'||/^127\./.test(host);
  const days=Math.floor((Date.parse(tlsExpiresAt)-now)/86400000);
  return {serverName:connection.serverName,serverUrl:u.origin,localOnly:local,
    certificateDays:Number.isFinite(days)?days:null,certificateState:!Number.isFinite(days)?'unknown':days<0?'expired':days<30?'renew-soon':'valid',
    sharing:local?'This address works only on the server computer. Configure a private-LAN or Tailscale endpoint before sharing with other computers.':'This address is configured for a private network. Each recipient must be on that network; confirm access from their computer before sharing.',
    browserTrust:'Desktop import pins the public CA for Desktop only. A new browser needs its own certificate trust; device approval can use an already trusted device.'};
}
