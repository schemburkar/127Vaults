import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { canonicalJson, createSignedOperation, verifySignedOperation } from "../src/index.mjs";
test("canonical encoding sorts recursively",()=>assert.equal(canonicalJson({z:1,a:{y:true,x:"v"}}),'{"a":{"x":"v","y":true},"z":1}'));
test("operation IDs and signatures are deterministic and context-bound",()=>{const keys=generateKeyPairSync("ed25519");const body={tenantId:"t",vaultId:"v",deviceId:"d",epoch:1,causalBase:0,kind:"item.create",itemId:"i",payloadHash:"01".repeat(32)};const a=createSignedOperation(body,keys.privateKey),b=createSignedOperation(body,keys.privateKey);assert.equal(a.opId,b.opId);assert.equal(a.signature,b.signature);verifySignedOperation(a,{publicKey:keys.publicKey,tenantId:"t",vaultId:"v",deviceId:"d",epoch:1});assert.throws(()=>verifySignedOperation(a,{publicKey:keys.publicKey,tenantId:"t",vaultId:"other",deviceId:"d",epoch:1}),{code:"wrong_vault"});assert.throws(()=>verifySignedOperation({...a,payloadHash:"02".repeat(32)},{publicKey:keys.publicKey,tenantId:"t",vaultId:"v",deviceId:"d",epoch:1}),{code:"unstable_operation_id"});});
