import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = await readFile(new URL('../src/authenticator.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
const statuses = [];
vm.runInNewContext(compiled, { exports, require: name => {
  if (name === 'react') return { useState: initial => [initial, value => statuses.push(value)] };
  if (name === './product-features.mjs') return { parseTotp() {} };
  if (name.startsWith('./')) return { Button: 'button', Input: 'input', IconButton: 'button' };
  return require(name);
}});
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}

test('setup stays masked and is copied exactly only on explicit button click', async () => {
  for (const value of ['JBSWY3DPEHPK3PXP', 'otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&issuer=Example']) {
    const copied = [];
    const tree = exports.AuthenticatorEditor({ value, onChange() {}, copy: async v => copied.push(v) });
    const all = nodes(tree);
    const input = all.find(n => n.type === 'input');
    assert.equal(input.props.type, 'password');
    assert.equal(input.props.value, value);
    const buttons = all.filter(n => n.type === 'button');
    assert.equal(buttons.length, 1, 'no reveal control');
    assert.deepEqual(copied, []);
    buttons[0].props.onClick();
    await Promise.resolve();
    assert.deepEqual(copied, [value]);
    assert.equal(input.props.type, 'password');
  }
});

test('empty setup disables copying and clipboard failures stay local', async () => {
  const tree = exports.AuthenticatorEditor({ value: '', onChange() {}, copy: async () => {} });
  assert.equal(nodes(tree).find(n => n.type === 'button').props.disabled, true);
  const failed = exports.AuthenticatorEditor({ value: 'setup', onChange() {}, copy: async () => { throw Error('clipboard denied'); } });
  nodes(failed).find(n => n.type === 'button').props.onClick();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(statuses.at(-1), 'Could not copy setup value');
});
