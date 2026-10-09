import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { once } from 'node:events';

const executable = process.env.VAULTS_NATIVE_HOST || join(import.meta.dirname, '..', '..', '..', 'target', 'debug', process.platform === 'win32' ? '127vaults-extension-host.exe' : '127vaults-extension-host');
const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
const payload = Buffer.from(JSON.stringify({ id: 1, action: 'sources' }));
const frame = Buffer.alloc(4 + payload.length);
frame.writeUInt32LE(payload.length);
payload.copy(frame, 4);
child.stdin.end(frame);
const chunks = [];
child.stdout.on('data', value => chunks.push(value));
const [code] = await once(child, 'exit');
const output = Buffer.concat(chunks);
if (code !== 0 || output.length < 4 || output.readUInt32LE() !== output.length - 4) throw Error('native host framing failed');
const response = JSON.parse(output.subarray(4).toString());
if (!response.ok || response.id !== 1 || response.value.version !== 1 || !Array.isArray(response.value.sources)) throw Error('native host response failed');
process.stdout.write(`Native host answered with ${response.value.sources.length} source descriptors.\n`);
