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
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 12780,
      strictPort: true,
      https: hasTls ? { key: readFileSync(key), cert: readFileSync(cert) } : undefined,
      proxy: {
        '/api': proxy,
        '/app/mvp-client.mjs': {
          ...proxy,
          rewrite: path => path.replace(/\?import$/, ''),
        },
        '/app/private-vault-client.mjs': {
          ...proxy,
          rewrite: path => path.replace(/\?import$/, ''),
        },
        '/wasm': {
          ...proxy,
          rewrite: path => path.replace(/\?import$/, ''),
        },
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
