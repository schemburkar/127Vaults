import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('shared read-only details render grouped credentials, related fields and distinct window actions', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { ReadonlyItem } = await server.ssrLoadModule('/src/readonly-item.tsx');
    const html = renderToStaticMarkup(createElement(ReadonlyItem, {
      item: { title: 'Example login', website: 'https://example.com', username: 'alice', password: 'secret-value', customFields: [] },
      revealed: new Set(), toggleReveal() {}, copyValue: async () => {}, dragValue() {}, endDrag() {}, openWebsite() {},
      requireRevealForDrag: true, actions: createElement('button', null, 'Close'),
    }));
    assert.match(html, /Example login/);
    assert.match(html, /alice/);
    assert.match(html, /Copy Username/);
    assert.match(html, /Reveal Password/);
    assert.match(html, /Copy Password/);
    assert.doesNotMatch(html, /secret-value|Item window|Duplicate/);
    assert.match(html, /disabled=""[^>]*draggable="false"[^>]*aria-label="Drag Password"|aria-label="Drag Password"[^>]*disabled=""/);
  } finally { await server.close(); }
});
