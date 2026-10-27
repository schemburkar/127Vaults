import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPinnedMounts, verifyReplicaHistory } from './local-server.mjs';
test('local server operations refuse changed storage and retain exact mount provenance', () => {
 const pins=[{Source:'database-volume-original',Destination:'/var/lib/postgresql/data'}];
 assert.doesNotThrow(()=>verifyPinnedMounts(pins,pins));
 assert.throws(()=>verifyPinnedMounts([{Source:'database-volume-other',Destination:'/var/lib/postgresql/data'}],pins),/storage changed/);
 assert.throws(()=>verifyPinnedMounts([],pins),/storage changed/);
});

test('matching installation identity is insufficient when operation histories diverge', () => {
 const replicas=[{vault_id:'fixture',operations:[{cursor:1,operation:{opId:'original'}}],pending:[{}]}];
 assert.deepEqual(verifyReplicaHistory(replicas,[{vaultId:'fixture',cursor:1,opId:'original'}],[]),{vaults:1,verifiedOperations:1,pendingEdits:1});
 assert.throws(()=>verifyReplicaHistory(replicas,[{vaultId:'fixture',cursor:1,opId:'fork'}],[]),/history mismatch/);
 assert.equal(replicas[0].pending.length,1);
});
