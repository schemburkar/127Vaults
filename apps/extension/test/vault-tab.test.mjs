import test from 'node:test';
import assert from 'node:assert/strict';
import { findUnlockedVaultTab } from '../src/vault-tab.mjs';

const origin = 'https://127.0.0.1:12780';
const tabs = [{id:1,url:origin}, {id:2,url:origin}, {id:3,url:'https://127.0.0.1:12781'}, {id:4,url:'https://foreign.invalid'}];
test('the active unlocked vault can itself be the web source', async () => {
  const probed = [];
  const selected = await findUnlockedVaultTab(tabs, origin, 2, async id => { probed.push(id); return {locked:false}; });
  assert.equal(selected.id,2);
  assert.deepEqual(probed,[2]);
});
test('a locked or inaccessible matching tab does not hide another unlocked tab', async () => {
  assert.equal((await findUnlockedVaultTab(tabs,origin,1,async id => ({locked:id===1}))).id,2);
  assert.equal((await findUnlockedVaultTab(tabs,origin,1,async id => { if(id===1)throw Error('Cannot access');return {locked:false}; })).id,2);
});
test('selection never probes another port or origin and preserves access failures', async () => {
  const probed=[];
  await assert.rejects(findUnlockedVaultTab(tabs,origin,1,async id => {probed.push(id);throw Error('Cannot access');}),/Cannot access/);
  assert.deepEqual(probed,[1,2]);
  assert.equal(await findUnlockedVaultTab(tabs,'https://absent.invalid',1,async()=>{throw Error('Unexpected probe');}),null);
});
