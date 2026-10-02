// Fixed-schema operational events. Never pass request paths, headers or bodies.
export function createOpsTelemetry({ now = () => Date.now(), sink = line => process.stderr.write(line + '\n') } = {}) {
  const started = now();
  const counts = { success: 0, clientError: 0, serverError: 0 };
  const log = (event, fields = {}) => sink(JSON.stringify({ time: new Date(now()).toISOString(), event, ...fields }));
  return {
    request(method, status, elapsedMs, emit = true) {
      const group = status >= 500 ? 'serverError' : status >= 400 ? 'clientError' : 'success';
      counts[group] += 1;
      if (emit) log('http_request', { method: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(method) ? method : 'OTHER', status, elapsedMs: Math.max(0, Math.round(elapsedMs)) });
    },
    event(name) {
      if (!['server_started', 'server_stopping', 'database_pool_error', 'listener_error'].includes(name)) throw Error('Unknown operational event.');
      log(name);
    },
    snapshot() { return { uptimeSeconds: Math.floor((now() - started) / 1000), requests: { ...counts } }; }
  };
}
