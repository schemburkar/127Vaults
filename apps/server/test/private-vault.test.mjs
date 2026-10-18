import test from 'node:test';import assert from 'node:assert/strict';import {bytes,directory,catalogue,VaultError} from '../src/private-vault.mjs';
const raw=n=>{let b=Buffer.alloc(n);b[6]=0x40;b[8]=0x80;return b};
import { createHash, randomUUID } from 'node:crypto';
import { PgPrivateVaultStore } from '../src/private-vault-pg.mjs';

function deletionFixture({ mutateNext, stale=false, retired=false, historyError=false, receipt=null }={}) {
 const auth={tenantId:randomUUID(),accountId:randomUUID(),deviceId:randomUUID()},vault=randomUUID(),item=randomUUID(),sibling=randomUUID(),base=randomUUID(),revision=randomUUID(),calls=[];
 const ids=[item,sibling].sort(),toBytes=id=>Buffer.from(id.replaceAll('-',''),'hex');
 const entry=id=>{const b=Buffer.alloc(136,7);toBytes(id).copy(b);return b};
 const record=(rev,prior,entries)=>{const b=Buffer.alloc(110+entries.length*136);b.write('PVM1');toBytes(auth.tenantId).copy(b,4);toBytes(vault).copy(b,20);b.writeBigUInt64BE(1n,36);toBytes(rev).copy(b,44);if(prior)toBytes(prior).copy(b,60);b.writeUInt16BE(entries.length,76);entries.forEach((e,i)=>e.copy(b,78+i*136));return b};
 const old=record(base,null,ids.map(entry)),next=record(revision,base,[entry(sibling)]);mutateNext?.(next,{item,sibling,toBytes});
 const length=Buffer.alloc(4);length.writeUInt32BE(next.length);
 const signedOperation={vaultId:vault,itemId:item,kind:'item.delete',payloadHash:createHash('sha256').update(length).update(next).digest('hex')};
 const c={async query(sql,params){calls.push({sql,params});if(sql.startsWith('SELECT count'))return{rows:[{n:0}]};if(sql.startsWith('SELECT fingerprint,response'))return{rows:receipt?[receipt]:[]};if(sql.startsWith('SELECT * FROM vaults.private_vaults'))return{rows:[{catalogue:old,catalogue_revision:stale?randomUUID():base,retired_at:retired?new Date():null}]};if(sql.startsWith('DELETE FROM'))return{rowCount:1,rows:[]};return{rows:[]}},release(){}};
 const store=new PgPrivateVaultStore({async connect(){return c}},{async appendInTransaction(connection,a,operation){assert.equal(connection,c);assert.equal(a,auth);assert.equal(operation,signedOperation);calls.push({sql:'SIGNED_HISTORY'});if(historyError)throw Error('history failed')}});
 const proposal={auth,vault,item,method:'DELETE',path:`/api/v1/vaults/${vault}/items/${item}`,raw:Buffer.from('exact encrypted delete request'),requestId:randomUUID(),baseCatalogueRevision:base,catalogueBytes:next,action:'item.delete',signedOperation};
 return{store,proposal,calls,revision};
}

test('mutation serializes a scoped request before looking up an absent replay receipt',async()=>{
 const f=deletionFixture();await f.store.mutate(f.proposal);
 const lock=f.calls.findIndex(c=>c.sql.startsWith('SELECT pg_advisory_xact_lock'));
 const receipt=f.calls.findIndex(c=>c.sql.startsWith('SELECT fingerprint,response'));
 const write=f.calls.findIndex(c=>c.sql.startsWith('DELETE FROM'));
 assert.ok(lock>=0&&lock<receipt&&receipt<write);
 assert.deepEqual(f.calls[lock].params,[`127vaults:private-receipt:${f.proposal.auth.tenantId}:${f.proposal.auth.accountId}:${f.proposal.requestId}`]);
 assert.ok(f.calls.findIndex(c=>c.sql==='BEGIN')<lock);
 assert.ok(f.calls.findIndex(c=>c.sql==='COMMIT')>write);
});

test('item deletion commits the scoped ciphertext removal, catalogue, signed history, receipt and audit together',async()=>{
 const f=deletionFixture();const result=await f.store.mutate(f.proposal);assert.equal(result.catalogueRevision,f.revision);
 const sql=f.calls.map(c=>c.sql);assert.equal(sql.at(-1),'COMMIT');assert.equal(sql.filter(s=>s.startsWith('DELETE FROM')).length,1);
 assert.match(sql.find(s=>s.startsWith('DELETE FROM')),/tenant_id=\$1 AND vault_id=\$2 AND item_id=\$3/);
 assert.ok(sql.includes('SIGNED_HISTORY'));assert.ok(sql.some(s=>s.startsWith('UPDATE vaults.private_vaults SET catalogue_revision')));
 assert.ok(sql.some(s=>s.startsWith('INSERT INTO vaults.private_receipts')));assert.equal(f.calls.find(c=>c.sql.startsWith('INSERT INTO vaults.private_audit')).params[6],'item.delete');
});

test('deletion refuses stale, retired, sibling-changing and non-removing catalogues; signature failure rolls back',async()=>{
 for(const options of [{stale:true},{retired:true},{historyError:true},{mutateNext:b=>{b[78+16]^=1}},{mutateNext:(b,x)=>x.toBytes(x.item).copy(b,78)}]){
  const f=deletionFixture(options);await assert.rejects(f.store.mutate(f.proposal));assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.equal(f.calls.some(c=>c.sql==='COMMIT'),false);
 }
 const f=deletionFixture();f.proposal.signedOperation.payloadHash='0'.repeat(64);await assert.rejects(f.store.mutate(f.proposal),{code:'SIGNED_OPERATION_REQUIRED'});assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});

test('exact deletion replay returns its receipt without deleting again, while changed request bytes are refused',async()=>{
 const f=deletionFixture(),m=Buffer.from(f.proposal.method),p=Buffer.from(f.proposal.path),n=Buffer.alloc(4),h=createHash('sha256');n.writeUInt32BE(m.length);h.update(n).update(m);n.writeUInt32BE(p.length);const fp=h.update(n).update(p).update(f.proposal.raw).digest();
 const receipt={fingerprint:fp,response:{catalogueRevision:f.revision}};
 const replay=deletionFixture({receipt});replay.proposal={...f.proposal};assert.deepEqual(await replay.store.mutate(replay.proposal),receipt.response);assert.equal(replay.calls.some(c=>c.sql.startsWith('DELETE FROM')),false);
 replay.proposal.raw=Buffer.from('changed');await assert.rejects(replay.store.mutate(replay.proposal),{code:'REQUEST_ID_REUSED'});
});
test('strict base64url and record bounds',()=>{assert.deepEqual(bytes(Buffer.from('x').toString('base64url'),2),Buffer.from('x'));assert.throws(()=>bytes('eA==',2),VaultError);let d=Buffer.alloc(102);d.write('PVD1');d[10]=0x40;d[12]=0x80;d[26]=0x40;d[28]=0x80;d[42]=0x40;d[44]=0x80;assert.equal(directory(d).entries.length,0);let m=Buffer.alloc(110);m.write('PVM1');m[10]=0x40;m[12]=0x80;m[26]=0x40;m[28]=0x80;m.writeBigUInt64BE(1n,36);m[50]=0x40;m[52]=0x80;assert.equal(catalogue(m).entries.length,0)});
