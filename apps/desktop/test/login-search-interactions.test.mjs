import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/app.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('app.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(tag, attribute, identify = () => true) {
  let found;
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === tag && identify(node.getText(ast))) {
      const prop = node.attributes.properties.find(p => p.name?.getText(ast) === attribute);
      if (prop?.initializer?.expression) found = prop.initializer.expression.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, `${tag} ${attribute} exists`);
  return context => vm.runInNewContext(ts.transpileModule(`(${found})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}

test('unlock form submits once and refuses repeated submissions while busy or enrolling', () => {
  const submit = handler('form', 'onSubmit');
  for (const [busy, enrolling, expected] of [[false, false, 1], [true, false, 0], [false, true, 0]]) {
    let calls = 0, prevented = 0;
    submit({ busy, enrolling, unlock: () => { calls++; } })({ preventDefault() { prevented++; } });
    assert.equal(calls, expected);
    assert.equal(prevented, 1);
  }
  assert.match(source, /<Button type="submit" disabled=\{busy \|\| enrolling\}>/);
});

test('Escape and dismiss button keep the search query; typing reopens suggestions', () => {
  const search = text => text.includes('aria-label="Search items and actions"');
  let query = 'v', dismissed = false;
  const context = { setQuery: value => { query = value; }, setSearchActionsDismissed: value => { dismissed = value; } };
  const keydown = handler('Input', 'onKeyDown', search)(context);
  keydown({ key: 'a', preventDefault() { assert.fail('ordinary typing must continue'); } });
  assert.equal(dismissed, false);
  keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(dismissed, true);
  assert.equal(query, 'v');
  handler('Input', 'onChange', search)(context)({ target: { value: 'va' } });
  assert.equal(query, 'va');
  assert.equal(dismissed, false);
  handler('IconButton', 'onClick', text => text.includes('label="Dismiss action suggestions"'))(context)();
  assert.equal(dismissed, true);
  assert.equal(query, 'va');
});
