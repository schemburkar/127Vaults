import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./theme.mjs', import.meta.url), 'utf8');
function page(saved, storageBlocked = false) {
  const root = { dataset: {}, style: {} }, attributes = {}, metadata = {};
  let click;
  const button = { setAttribute: (key, value) => { attributes[key] = value; }, addEventListener: (_, handler) => { click = handler; } };
  vm.runInNewContext(source, {
    document: { addEventListener() {}, documentElement: root, querySelector: selector => selector === '[data-theme-toggle]' ? button : { setAttribute: (key, value) => { metadata[key] = value; } } },
    localStorage: {
      getItem: () => { if (storageBlocked) throw Error('unavailable'); return saved; },
      setItem: (_, value) => { if (storageBlocked) throw Error('unavailable'); saved = value; },
    },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
    getComputedStyle: () => ({ getPropertyValue: name => name === '--brand-navy' ? '#04071d' : '#e0bb95' }),
  });
  return { root, attributes, metadata, click: () => click(), saved: () => saved };
}

test('new visitors get dark mode even when their system prefers light', () => {
  for (const saved of [null, 'invalid']) {
    const view = page(saved);
    assert.equal(view.root.dataset.theme, 'dark');
    assert.equal(view.root.style.colorScheme, 'dark');
    assert.equal(view.metadata.content, '#04071d');
    assert.equal(view.attributes['aria-label'], 'Switch to light theme');
  }
});

test('returning visitors retain their chosen theme and can switch both ways', () => {
  const view = page('light');
  assert.equal(view.root.dataset.theme, 'light');
  view.click();
  assert.equal(view.root.dataset.theme, 'dark');
  assert.equal(view.saved(), 'dark');
  view.click();
  assert.equal(view.root.dataset.theme, 'light');
  assert.equal(view.saved(), 'light');
  assert.equal(page('dark').root.dataset.theme, 'dark');
});

test('blocked browser storage still defaults to dark and allows toggling', () => {
  const view = page(null, true);
  assert.equal(view.root.dataset.theme, 'dark');
  view.click();
  assert.equal(view.root.dataset.theme, 'light');
});
