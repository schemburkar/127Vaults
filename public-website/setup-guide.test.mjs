import test from 'node:test';
import assert from 'node:assert/strict';
import { readProgress, stages } from './setup-guide.mjs';

test('resume accepts checklist identifiers only and never restores supplied secrets or addresses', () => {
  assert.deepEqual(readProgress(JSON.stringify({ version: 1, step: 3, completed: ['prerequisites', 'packages', 'packages'],
    password: 'not-saved', endpoint: 'not-saved' })), { version: 1, step: 3, completed: ['prerequisites', 'packages'] });
  for (const invalid of [null, '{', '{}', JSON.stringify({version:1,step:100,completed:[]}),
    JSON.stringify({version:1,step:0,completed:['secret']})]) {
    assert.deepEqual(readProgress(invalid), {version:1,step:0,completed:[]});
  }
  assert.equal(stages.length, 7);
});
