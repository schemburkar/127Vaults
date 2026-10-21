import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileHash } from './verify-release.mjs';

if (!process.argv[2]) throw Error('Supply the packaged native host executable path.');
const child = spawn(resolve(process.argv[2]), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const option = name => process.argv[process.argv.indexOf(name)+1];
const site = process.argv.includes('--site-origin') ? option('--site-origin') : null;
const source = process.argv.includes('--source') ? option('--source') : 'desktop';
if (site && (new URL(site).origin !== site || !site.startsWith('https://') || !['desktop','cli'].includes(source))) throw Error('Use an exact HTTPS origin and desktop/cli source.');
const timeout = setTimeout(() => child.kill(), site ? 45000 : 10000);
const payload = Buffer.from(JSON.stringify(site ? {id:1,action:'list',source,siteOrigin:site} : { id: 1, action: 'sources' }));
const frame = Buffer.alloc(4 + payload.length);
frame.writeUInt32LE(payload.length);
payload.copy(frame, 4);
const chunks = [];
child.stdout.on('data', chunk => chunks.push(chunk));
child.stderr.resume();
child.stdin.on('error', () => {});
try {
  const done = new Promise((accept, reject) => { child.on('error', reject); child.on('close', accept); });
  child.stdin.end(frame);
  const code = await done;
  const bytes = Buffer.concat(chunks);
  if (code !== 0 || bytes.length < 4 || bytes.readUInt32LE() !== bytes.length - 4) throw Error('Native host framing failed.');
  const response = JSON.parse(bytes.subarray(4).toString());
  if (!response.ok || response.id !== 1 || (site ? !Array.isArray(response.value) : response.value.version !== 1 || !Array.isArray(response.value.sources))) throw Error('Native host read-only check failed.');
  if (site && process.argv.includes('--expect-count') && response.value.length !== Number(option('--expect-count'))) throw Error('Unexpected matching item count.');
  const report={status:'passed',testedAt:new Date().toISOString(),host:resolve(process.argv[2]),sha256:await fileHash(resolve(process.argv[2])),
    ...(site ? {source,siteOrigin:site,matchingItems:response.value.length} : {sourceDiscovery:true})};
  if(process.argv.includes('--receipt')){const path=resolve(option('--receipt'));await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
  console.log(site ? `Native connector returned ${response.value.length} matching sign-in(s); no passwords retrieved.` : 'Packaged native host passed framed source discovery.');
} finally { clearTimeout(timeout); }
