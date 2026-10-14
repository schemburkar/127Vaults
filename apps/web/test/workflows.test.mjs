import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../mvp-client.mjs', import.meta.url), 'utf8');
test('login waits for saved identity initialization and still opens after enrollment', () => {
  const elements = Object.fromEntries(['username','login-account-name','legacy-secret-field','login-username-step','login-password-step','master'].map(id => [id,{value:'owner_127',hidden:false,focus(){}}]));
  let messages = 0;
  const context = vm.createContext({$:id=>elements[id],startupReady:false,identity:null,busy:true,status:()=>messages++,reusableSecret:()=>false});
  vm.runInContext(source.slice(source.indexOf('function showLoginPassword()'),source.indexOf('function showRegistration()')),context);
  vm.runInContext('showLoginPassword()',context);
  assert.equal(messages,0);
  assert.equal(elements['login-username-step'].hidden,false);
  vm.runInContext('startupReady=true; identity={username:"owner_127"}; showLoginPassword()',context);
  assert.equal(elements['login-username-step'].hidden,true);
  assert.equal(elements['login-password-step'].hidden,false);
});
function editorHarness() {
  const elements = Object.fromEntries(['item-form','item-id','title','url','item-username','item-password','cancel-edit','items'].map(id => [id, { value: '', hidden: false }]));
  elements.title.value = 'Original';
  const events = {};
  let confirm = false, displayCount = 0, clearCount = 0, fields = [];
  const context = vm.createContext({
    $: id => elements[id],
    document: { querySelector: () => null },
    window: { __vaultsFeatures: {}, confirm: () => confirm, addEventListener: (name, fn) => { events[name] = fn; } },
    collectCustomFields: () => fields,
    currentItem: { itemId: 'original' },
    displayItem: () => { displayCount++; elements['item-form'].hidden = true; },
    clearItem: () => { clearCount++; elements['item-form'].hidden = true; },
  });
  vm.runInContext(source.slice(source.indexOf('const features ='), source.indexOf('const updateSessionDates =')), context);
  vm.runInContext('editorBaseline = editorSnapshot()', context);
  return { context, elements, events, setConfirm: value => { confirm = value; }, setFields: value => { fields = value; }, counts: () => ({ displayCount, clearCount }) };
}
test('navigation guard preserves an unsaved draft when discard is declined', () => {
  const harness = editorHarness();
  harness.elements.title.value = 'Unsaved';
  assert.equal(vm.runInContext('hasUnsavedChanges()', harness.context), true);
  assert.equal(vm.runInContext('confirmDiscard()', harness.context), false);
  assert.equal(harness.elements['item-form'].hidden, false);
  assert.equal(harness.elements.title.value, 'Unsaved');
  assert.deepEqual(harness.counts(), { displayCount: 0, clearCount: 0 });
});
test('confirmed discard restores the saved item, while unchanged editors do not prompt', () => {
  const harness = editorHarness();
  assert.equal(vm.runInContext('confirmDiscard()', harness.context), true);
  harness.setFields([{ id: 'otp', label: 'Secret', type: 'password', value: 'synthetic' }]);
  assert.equal(vm.runInContext('hasUnsavedChanges()', harness.context), true);
  harness.setConfirm(true);
  assert.equal(vm.runInContext('confirmDiscard()', harness.context), true);
  assert.deepEqual(harness.counts(), { displayCount: 1, clearCount: 0 });
});
test('Cancel handler returns without hiding the editor when discard is declined', () => {
  const harness = editorHarness();
  harness.elements.title.value = 'Unsaved';
  const start = source.indexOf('$("cancel-edit").onclick =');
  const end = source.indexOf('$("close-item-detail").onclick', start);
  vm.runInContext(source.slice(start, end), harness.context);
  harness.elements['cancel-edit'].onclick();
  assert.equal(harness.elements['item-form'].hidden, false);
  assert.deepEqual(harness.counts(), { displayCount: 0, clearCount: 0 });
});
test('unload protection only blocks when editor values or custom fields changed', () => {
  const harness = editorHarness();
  let prevented = false;
  harness.events.beforeunload({ preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  harness.elements['item-password'].value = 'new synthetic password';
  const event = { preventDefault() { prevented = true; }, returnValue: null };
  harness.events.beforeunload(event);
  assert.equal(prevented, true); assert.equal(event.returnValue, '');
  harness.elements['item-form'].hidden = true;
  assert.equal(vm.runInContext('hasUnsavedChanges()', harness.context), false);
});
