// .localhost is reserved for loopback use; never accept a hostname merely containing it.
export function isLoopbackHostname(hostname) {
  return ['localhost', '127.0.0.1'].includes(hostname)
    || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+localhost$/.test(hostname);
}
export function validIntakeOrigin(origin, allowLoopbackHttp = false) {
  try {
    const url = new URL(origin);
    return url.origin === origin && (url.protocol === 'https:'
      || (allowLoopbackHttp && url.protocol === 'http:' && isLoopbackHostname(url.hostname)));
  } catch { return false; }
}
