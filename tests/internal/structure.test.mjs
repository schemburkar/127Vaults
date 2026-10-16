import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const root=new URL('../../',import.meta.url),run=promisify(execFile);
const {entries}=JSON.parse(await readFile(new URL('./suites.json',import.meta.url),'utf8'));

test('categorized fixture entry points retain valid syntax, imports and URL dependencies',async()=>{
 assert.ok(!(await readdir(new URL('scripts/',root))).some(name=>name.startsWith('internal-')),'Internal workflows belong under tests/internal');
 assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
 for(const entry of entries){
  assert.ok(entry.path.startsWith(`tests/internal/${entry.suite}/`));
  const url=new URL(entry.path,root),source=await readFile(url,'utf8');
  await assert.rejects(access(new URL(entry.previousPath,root)),e=>e.code==='ENOENT');
  await run(process.execPath,['--check',fileURLToPath(url)],{windowsHide:true});
  for(const match of source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?|new URL\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g))await access(new URL(match[1],url));
  assert.ok(!source.includes('scripts/internal-'),'Stale runner reference: '+entry.path);
 }
});

test('suite discovery lists entries without importing or executing fixture workflows',async()=>{
 const {stdout}=await run(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url)),'--list','--suite','licensing'],{windowsHide:true});
 assert.match(stdout,/license-native-client/);assert.ok(!stdout.includes('phase passed'));
 const help=await run(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url))],{windowsHide:true});assert.match(help.stdout,/no run-all/);
 await assert.rejects(run(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url)),'--run','does-not-exist'],{windowsHide:true}));
});
