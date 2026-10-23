import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = createRequire(new URL('../../../package.json', import.meta.url))('typescript');
const source = await readFile(new URL('../src/field-value-editor.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: name => name === './utils' ? { cn: (...values) => values.filter(Boolean).join(' ') } : require(name) });
const render = (kind, value, extra = {}) => exports.FieldValueEditor({ kind, value, onValueChange() {}, ...extra });

test('numeric strings and imported date text remain editable without losing formatting', () => {
  for (const value of ['000123', '123456789012345678901', '-0.50']) {
    const element = render('number', value);
    assert.equal(element.props.value, value);
    assert.equal(element.props.type, 'text');
    let changed;
    render('number', value, { onValueChange: value => { changed = value; } }).props.onChange({ target: { value: '000456' } });
    assert.equal(changed, '000456');
  }
  for (const value of ['21/10/2026', '2026-02-30']) {
    const element = render('date', value);
    assert.equal(element.props.type, 'text');
    assert.equal(element.props.value, value);
  }
  assert.equal(render('date', '2026-10-21').props.type, 'date');
});

test('notes retain multiline content and web collection attributes', () => {
  const element = render('note', 'first\nsecond', { className: 'typed-value', 'data-field-id': 'note-1' });
  assert.equal(element.type, 'textarea');
  assert.equal(element.props.value, 'first\nsecond');
  assert.equal(element.props['data-field-id'], 'note-1');
  assert.match(element.props.className, /typed-value/);
});

test('secret values are masked unless explicitly revealed and disable text assistance', () => {
  const hidden = render('password', 'secret');
  assert.equal(hidden.props.type, 'password');
  assert.equal(hidden.props.autoComplete, 'off');
  assert.equal(hidden.props.spellCheck, false);
  assert.equal(render('password', 'secret', { revealed: true }).props.type, 'text');
});

test('addresses, phones and SSH text keep their original string values', () => {
  assert.equal(render('phone', '+01 (234) 005').props.inputMode, 'tel');
  const address = render('address', 'One\nTwo');
  assert.equal(address.type, 'textarea');
  const key = 'KEY\r\n  untouched==\r\n';
  const hidden = render('password', key, {'data-field-id':'key',className:'typed-value'});
  const stored = hidden.props.children[0];
  assert.equal(stored.props.type, 'hidden');
  assert.equal(stored.props.value, key);
  assert.equal(stored.props['data-field-id'], 'key');
  const revealed = render('password', key, {revealed:true});
  assert.equal(revealed.type, 'textarea');
  assert.equal(revealed.props.value, key);
  assert.equal(revealed.props['data-original-value'], key);
});
