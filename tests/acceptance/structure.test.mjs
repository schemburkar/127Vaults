import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const workflows = [
  ['web/pwa-browser-smoke.mjs', 'pwa-browser-smoke.mjs'],
  ['web/item-workspace-browser-smoke.mjs', 'item-workspace-browser-smoke.mjs'],
  ['web/item-workspace-web-smoke.mjs', 'item-workspace-web-smoke.mjs'],
  ['desktop/item-workspace-desktop-smoke.mjs', 'item-workspace-desktop-smoke.mjs'],
];
const run = promisify(execFile);

test('isolated acceptance syntax and imports resolve without executing fixture code', async () => {
  for (const [current, former] of workflows) {
    const url = new URL(current, import.meta.url);
    const source = await readFile(url, 'utf8');
    assert.ok(!current.endsWith('.test.mjs'));
    await run(process.execPath, ['--check', fileURLToPath(url)], { windowsHide: true });
    for (const match of source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?|new URL\(\s*)['"](\.{1,2}\/[^'"`$]+)['"]/g)) await access(new URL(match[1], url));
    const shim = await readFile(new URL(`scripts/${former}`, root), 'utf8');
    assert.ok(shim.includes(`tests/acceptance/${current}`));
  }
});
