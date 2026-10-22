import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('saving a collapsed related detail retains its marker and every field once', async () => {
  const source = await readFile(new URL('../mvp-client.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function fieldInputValue(input) {');
  const end = source.indexOf('\nfunction renderCustomFields(', start);
  assert.ok(start >= 0 && end > start);
  const marker = { dataset: { fieldId: '__127vaults_section:card-1', fieldLabel: 'Section', fieldType: 'metadata' }, value: 'card|Daily spending card' };
  const cardNumber = { dataset: { fieldId: '__127vaults_field:card-1:card_number', fieldLabel: 'Card number', fieldType: 'password' }, value: 'fictional-card-number' };
  const document = { querySelectorAll(selector) {
    if (selector === '#custom-fields .custom-field') return [];
    if (selector === '#custom-fields .typed-value') return [cardNumber];
    if (selector === '#custom-fields input.item-metadata[data-field-id]') return [marker];
    throw Error(`Unexpected selector: ${selector}`);
  } };
  const collect = new Function('document', 'normalizeWebsite', 'editorPasskeyFields', `${source.slice(start, end)}; return collectCustomFields;`)(document, (value) => value, []);
  assert.deepEqual(collect(), [
    { id: marker.dataset.fieldId, label: 'Section', type: 'metadata', value: marker.value },
    { id: cardNumber.dataset.fieldId, label: 'Card number', type: 'password', value: cardNumber.value },
  ]);
  cardNumber.dataset.fieldLabel = '';
  assert.throws(() => collect(), /CUSTOM_FIELD_NAME_REQUIRED/);
});

test('custom field saving reads the styled picker value and preserves string values', async () => {
  const source = await readFile(new URL('../mvp-client.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function fieldInputValue(input) {');
  const end = source.indexOf('\nfunction renderCustomFields(', start);
  let kind = 'password', value = '000123';
  const row = { dataset: { fieldId: 'custom-1' }, querySelector(selector) {
    if (selector === '.custom-label') return { value: 'Recovery secret' };
    if (selector === '.field-type-value') return { value: kind };
    if (selector === '.custom-value') return { value };
    throw Error('Unexpected selector: ' + selector);
  }};
  const document = { querySelectorAll: selector => selector === '#custom-fields .custom-field' ? [row] : [] };
  const collect = new Function('document', 'normalizeWebsite', 'editorPasskeyFields', source.slice(start, end) + '; return collectCustomFields;')(document, value => value, []);
  for (const type of ['password', 'text', 'number', 'note', 'date', 'email', 'url']) {
    kind = type;
    value = type === 'note' ? 'line one\nline two' : '000123';
    assert.deepEqual(collect(), [{ id: 'custom-1', label: 'Recovery secret', type, value }]);
  }
});
