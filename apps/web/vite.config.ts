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

export default defineConfig(({ command, mode }) => {
  const webRoot = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), '');
  const backend = env.VAULTS_DEV_BACKEND || 'https://127.0.0.1:12781';
  const publicOrigin = 'https://127.0.0.1:12780';
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
        request.setHeader('host', '127.0.0.1:12780');
        request.setHeader('origin', publicOrigin);
        request.setHeader('referer', `${publicOrigin}/`);
      });
    },
  };
  const localClientAssets = new Map([
    ['/app/mvp-client.mjs', join(webRoot, 'mvp-client.mjs')],
    ['/app/private-vault-client.mjs', join(webRoot, 'src', 'private-vault-client.mjs')],
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
    }, react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 12780,
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
