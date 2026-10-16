export function validIntakeOrigin(origin, allowLoopbackHttp = false) {
  try {
    const url = new URL(origin);
    return url.origin === origin && (url.protocol === 'https:'
      || (allowLoopbackHttp && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
  } catch { return false; }
}
