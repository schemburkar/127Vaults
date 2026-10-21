// Attach the existing signed development license through the normal operator API.
// No issuer private key, trial rebinding, email sending or license replacement.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig, protectedDirectory } from '../cloudflare/config.mjs';
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
for(const key of ['--config','--request-id','--license-file','--output']) if(!args.includes(key)||!option(key)||option(key).startsWith('--'))throw Error(`Missing ${key}`);
const id=option('--request-id');if(!/^[a-f0-9]{64}$/.test(id))throw Error('Use the existing access-request ID.');
const config=await loadConfig(option('--config'));
const operator=(await readFile(resolve(config.secretsDirectory,'operator-token'),'utf8')).trim();
const license=await readFile(resolve(option('--license-file')),'utf8');
if(license.length>1600)throw Error('Expected a signed license envelope, not a private issuer key.');
const response=await fetch(`${config.origin}/api/access-admin/requests/${id}/approve-development`,{
  method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json',Authorization:`Bearer ${operator}`},body:JSON.stringify({license})});
if(!response.ok)throw Error(`Development approval failed (${response.status}); existing installed license was not changed.`);
const record=await response.json();if(record.kind!=='development'||!record.link)throw Error('Invalid development invitation response.');
const output=resolve(option('--output'));await protectedDirectory(resolve(output,'..'));
await writeFile(output,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(`Development invitation saved privately: ${output}. Existing license and installation preserved; no email sent.`);
