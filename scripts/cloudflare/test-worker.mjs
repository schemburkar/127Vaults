import { build } from 'esbuild';
const bundles = new Map();
export function testWorker(entryPoint) {
  if (!bundles.has(entryPoint)) bundles.set(entryPoint, build({
    entryPoints: [entryPoint], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    external: ['cloudflare:workers'],
  }).then(result => result.outputFiles[0].text));
  return bundles.get(entryPoint);
}
