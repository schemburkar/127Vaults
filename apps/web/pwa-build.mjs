import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const PWA_FILES = [
  ['app/mvp-client.mjs', 'mvp-client.mjs'],
  ['app/pwa-replica.mjs', 'src/pwa-replica.mjs'],
  ['app/browser-enrollment.mjs', 'src/browser-enrollment.mjs'],
  ['app/vault-lifecycle.mjs', 'src/vault-lifecycle.mjs'],
  ['app/signed-sync.mjs', 'src/signed-sync.mjs'],
  ['app/private-vault-client.mjs', 'src/private-vault-client.mjs'],
  ['app/passkeys.mjs', '../extension/src/passkeys.mjs'],
  ['wasm/vaults_browser_fixture.js', 'wasm/vaults_browser_fixture.js'],
  ['wasm/vaults_browser_fixture_bg.wasm', 'wasm/vaults_browser_fixture_bg.wasm'],
];
export function pwaBuild() {
  return {
    name: '127vaults-offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const digest = createHash('sha256');
      const assets = [];
      for (const [name, asset] of Object.entries(bundle)) {
        digest.update(name).update(asset.type === 'chunk' ? asset.code : asset.source);
        assets.push(`/${name}`);
      }
      for (const [name, source] of PWA_FILES) {
        // Bundle every runtime dependency with the release. This also makes the
        // service-worker revision change whenever crypto or protocol code changes.
        const bytes = readFileSync(new URL(source, import.meta.url));
        digest.update(name).update(bytes);
        this.emitFile({ type: 'asset', fileName: name, source: bytes });
        assets.push(`/${name}`);
      }
      for (const name of ['brand-mark.svg', 'wordmark.svg', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']) {
        digest.update(readFileSync(new URL(`public/${name}`, import.meta.url)));
        assets.push(`/${name}`);
      }
      const template = readFileSync(new URL('service-worker.template.js', import.meta.url), 'utf8');
      digest.update(template);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: template
        .replace('__SHELL_VERSION__', JSON.stringify(digest.digest('hex').slice(0, 20)))
        .replace('__SHELL_ASSETS__', JSON.stringify([...new Set(['/', ...assets.filter(path => path !== '/index.html')])])) });
    },
  };
}
