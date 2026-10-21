// Attach the existing signed development license through the normal operator API.
// No issuer private key, trial rebinding, email sending or license replacement.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig, protectedDirectory } from '../cloudflare/config.mjs';
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
for(const key of ['--config','--license-file','--output']) if(!args.includes(key)||!option(key)||option(key).startsWith('--'))throw Error(`Missing ${key}`);
let id=args.includes('--request-id') ? option('--request-id') : null;
const config=await loadConfig(option('--config'));
const operator=(await readFile(resolve(config.secretsDirectory,'operator-token'),'utf8')).trim();
const license=await readFile(resolve(option('--license-file')),'utf8');
if(license.length>1600)throw Error('Expected a signed license envelope, not a private issuer key.');
const payload=JSON.parse(Buffer.from(JSON.parse(license).payload,'base64url').toString('utf8'));
const api=async(path,input)=>{
  const response=await fetch(config.origin+path,{method:input===undefined?'GET':'POST',headers:{Origin:config.origin,
    Authorization:`Bearer ${operator}`,...(input===undefined?{}:{'Content-Type':'application/json'})},body:input===undefined?undefined:JSON.stringify(input)});
  if(!response.ok)throw Error(`Development request operation failed (${response.status}); existing licenses were not changed.`);
  return response.json();
};
let existing;
if(!id){
  const sourceId=option('--source-request-id');
  if(!args.includes('--source-request-id')||!/^[a-f0-9]{64}$/.test(sourceId))throw Error('Supply --request-id, or --source-request-id to reuse this operator-approved requester contact for a new development request.');
  const before=await api('/api/access-admin/requests');
  if(!before.permissions?.approveDevelopment)throw Error('Deploy development entitlement support before provisioning access.');
  const contact=before.requests.find(row=>row.id===sourceId);if(!contact?.email)throw Error('Requester contact is unavailable.');
  existing=before.requests.find(row=>row.email===contact.email&&row.kind==='development'&&row.installationId===payload.installationId&&row.state==='approved');
  if(existing){
    if(Date.parse(existing.linkExpiresAt)<=Date.now())existing=await api(`/api/access-admin/requests/${existing.id}/rotate`,{});
    else {const preview=await api(`/api/access-admin/requests/${existing.id}/invitation`);existing={...existing,link:preview.message?.match(/https:\/\/\S+#[a-f0-9]{64}\.[A-Za-z0-9_-]{43}/)?.[0]};}
  } else {
    await api('/api/waitlist',{email:contact.email,organization:'',plan:'personal',website:'',requestedSeats:payload.maxActiveUsers,consent:true});
    const after=await api('/api/access-admin/requests'),known=new Set(before.requests.map(row=>row.id));
    const created=after.requests.filter(row=>!known.has(row.id)&&row.email===contact.email&&row.state==='requested');
    if(created.length!==1)throw Error('Cannot uniquely identify the new development request; inspect the operator inbox.');
    id=created[0].id;
  }
}
if(!existing&&!/^[a-f0-9]{64}$/.test(id))throw Error('Use the existing access-request ID.');
let record=existing;
if(!record){
const response=await fetch(`${config.origin}/api/access-admin/requests/${id}/approve-development`,{
  method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json',Authorization:`Bearer ${operator}`},body:JSON.stringify({license})});
if(!response.ok)throw Error(`Development approval failed (${response.status}); existing installed license was not changed.`);
record=await response.json();
}
if(record.kind!=='development'||!record.link||record.installationId!==payload.installationId)throw Error('Invalid development invitation response.');
const output=resolve(option('--output'));await protectedDirectory(resolve(output,'..'));
await writeFile(output,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(`Development invitation saved privately: ${output}. Existing license and installation preserved; no email sent.`);
