// Explicit dependencies keep session state in the composition entry point.
export function createRemoteCall({ installedApp, getCsrf, send = (...args) => fetch(...args), online = () => navigator.onLine }) {
  return async function remoteCall(path, { method = "GET", body, token = getCsrf() } = {}) {
  if (installedApp && online() === false) throw Error('SERVER_UNREACHABLE');
  let h = {};
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    h["X-127V-CSRF"] = token;
  }
  let r;
  try {
    r = await send(path, {
      method,
      credentials: "same-origin",
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw Error(
      e.name === "TimeoutError" ? "SERVER_TIMEOUT" : "SERVER_UNREACHABLE",
    );
  }
  let v;
  try {
    v = await r.json();
  } catch {
    throw Error("INVALID_SERVER_RESPONSE");
  }
  if (!r.ok) { const error = Error(v.error === 'base_changed' ? 'BASE_CHANGED' : v.error ?? `HTTP_${r.status}`); error.status = r.status; throw error; }
  return v;
};
}
