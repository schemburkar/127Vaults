import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, existsSync, openSync, readFileSync, readSync, rmSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('127VBAK1');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_HEADER_BYTES = 64 * 1024;

function fail(message) { throw new Error(message); }
function usage() {
  fail('Usage: backup-envelope.mjs seal|verify|open --input <file> [--output <file>] --key-file <file> [--database <name> --server-id <id> --required-version <version>]');
}
function argsOf(values) {
  const result = { action: values[0] };
  for (let i = 1; i < values.length; i += 2) {
    if (!values[i]?.startsWith('--') || values[i + 1] === undefined) usage();
    result[values[i].slice(2)] = values[i + 1];
  }
  return result;
}
function loadKey(path) {
  const raw = readFileSync(path);
  if (raw.length === 32) return raw;
  const text = raw.toString('utf8').trim();
  if (/^[0-9a-f]{64}$/i.test(text)) return Buffer.from(text, 'hex');
  const decoded = Buffer.from(text, 'base64');
  if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/, '') === text.replace(/=+$/, '')) return decoded;
  fail('Backup key must be exactly 32 raw bytes, 64 hexadecimal characters, or canonical base64 for 32 bytes.');
}
async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}
function headerBuffer(header) {
  const encoded = Buffer.from(JSON.stringify(header), 'utf8');
  if (encoded.length > MAX_HEADER_BYTES) fail('Backup header is too large.');
  return encoded;
}
function prefix(header, nonce) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return Buffer.concat([MAGIC, length, header, nonce]);
}
function readEnvelope(path) {
  const size = statSync(path).size;
  const fixed = Buffer.alloc(MAGIC.length + 4);
  const fd = openSync(path, 'r');
  try { if (readSync(fd, fixed, 0, fixed.length, 0) !== fixed.length) fail('Truncated backup envelope.'); }
  finally { closeSync(fd); }
  if (!fixed.subarray(0, MAGIC.length).equals(MAGIC)) fail('Unknown backup format.');
  const headerLength = fixed.readUInt32BE(MAGIC.length);
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) fail('Invalid backup header length.');
  const payloadOffset = fixed.length + headerLength + NONCE_BYTES;
  if (size < payloadOffset + TAG_BYTES) fail('Truncated backup envelope.');
  const metadata = Buffer.alloc(headerLength + NONCE_BYTES);
  const metadataFd = openSync(path, 'r');
  try { if (readSync(metadataFd, metadata, 0, metadata.length, fixed.length) !== metadata.length) fail('Truncated backup envelope.'); }
  finally { closeSync(metadataFd); }
  const headerBytes = metadata.subarray(0, headerLength);
  let header;
  try { header = JSON.parse(headerBytes.toString('utf8')); } catch { fail('Invalid backup header JSON.'); }
  if (header.format !== '127vaults-postgres-backup' || header.version !== 1 || header.cipher !== 'aes-256-gcm') fail('Unsupported backup format, version, or cipher.');
  return {
    header, headerBytes, payloadOffset,
    nonce: metadata.subarray(headerLength),
    tag: (() => { const tag = Buffer.alloc(TAG_BYTES); const tagFd = openSync(path, 'r'); try { if (readSync(tagFd, tag, 0, TAG_BYTES, size - TAG_BYTES) !== TAG_BYTES) fail('Truncated backup envelope.'); } finally { closeSync(tagFd); } return tag; })(), size,
  };
}
function ensureNewOutput(path) {
  if (!path) usage();
  if (existsSync(path)) fail(`Refusing to overwrite existing output: ${path}`);
}
async function seal(args) {
  ensureNewOutput(args.output);
  const header = {
    format: '127vaults-postgres-backup', version: 1, cipher: 'aes-256-gcm',
    createdAt: new Date().toISOString(), database: args.database ?? 'vaults_experimental',
    serverId: args['server-id'] ?? 'unspecified', requiredVersion: args['required-version'] ?? 'experimental',
    plaintextBytes: statSync(args.input).size, plaintextSha256: await sha256(args.input),
  };
  const encoded = headerBuffer(header);
  const nonce = randomBytes(NONCE_BYTES);
  const aad = prefix(encoded, nonce);
  const cipher = createCipheriv('aes-256-gcm', loadKey(args['key-file']), nonce);
  cipher.setAAD(aad);
  const output = createWriteStream(args.output, { flags: 'wx', mode: 0o600 });
  output.write(aad);
  try {
    await pipeline(createReadStream(args.input), cipher, output, { end: false });
    output.end(cipher.getAuthTag());
    await new Promise((resolve, reject) => { output.once('finish', resolve); output.once('error', reject); });
  } catch (error) { output.destroy(); rmSync(args.output, { force: true }); throw error; }
  console.log(JSON.stringify(header, null, 2));
}
async function decrypt(args, destination) {
  const info = readEnvelope(args.input);
  const decipher = createDecipheriv('aes-256-gcm', loadKey(args['key-file']), info.nonce);
  decipher.setAAD(prefix(info.headerBytes, info.nonce));
  decipher.setAuthTag(info.tag);
  const hash = createHash('sha256');
  let bytes = 0;
  decipher.on('data', chunk => { hash.update(chunk); bytes += chunk.length; });
  await pipeline(createReadStream(args.input, { start: info.payloadOffset, end: info.size - TAG_BYTES - 1 }), decipher, destination);
  if (bytes !== info.header.plaintextBytes || hash.digest('hex') !== info.header.plaintextSha256) fail('Authenticated plaintext does not match its manifest.');
  return info.header;
}
async function main() {
  const args = argsOf(process.argv.slice(2));
  if (!args.input || !args['key-file']) usage();
  if (args.action === 'seal') return seal(args);
  if (args.action === 'verify') {
    const header = await decrypt(args, async function* (source) { for await (const _ of source) { /* discard */ } });
    return console.log(JSON.stringify(header, null, 2));
  }
  if (args.action === 'open') {
    ensureNewOutput(args.output);
    const output = createWriteStream(args.output, { flags: 'wx', mode: 0o600 });
    try { console.log(JSON.stringify(await decrypt(args, output), null, 2)); }
    catch (error) { output.destroy(); rmSync(args.output, { force: true }); throw error; }
    return;
  }
  usage();
}

main().catch(error => { console.error(`backup-envelope: ${error.message}`); process.exitCode = 1; });
