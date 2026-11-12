import test from 'node:test';import assert from 'node:assert/strict';
import {connectionHelp,diagnosticReport} from '../src/connection-help.mjs';
test('connection guidance preserves trust and distinguishes network, certificate, approval and license failures',()=>{
 assert.equal(connectionHelp('CA fingerprint does not match the operator value').category,'identity');
 assert.equal(connectionHelp('Connect to Tailscale first').category,'tailscale');
 assert.equal(connectionHelp('device revoked').category,'revoked');
 assert.equal(connectionHelp('server connection failed').category,'network');
 assert.equal(connectionHelp('license expired').category,'license');
 assert.equal(connectionHelp('unrelated validation error'),null);
});
test('diagnostics cannot disclose raw errors, addresses, identifiers, paths, credentials or vault contents',()=>{
 const report=diagnosticReport('desktop',{error:'server connection failed https://private.example/token',trustConfigured:true,deviceEnrolled:false,username:'secret-user',token:'private-token',path:'C:/private',item:'vault password'});
 assert.deepEqual(report,{schemaVersion:1,surface:'desktop',category:'network',trustConfigured:true,deviceEnrolled:false});
});
