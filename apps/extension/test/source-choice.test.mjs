import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseSource} from '../src/source-choice.mjs';
test('a remembered source wins over detection, unavailable preferences fall back without changing storage',()=>{
  const sources=[{id:'desktop',preferred:true},{id:'cli',preferred:true},{id:'web'}];
  assert.equal(chooseSource(sources,'cli').id,'cli');
  assert.equal(chooseSource(sources).id,'desktop');
  assert.deepEqual(chooseSource(sources.slice(1),'desktop'),{id:'cli',fallback:true});
  assert.equal(chooseSource([],'desktop').id,null);
});
