import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

// Combined local checks, including disposable loopback Worker/client fixtures.
// This receipt does not claim native-package or observed-provider acceptance.
const root=resolve(import.meta.dirname,'..');
const commands=[
  ['node',['--test','--test-timeout=20000','scripts/runtime-namespace.test.mjs','scripts/namespace-cleanup.test.mjs','scripts/release/package.test.mjs',
    'apps/public-intake/test/settlement.test.mjs','apps/public-intake/test/client-downloads.test.mjs','customer-website/trial-navigation.test.mjs']],
  ['node',['--test','scripts/dev-launcher.test.mjs','scripts/mvp-startup.test.mjs','apps/public-intake/test/cloudflare-worker.test.mjs']],
  ['node',['scripts/cloudflare/check.mjs']],
  ['node',['--check','customer-website/billing.mjs']],
  ['node',['--check','customer-website/portal.mjs']],
  ['cargo',['fmt','--all','--check']],
  ['cargo',['clippy','-p','vaults-cli','-p','vaults-installer','-p','vaults-desktop-poc','--all-targets','--offline','--','-D','warnings']],
  ['cargo',['test','-p','vaults-cli','--lib','--locked','--offline']],
];
const git=args=>spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).stdout?.trim()??'';
const receipt={schemaVersion:1,startedAt:new Date().toISOString(),sourceCommit:git(['rev-parse','HEAD']),
  sourceCommitted:false,checks:[],remainingAcceptance:[],scope:'Direct Dev commands and isolated cleanup; Dev combined-installer distribution intentionally excluded',
  observedProviderFixtures:['dodo-zero-observed.json','dodo-zero-renewal-observed.json']};
const files=[...new Set((git(['diff','HEAD','--name-only'])+'\n'+git(['ls-files','--others','--exclude-standard'])).split(/\r?\n/).filter(Boolean))]
  .filter(p=>!['clean-release-cache.ps1','scripts/release/clean-cache.mjs','scripts/release/clean-cache.test.mjs'].includes(p));
receipt.sourceCommitted=files.length===0;
receipt.files=[];
for(const path of files){try{const bytes=await readFile(join(root,path));receipt.files.push({path,sha256:createHash('sha256').update(bytes).digest('hex')});}catch(error){if(error.code!=='ENOENT')throw error;receipt.files.push({path,deleted:true});}}
const directory=join(root,'.tools/verification/isolation-settlement');await mkdir(directory,{recursive:true});
for(let index=0;index<commands.length;index++){
  const [program,args]=commands[index];console.log(`Checking ${program} ${args.join(' ')}`);
  const result=spawnSync(program==='node'?process.execPath:program,args,{cwd:root,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
  const log=(result.stdout??'')+(result.stderr??'')+(result.error?String(result.error):'');
  await writeFile(join(directory,`${index+1}.log`),log);
  receipt.checks.push({program,args,exitCode:result.status??1,log:`${index+1}.log`});
  console.log(result.status===0?'Passed':'Failed; see retained log');
}
receipt.finishedAt=new Date().toISOString();receipt.lightChecksPassed=receipt.checks.every(c=>c.exitCode===0);
await writeFile(join(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(`Light verification ${receipt.lightChecksPassed?'passed':'failed'}; receipt: ${join(directory,'receipt.json')}`);
if(!receipt.lightChecksPassed)process.exitCode=1;
