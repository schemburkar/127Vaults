import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

if (!process.argv[2]) throw Error('Supply the packaged native host executable path.');
const child = spawn(resolve(process.argv[2]), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const timeout = setTimeout(() => child.kill(), 10000);
const payload = Buffer.from(JSON.stringify({ id: 1, action: 'sources' }));
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
  if (!response.ok || response.id !== 1 || response.value.version !== 1 || !Array.isArray(response.value.sources)) throw Error('Native host discovery failed.');
  console.log('Packaged native host passed framed source discovery.');
} finally { clearTimeout(timeout); }
