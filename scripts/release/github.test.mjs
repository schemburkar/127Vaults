import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publishNotes} from './github.mjs';
const revision='a'.repeat(40), args=['v0.1.13',revision,'notes.md'];
function fixture({privateRepo=true, commit=true, existing=null, failed=false}={}) {
  const calls=[];
  return {calls, deps:{execFileSync:()=> 'https://github.com/owner/repo.git',
    spawnSync:()=>({status:0,stdout:'password=test-only-token\n'}),readFile:async()=> 'Release notes',
    fetch:async(url,options)=>{
      calls.push({url,...options});
      assert.ok(url.startsWith('https://api.github.com/repos/owner/repo'));
      const value=url.endsWith('/repo')?{private:privateRepo}:url.includes('/commits/')?(commit?{sha:revision}:null):options.method==='POST'?{html_url:'https://github.com/owner/repo/releases/tag/v0.1.13'}:existing;
      return {status:failed?403:value?200:404,ok:!failed,json:async()=>value};
    }}};
}
test('plan reads only; publish creates notes without package assets',async()=>{
 const {calls,deps}=fixture();
 assert.equal((await publishNotes(args,deps)).status,'ready');
 assert.ok(calls.every(c=>c.method==='GET'));
 assert.equal((await publishNotes([...args,'--publish'],deps)).status,'published');
 const posts=calls.filter(c=>c.method==='POST');assert.equal(posts.length,1);
 assert.deepEqual(JSON.parse(posts[0].body),{tag_name:'v0.1.13',target_commitish:revision,name:'127Vaults 0.1.13',body:'Release notes',draft:false,prerelease:false});
});
test('refuses public repository, absent source, credential and API errors',async()=>{
 for(const options of [{privateRepo:false},{commit:false},{failed:true}]){
  const {calls,deps}=fixture(options);await assert.rejects(publishNotes([...args,'--publish'],deps));assert.ok(calls.every(c=>c.method==='GET'));
 }
 const {deps}=fixture();deps.spawnSync=()=>({status:1});await assert.rejects(publishNotes(args,deps),/credentials unavailable/);
});
test('retries identical release without writes and refuses differing release',async()=>{
 const {calls,deps}=fixture({existing:{body:'Release notes',draft:false,target_commitish:revision,html_url:'url'}});
 assert.equal((await publishNotes([...args,'--publish'],deps)).status,'already-published');assert.ok(calls.every(c=>c.method==='GET'));
 const other=fixture({existing:{body:'Different'}});await assert.rejects(publishNotes([...args,'--publish'],other.deps),/differs/);
});
test('invalid arguments fail before credentials or network',async()=>{
 await assert.rejects(publishNotes(['bad',revision,'notes.md']),/Usage/);
});
