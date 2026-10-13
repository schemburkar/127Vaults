import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/app.tsx', import.meta.url), 'utf8');
function guardHarness(dirty, choice) {
  let editing = true, selected = { title: 'Unsaved' };
  const original = { title: 'Saved' }, dirtyRef = { current: dirty };
  const context = vm.createContext({ dirtyRef, window: { confirm: () => choice }, editOriginal: original, setEditing: value => { editing = value; }, setSelected: value => { selected = value; } });
  const start = source.indexOf('  const confirmDiscard = () => {'), end = source.indexOf('\n  useEffect(', start);
  vm.runInContext(source.slice(start, end), context);
  return { invoke: () => vm.runInContext('confirmDiscard()', context), state: () => ({ editing, selected, dirty: dirtyRef.current }) };
}
test('desktop navigation cancellation keeps the current unsaved editor', () => {
  const harness = guardHarness(true, false); assert.equal(harness.invoke(), false);
  assert.deepEqual(harness.state(), { editing: true, selected: { title: 'Unsaved' }, dirty: true });
});
test('desktop confirmed discard restores the saved item and clears the navigation guard', () => {
  const harness = guardHarness(true, true); assert.equal(harness.invoke(), true);
  assert.deepEqual(harness.state(), { editing: false, selected: { title: 'Saved' }, dirty: false });
  assert.equal(harness.invoke(), true);
});

test('save detail reload prevents starting another draft until it finishes', () => {
  for (const handler of ['beginEditing', 'beginNewItem', 'duplicateItem']) {
    let changes = 0;
    const context = vm.createContext({ saving:true, selected:{customFields:[]}, activeVaults:[{}], confirmDiscard:()=>{throw Error('Saving must guard before discarding');}, setSelected:()=>changes++, setEditOriginal:()=>changes++ });
    const start=source.indexOf(`  const ${handler} = () => {`),end=source.indexOf('\n  };',start)+5;
    assert.ok(start>=0);
    vm.runInContext(source.slice(start,end),context);
    vm.runInContext(`${handler}()`,context);
    assert.equal(changes,0);
  }
});
