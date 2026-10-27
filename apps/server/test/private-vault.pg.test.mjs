import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import pg from 'pg';
import { schemaSql, schemaV8MigrationSql, schemaV9MigrationSql, schemaV10MigrationSql, schemaV7Checksum, requireSchema } from '../src/schema.mjs';
import { migrateSchema7To8, migrateSchema8To9, migrateSchema9To10 } from '../src/schema-migration.mjs';
import { PgPrivateVaultStore } from '../src/private-vault-pg.mjs';
import { PgSignedSyncStore } from '../src/sync-pg.mjs';
import { createPrivateVaultHandler } from '../src/private-vault-handler.mjs';
import { createSignedOperation, verifyCheckpoint } from '../../../packages/sync/src/index.mjs';

// Explicit opt-in to an EMPTY disposable database, independent of retained fixtures.
const url = process.env.VAULTS_ITEM_DELETION_DATABASE_URL;
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const rawId = id => Buffer.from(id.replaceAll('-', ''), 'hex');
const uuid = bytes => { const x=Buffer.from(bytes).toString('hex');return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20)}`; };
const payloadHash = parts => createHash('sha256').update(Buffer.concat(parts.flatMap(part=>{const n=Buffer.alloc(4);n.writeUInt32BE(part.length);return[n,Buffer.from(part)]}))).digest('hex');

test('real Core/HTTP/PostgreSQL deletion migrates safely, is atomic, replays receipts and rejects resurrection', { skip: !url }, async () => {
 const pool=new pg.Pool({connectionString:url,max:3}),tenant=randomUUID(),account=randomUUID(),device=randomUUID();
 const key=generateKeyPairSync('ed25519'),checkpointKey=generateKeyPairSync('ed25519');
 const wasm=createRequire(import.meta.url)('../wasm-auth/vaults_browser_fixture.cjs');
 const core=new wasm.ExperimentalEcf1Core(),template=new Uint8Array(77);template[0]=1;template.set(rawId(tenant),1);template.set(rawId(account),17);template[68]=1;template[76]=1;
 const root=core.create_root(template,Buffer.from('synthetic-delete-master'),new Uint8Array(32).fill(9));
 const empty=core.create_empty_directory(root),made=core.create_private_vault(root,empty),vault=made.vault(),vaultId=uuid(vault.context().slice(33,49));
 const auth={tenantId:tenant,accountId:account,deviceId:device,credentialEpoch:1,csrf:'synthetic-csrf'};
 const sync=new PgSignedSyncStore(pool,checkpointKey.privateKey),store=new PgPrivateVaultStore(pool,sync);
 const origin='https://127.0.0.1:12942',handler=createPrivateVaultHandler(store,async()=>auth,origin);
 const server=createServer((req,res)=>handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end()}}));
 let cursor=0,previous=null,port;
 const send=async(method,path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{origin,'content-type':'application/json','x-127v-csrf':auth.csrf,cookie:`__Host-127v-session=${'s'.repeat(43)}`},body:JSON.stringify(body)});return{status:response.status,value:await response.json()}};
 const sign=(kind,itemId,parts)=>createSignedOperation({tenantId:tenant,vaultId,deviceId:device,epoch:1,causalBase:cursor,previousDeviceOpId:previous,kind,itemId,payloadHash:payloadHash(parts)},key.privateKey);
 const request=(catalogue,next,operation)=>({requestId:randomUUID(),baseCatalogueRevision:uuid(catalogue.slice(44,60)),catalogue:b64(next),signedOperation:operation});
 const listPath=`/api/v1/vaults/${vaultId}/items`;
 try {
  assert.equal((await pool.query("SELECT to_regclass('vaults.schema_version') relation")).rows[0].relation,null,'use an empty disposable database');
  await pool.query(schemaSql.slice(0,-schemaV8MigrationSql.length-schemaV9MigrationSql.length-schemaV10MigrationSql.length-3));
  await pool.query('INSERT INTO vaults.schema_version(version,checksum) VALUES(7,$1)',[schemaV7Checksum]);
  await pool.query('INSERT INTO vaults.installation(id) VALUES($1)',[tenant]);
  await pool.query("INSERT INTO vaults.accounts(tenant_id,id,username,display_name,email,server_role,enrollment_state) VALUES($1,$2,'DeleteFixture','Delete Fixture','delete@example.invalid','owner','active')",[tenant,account]);
  await pool.query('INSERT INTO vaults.devices(tenant_id,account_id,id,signing_public_key,credential_epoch,credential_epoch_seen) VALUES($1,$2,$3,$4,1,1)',[tenant,account,device,key.publicKey.export({format:'der',type:'spki'}).subarray(-32)]);
  await pool.query('INSERT INTO vaults.private_directories(tenant_id,account_id,revision,directory) VALUES($1,$2,$3,$4)',[tenant,account,uuid(empty.slice(36,52)),Buffer.from(empty)]);
  await store.mutate({auth,method:'POST',path:'/api/v1/vaults',raw:Buffer.from('synthetic-vault-create'),requestId:randomUUID(),baseDirectoryRevision:uuid(empty.slice(36,52)),directoryBytes:Buffer.from(made.directory()),vaultEnvelope:Buffer.from(vault.envelope()),catalogueBytes:Buffer.from(made.catalogue()),action:'vault.create'});
  const before=(await pool.query('SELECT catalogue,vault_envelope FROM vaults.private_vaults')).rows;
  const connection=await pool.connect();try{await migrateSchema7To8(connection,{dryRun:true});await migrateSchema7To8(connection);await migrateSchema8To9(connection,{dryRun:true});await migrateSchema8To9(connection);await migrateSchema9To10(connection,{dryRun:true});await migrateSchema9To10(connection);await requireSchema(connection)}finally{connection.release()}
  assert.deepEqual((await pool.query('SELECT catalogue,vault_envelope FROM vaults.private_vaults')).rows,before);
  server.listen(0,'127.0.0.1');await once(server,'listening');port=server.address().port;
  let catalogue=made.catalogue();const items=[];
  for(const title of ['Delete me','Retained sibling']){
   const item=core.upsert_private_item(vault,catalogue,undefined,Buffer.from(JSON.stringify({title})),Buffer.from(JSON.stringify({password:'synthetic-secret'})));
   const itemId=uuid(item.item()),operation=sign('item.create',itemId,[item.catalogue(),item.index(),item.body()]);
   const body={...request(catalogue,item.catalogue(),operation),itemId,index:b64(item.index()),body:b64(item.body())};
   assert.equal((await send('POST',listPath,body)).status,200);previous=operation.opId;cursor++;catalogue=item.catalogue();items.push({itemId,item});
  }
  const [target,sibling]=items,siblingBefore=(await pool.query('SELECT index_envelope,body_envelope FROM vaults.private_items WHERE item_id=$1',[sibling.itemId])).rows;
  const deleted=core.delete_private_item(vault,catalogue,rawId(target.itemId)),operation=sign('item.delete',target.itemId,[deleted]),body=request(catalogue,deleted,operation),path=`${listPath}/${target.itemId}`;
  const bad={...body,signedOperation:{...operation,signature:'A'.repeat(86)}};
  assert.notEqual((await send('DELETE',path,bad)).status,200);
  assert.equal(Number((await pool.query('SELECT count(*) n FROM vaults.private_items')).rows[0].n),2);
  const accepted=await send('DELETE',path,body);assert.equal(accepted.status,200);
  assert.deepEqual(await send('DELETE',path,body),accepted);previous=operation.opId;cursor++;
  assert.equal((await send('DELETE',path,{...body,requestId:randomUUID()})).status,409);
  assert.deepEqual((await pool.query('SELECT index_envelope,body_envelope FROM vaults.private_items WHERE item_id=$1',[sibling.itemId])).rows,siblingBefore);
  const listed=await store.items(auth,vaultId);assert.deepEqual(listed.indices.map(row=>row.itemId),[sibling.itemId]);
  assert.equal(core.verify_private_catalogue(vault,Buffer.from(listed.catalogue,'base64url')).length,16);
  await assert.rejects(store.body(auth,vaultId,target.itemId,accepted.value.catalogueRevision),{code:'NOT_FOUND'});
  assert.equal((await pool.query("SELECT count(*)::int n FROM vaults.private_audit WHERE action='item.delete'")).rows[0].n,1);
  const history=await sync.fetch(auth,{vaultId});assert.deepEqual(history.operations.map(row=>row.operation.kind),['item.create','item.create','item.delete']);
  const checkpoint=await sync.createCheckpoint(auth,vaultId);verifyCheckpoint(checkpoint,{tenantId:tenant,vaultId,epoch:1,publicKey:checkpointKey.publicKey});assert.equal(checkpoint.cursor,3);
  const recreate=core.create_private_item_at_id(vault,deleted,rawId(target.itemId),Buffer.from('{"title":"resurrection"}'),Buffer.from('{}'));
  const resurrect=sign('item.create',target.itemId,[recreate.catalogue(),recreate.index(),recreate.body()]);
  assert.equal((await send('POST',listPath,{...request(deleted,recreate.catalogue(),resurrect),itemId:target.itemId,index:b64(recreate.index()),body:b64(recreate.body())})).status,409);
  assert.equal((await sync.fetch(auth,{vaultId})).cursor,3);
 } finally { if(server.listening){server.close();await once(server,'close')}core.lock();core.free();await pool.end(); }
});
