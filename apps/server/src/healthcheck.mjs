import { readFileSync } from 'node:fs';
import { get } from 'node:https';
import { checkServerIdentity } from 'node:tls';

// Container liveness only. Schema-aware readiness remains operator-authenticated.
const host = process.env.VAULTS_BIND ?? '127.0.0.1';
const port = process.env.PORT ?? '12780';
const endpoint = process.env.VAULTS_ENDPOINT_HOST ?? '127.0.0.1';
try {
  const body = await new Promise((resolve, reject) => {
    const request = get({ hostname: host, port, path: '/health/live',
      headers: { host: `${endpoint.includes(':') ? `[${endpoint}]` : endpoint}:${port}` },
      ca: readFileSync('/run/secrets/tls/ca.crt'), servername: '',
      checkServerIdentity: (_name, certificate) => checkServerIdentity(endpoint, certificate), timeout: 3000 }, response => {
      let data = ''; response.on('data', chunk => { data += chunk; });
      response.on('end', () => response.statusCode === 200 ? resolve(data) : reject(new Error('bad status')));
    });
    request.on('timeout', () => request.destroy(new Error('timeout'))); request.on('error', reject);
  });
  if (JSON.parse(body).status !== 'ok') process.exitCode = 1;
} catch { process.exitCode = 1; }
