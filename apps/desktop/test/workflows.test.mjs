import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/app.tsx', import.meta.url), 'utf8');
function guardHarness(dirty, choice) {
  let editing = true, selected = { title: 'Unsaved' };
  const original = { title: 'Saved' }, dirtyRef = { current: dirty };
  const context = vm.createContext({ dirtyRef, confirmAction: () => Promise.resolve(choice), editOriginal: original, setEditing: value => { editing = value; }, setSelected: value => { selected = value; } });
  const start = source.indexOf('  const confirmDiscard = async () => {'), end = source.indexOf('\n  useEffect(', start);
  vm.runInContext(source.slice(start, end), context);
  return { invoke: () => vm.runInContext('confirmDiscard()', context), state: () => ({ editing, selected, dirty: dirtyRef.current }) };
}
test('desktop navigation cancellation keeps the current unsaved editor', async () => {
  const harness = guardHarness(true, false); assert.equal((await harness.invoke()), false);
  assert.deepEqual(harness.state(), { editing: true, selected: { title: 'Unsaved' }, dirty: true });
});
test('desktop confirmed discard restores the saved item and clears the navigation guard', async () => {
  const harness = guardHarness(true, true); assert.equal((await harness.invoke()), true);
  assert.deepEqual(harness.state(), { editing: false, selected: { title: 'Saved' }, dirty: false });
  assert.equal((await harness.invoke()), true);
});

test('save detail reload prevents starting another draft until it finishes', async () => {
  for (const handler of ['beginEditing', 'beginNewItem', 'duplicateItem']) {
    let changes = 0;
    const context = vm.createContext({ saving:true, selected:{customFields:[]}, activeVaults:[{}], confirmDiscard:()=>{throw Error('Saving must guard before discarding');}, setSelected:()=>changes++, setEditOriginal:()=>changes++ });
    const start=source.indexOf(`  const ${handler} = ${handler === "beginEditing" ? "" : "async "}() => {`),end=source.indexOf('\n  };',start)+5;
    assert.ok(start>=0);
    vm.runInContext(source.slice(start,end),context);
    await vm.runInContext(`${handler}()`,context);
    assert.equal(changes,0);
  }
});

 test('discard waits for the in-app decision before changing the editor', async () => {
  let decide;
  const choice = new Promise(resolve => { decide = resolve; });
  const harness = guardHarness(true, choice);
  const pending = harness.invoke();
  assert.deepEqual(harness.state(), { editing: true, selected: { title: 'Unsaved' }, dirty: true });
  decide(false);
  assert.equal(await pending, false);
  assert.equal(harness.state().dirty, true);
 });
