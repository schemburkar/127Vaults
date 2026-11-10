import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, realpathSync, readFileSync, existsSync } from 'node:fs';
import { createHash, X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { relative, resolve } from 'node:path';

const IMAGE = 'docker.io/alpine/openssl:3.5.4';
const { validServerHostname } = await import(existsSync(new URL('../apps/server/src/hostname.mjs', import.meta.url))
  ? '../apps/server/src/hostname.mjs' : './hostname.mjs');
export function certificateSan(endpoint) {
  if (endpoint === 'localhost' || validServerHostname(endpoint)) return `DNS:${endpoint}`;
  if (isIP(endpoint)) return `IP:${endpoint}`;
  throw new Error('Use localhost, a literal IP or an exact lowercase DNS hostname (no .local/.localhost aliases).');
}
export function windowsOperatorSid(run = spawnSync) {
  const result = run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  const matches = result.stdout?.match(/\bS-1-\d+(?:-\d+)+\b/g) ?? [];
  if (result.error || result.status !== 0 || matches.length !== 1) throw new Error('Cannot identify the provisioning operator SID for the TLS-directory ACL.');
  return `*${matches[0]}`;
}
export function runTls(argv) {
const action = argv[0];
const endpoint = argv[1];
const targetArg = argv[2];
if (!['init', 'renew'].includes(action) || !targetArg) {
  throw new Error('Usage: node server.mjs tls init|renew localhost|<literal-ip> <absolute-private-directory>');
}
const target = resolve(targetArg);
const current = resolve(target, 'live/server.crt');
const localAdmin = argv.includes('--local-admin') || (action === 'renew' && existsSync(current)
  && new X509Certificate(readFileSync(current)).checkIP('127.0.0.1'));
const san = certificateSan(endpoint) + (localAdmin && endpoint !== '127.0.0.1' ? ',IP:127.0.0.1' : '');
const fromRepo = relative(resolve('.'), target);
if (fromRepo === '' || (!fromRepo.startsWith('..') && !fromRepo.includes(':'))) throw new Error('TLS private directory must be outside the repository.');
mkdirSync(target, { recursive: true, mode: 0o700 });
const operator = process.platform === 'win32' ? windowsOperatorSid() : null;
if (process.platform === 'win32' && action === 'init') {
  const acl = spawnSync('icacls', [target, '/inheritance:r', '/grant:r', `${operator}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/T', '/C'], { stdio: 'inherit', windowsHide: true });
  if (acl.error || acl.status !== 0) throw new Error('Could not restrict the TLS-directory ACL.');
} else chmodSync(target, 0o700);
const script = String.raw`
umask 077
mkdir -p /tls/ca /tls/live /tls/pending
if [ "$ACTION" = init ]; then
  test ! -e /tls/ca/ca.key || { echo 'CA already exists' >&2; exit 1; }
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -sha256 -nodes -days 1825 \
    -subj /CN=127Vaults-local-CA -addext basicConstraints=critical,CA:true,pathlen:0 \
    -addext keyUsage=critical,keyCertSign,cRLSign -keyout /tls/ca/ca.key -out /tls/ca/ca.crt
  : > /tls/ca/index.txt
  mkdir -p /tls/ca/newcerts
else
  test -s /tls/ca/ca.key && test -s /tls/ca/ca.crt
fi
openssl x509 -in /tls/ca/ca.crt -checkend 7776300 -noout
rm -rf /tls/pending/*
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -sha256 \
  -subj /CN=127Vaults-local-server -keyout /tls/pending/server.key -out /tls/pending/server.csr
openssl rand -hex 16 > /tls/ca/serial
cat > /tls/pending/ca.cnf <<EOF
[ca]
default_ca=local_ca
[local_ca]
database=/tls/ca/index.txt
new_certs_dir=/tls/ca/newcerts
serial=/tls/ca/serial
certificate=/tls/ca/ca.crt
private_key=/tls/ca/ca.key
default_md=sha256
policy=allow_cn
unique_subject=no
[allow_cn]
commonName=supplied
[server_ext]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=$SAN
EOF
NOW="$(date -u +%s)"
START="$(date -u -d "@$((NOW - 300))" +%y%m%d%H%M%SZ)"
END="$(date -u -d "@$((NOW + 7776000))" +%y%m%d%H%M%SZ)"
openssl ca -batch -config /tls/pending/ca.cnf -startdate "$START" -enddate "$END" \
  -extensions server_ext -in /tls/pending/server.csr -out /tls/pending/server.crt
openssl verify -CAfile /tls/ca/ca.crt /tls/pending/server.crt
openssl x509 -in /tls/pending/server.crt -checkend 7689600 -noout
openssl pkey -in /tls/pending/server.key -pubout -out /tls/pending/key.pub
openssl x509 -in /tls/pending/server.crt -pubkey -noout > /tls/pending/cert.pub
cmp /tls/pending/key.pub /tls/pending/cert.pub
rm -f /tls/pending/server.csr /tls/pending/ca.cnf /tls/pending/key.pub /tls/pending/cert.pub
chmod 700 /tls/ca /tls/live /tls/pending
chmod 600 /tls/ca/ca.key /tls/pending/server.key
chmod 644 /tls/ca/ca.crt /tls/pending/server.crt
chown 1000:1000 /tls/pending /tls/pending/server.key /tls/pending/server.crt
rm -rf /tls/previous
if [ -n "$(ls -A /tls/live)" ]; then mv /tls/live /tls/previous; else rmdir /tls/live; fi
mv /tls/pending /tls/live
mkdir -m 700 /tls/pending
echo 'CA certificate DER fingerprint:'
openssl x509 -in /tls/ca/ca.crt -noout -fingerprint -sha256
echo 'Server certificate validity and endpoint:'
openssl x509 -in /tls/live/server.crt -noout -dates -ext subjectAltName
`;
const engine = process.env.VAULTS_ENGINE ?? 'podman';
if (!['podman', 'docker'].includes(engine)) throw new Error('VAULTS_ENGINE must be podman or docker.');
const run = spawnSync(engine, ['run', '--rm', '--network=none', '--read-only', '--cap-drop=all', '--cap-add=CHOWN', '--cap-add=FOWNER', '--cap-add=DAC_OVERRIDE',
  '--security-opt=no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=4m',
  '-e', `ACTION=${action}`, '-e', `SAN=${san}`, '-e', `HOST_WINDOWS=${process.platform === 'win32' ? '1' : '0'}`, '-v', `${realpathSync(target)}:/tls:Z`,
  '--entrypoint', 'sh', IMAGE, '-ceu', script],
  { stdio: 'inherit', windowsHide: true });
if (process.platform === 'win32') {
  // chmod inside the Podman VM can replace host ACLs on bind-mounted files.
  const acl = spawnSync('icacls', [target, '/grant:r', `${operator}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/T', '/C'], { stdio: 'inherit', windowsHide: true });
  if (acl.error || acl.status !== 0) throw new Error('Could not restore the TLS-directory ACL after container provisioning.');
}
if (run.error || run.status !== 0) throw new Error('Certificate operation failed; the previous live pair was preserved until validation completed.');
console.log(`Public CA: ${resolve(target, 'ca', 'ca.crt')}`);
console.log(`CA file SHA-256 (desktop/CLI): ${createHash('sha256').update(readFileSync(resolve(target, 'ca', 'ca.crt'))).digest('hex')}`);
console.log('Install that CA explicitly only after verifying its displayed SHA-256 fingerprint. Never distribute ca.key.');
}
