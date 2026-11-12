import test from 'node:test';
import assert from 'node:assert/strict';
import { joiningMessage, validJoiningLink } from '../admin/joining-kit.js';
import { connectionReadiness } from '../src/connection-readiness.mjs';
test('joining instructions distinguish account invitation and client access without accepting purchaser links',()=>{
  const link='https://manage.example.invalid/join#'+'a'.repeat(64)+'.'+'b'.repeat(43);
  assert.equal(validJoiningLink(link),true);
  assert.equal(validJoiningLink(link.replace('/join','/trial')),false);
  assert.equal(validJoiningLink(link.replace('https:','http:')),false);
  const message=joiningMessage('https://192.168.1.10/#memberInvite=fixture',link);
  assert.match(message,/Import server connection/);assert.match(message,/approve its code/);assert.match(message,/different purposes/);
});
test('sharing checks distinguish loopback and certificate renewal from remote reachability',()=>{
  const now=Date.now();
  const local=connectionReadiness({serverUrl:'https://127.0.0.1:12780',serverName:'Home'},new Date(now+20*86400000).toISOString(),now);
  assert.equal(local.localOnly,true);assert.equal(local.certificateState,'renew-soon');
  const lan=connectionReadiness({serverUrl:'https://192.168.1.10:12780',serverName:'Home'},new Date(now+100*86400000).toISOString(),now);
  assert.equal(lan.localOnly,false);assert.match(lan.sharing,/confirm access from their computer/);
});
