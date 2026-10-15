// Stop only the fixture driver's next save permission; no app/Core/queue changes.
import assert from 'node:assert/strict';
import {openDesktopFixtureInspector} from '../support/desktop-fixture-inspector.mjs';
assert.equal(process.platform,'linux');
const {evaluate,close}=await openDesktopFixtureInspector('http://127.0.0.1:12926');
try{
  const state=await evaluate('globalThis.__budget');assert.ok(state?.awaitingSave&&!state.done);
  await evaluate(`(()=>{let allowed=globalThis.__allowBudgetSave;Object.defineProperty(globalThis,'__allowBudgetSave',{configurable:true,get:()=>allowed,set:value=>{globalThis.__budget={...globalThis.__budget,done:true,ok:false,stage:'bounded burn stopped before next save',error:'Fixture time-bound stop; runtime encryption budget not reached. Durable accepted queue must be recovered without reset.'};}});})()`);
  console.log('Fixture stop armed at next save boundary; production budget untouched.');
}finally{close();}
