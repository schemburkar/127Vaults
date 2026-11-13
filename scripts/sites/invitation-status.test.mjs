import test from 'node:test';import assert from 'node:assert/strict';
import {invitationStatus} from '../../admin-website/invitation-status.mjs';
test('preview distinguishes valid, expired, closed and unavailable invitation links',()=>{
  const now=Date.parse('2026-11-13T00:00:00Z'),row={state:'approved',canPreviewInvitation:true,linkExpiresAt:'2026-11-20T00:00:00Z'};
  assert.equal(invitationStatus(row,now).label,'Valid');
  assert.equal(invitationStatus({...row,linkExpiresAt:'2026-11-12T00:00:00Z'},now).label,'Expired');
  assert.equal(invitationStatus({...row,state:'closed'},now).usable,false);
  assert.equal(invitationStatus({...row,canPreviewInvitation:false},now).label,'No invitation');
  assert.equal(invitationStatus({...row,linkExpiresAt:'invalid'},now).usable,false);
});
