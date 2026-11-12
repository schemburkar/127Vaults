// The application tsconfig intentionally excludes Node types; Vite executes this file in Node.
// @ts-expect-error Node's built-in types are not part of the browser application.
import { existsSync, readFileSync } from 'node:fs';
// @ts-expect-error Node's built-in types are not part of the browser application.
import { join } from 'node:path';
// @ts-expect-error Node's built-in types are not part of the browser application.
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// @ts-expect-error Release plugin executes in Node and is not browser code.
import { pwaBuild } from './pwa-build.mjs';

export default defineConfig(({ command, mode }) => {
  const webRoot = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), '');
  const webPort = Number(env.VAULTS_DEV_WEB_PORT || 12780), apiPort = Number(env.VAULTS_DEV_API_PORT || 12781);
  if (![webPort, apiPort].every(port => Number.isInteger(port) && port > 1024 && port < 65536) || webPort === apiPort) throw Error('Invalid development UI/API ports.');
  const backend = env.VAULTS_DEV_BACKEND || `https://127.0.0.1:${apiPort}`;
  const publicOrigin = `https://127.0.0.1:${webPort}`;
  const tlsDirectory = env.VAULTS_TLS_DIR;
  const key = tlsDirectory && join(tlsDirectory, 'live', 'server.key');
  const cert = tlsDirectory && join(tlsDirectory, 'live', 'server.crt');
  const hasTls = Boolean(key && cert && existsSync(key) && existsSync(cert));
  if (command === 'serve' && !hasTls) {
    throw new Error('Local TLS files are missing. Run pnpm tls:init before pnpm mvp:dev.');
  }
  const proxy: ProxyOptions = {
    target: backend,
    changeOrigin: true,
    secure: false,
    configure(server) {
      const events = server as unknown as {
        on: (event: 'proxyReq', handler: (request: { setHeader: (name: string, value: string) => void }) => void) => void;
      };
      events.on('proxyReq', request => {
        request.setHeader('host', `127.0.0.1:${webPort}`);
        request.setHeader('origin', publicOrigin);
        request.setHeader('referer', `${publicOrigin}/`);
      });
    },
  };
  const localClientAssets = new Map([
    ['/app/mvp-client.mjs', join(webRoot, 'mvp-client.mjs')],
    ['/app/http-client.mjs', join(webRoot, 'src', 'http-client.mjs')],
    ['/app/client-errors.mjs', join(webRoot, 'src', 'client-errors.mjs')],
    ['/app/private-vault-client.mjs', join(webRoot, 'src', 'private-vault-client.mjs')],
    ['/app/pwa-replica.mjs', join(webRoot, 'src', 'pwa-replica.mjs')],
    ['/app/browser-enrollment.mjs', join(webRoot, 'src', 'browser-enrollment.mjs')],
    ['/app/vault-lifecycle.mjs', join(webRoot, 'src', 'vault-lifecycle.mjs')],
    ['/app/signed-sync.mjs', join(webRoot, 'src', 'signed-sync.mjs')],
    ['/app/passkeys.mjs', join(webRoot, '..', 'extension', 'src', 'passkeys.mjs')],
    ['/app/shared/passkey-metadata.mjs', join(webRoot, '..', '..', 'packages', 'domain', 'src', 'passkey-metadata.mjs')],
    ['/app/shared/connection-help.mjs', join(webRoot, '..', '..', 'packages', 'domain', 'src', 'connection-help.mjs')],
    ['/app/shared/seat-summary.mjs', join(webRoot, '..', '..', 'packages', 'domain', 'src', 'seat-summary.mjs')],
    ['/app/shared/directory-presentation.mjs', join(webRoot, '..', 'server', 'admin', 'directory-presentation.mjs')],
    ['/wasm/vaults_browser_fixture.js', join(webRoot, 'wasm', 'vaults_browser_fixture.js')],
    ['/wasm/vaults_browser_fixture_bg.wasm', join(webRoot, 'wasm', 'vaults_browser_fixture_bg.wasm')],
  ]);
  return {
    plugins: [{
      name: 'local-secure-client-assets',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const asset = localClientAssets.get(new URL((request as { url?: string }).url || '/', publicOrigin).pathname);
          if (!asset) return next();
          try {
            const body = readFileSync(asset);
            response.setHeader('Content-Type', asset.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8');
            response.setHeader('Cache-Control', 'no-store');
            response.end(body);
          } catch { response.statusCode = 503; response.end('Local client asset is unavailable. Run pnpm fixture:build.'); }
        });
        server.watcher.add([...localClientAssets.values()]);
        server.watcher.on('change', path => {
          if ([...localClientAssets.values()].includes(path)) server.ws.send({ type: 'full-reload' });
        });
      },
    }, react(), tailwindcss(), pwaBuild()],
    server: {
      host: '127.0.0.1',
      port: webPort,
      strictPort: true,
      https: hasTls ? { key: readFileSync(key), cert: readFileSync(cert) } : undefined,
      proxy: {
        '/api': proxy,
        '/admin': proxy,
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          entryFileNames: 'app/react-client.js',
          chunkFileNames: 'app/[name]-[hash].js',
          assetFileNames: asset => asset.name?.endsWith('.css') ? 'app/react-style.css' : 'app/[name][extname]'
        }
      }
    }
  };
});
