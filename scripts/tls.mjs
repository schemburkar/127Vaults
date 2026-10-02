import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, realpathSync } from 'node:fs';
import { isIP } from 'node:net';
import { relative, resolve } from 'node:path';

const IMAGE = 'docker.io/alpine/openssl:3.5.4';
const action = process.argv[2];
const endpoint = process.argv[3];
const targetArg = process.argv[4];
if (!['init', 'renew'].includes(action) || !targetArg || !(endpoint === 'localhost' || isIP(endpoint))) {
  throw new Error('Usage: node scripts/tls.mjs init|renew localhost|<literal-ip> <absolute-private-directory>');
}
if (isIP(endpoint) === 0 && endpoint !== 'localhost') throw new Error('Custom DNS names are forbidden.');
const target = resolve(targetArg);
const fromRepo = relative(resolve('.'), target);
if (fromRepo === '' || (!fromRepo.startsWith('..') && !fromRepo.includes(':'))) throw new Error('TLS private directory must be outside the repository.');
mkdirSync(target, { recursive: true, mode: 0o700 });
if (process.platform === 'win32' && action === 'init') {
  const identity = process.env.USERDOMAIN && process.env.USERNAME ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
  if (!identity) throw new Error('Cannot identify the provisioning operator for the TLS-directory ACL.');
  const acl = spawnSync('icacls', [target, '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/T', '/C'], { stdio: 'inherit', windowsHide: true });
  if (acl.error || acl.status !== 0) throw new Error('Could not restrict the TLS-directory ACL.');
} else chmodSync(target, 0o700);
const san = endpoint === 'localhost' ? 'DNS:localhost' : `IP:${endpoint}`;
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
if [ "$HOST_WINDOWS" = 1 ]; then chmod 644 /tls/ca/ca.key /tls/pending/server.key; else chmod 600 /tls/ca/ca.key /tls/pending/server.key; fi
chmod 644 /tls/ca/ca.crt /tls/pending/server.crt
if [ "$HOST_WINDOWS" != 1 ]; then chown 1000:1000 /tls/pending/server.key /tls/pending/server.crt; fi
rm -rf /tls/previous
if [ -e /tls/live/server.crt ]; then mv /tls/live /tls/previous; else rmdir /tls/live; fi
mv /tls/pending /tls/live
mkdir -m 700 /tls/pending
openssl x509 -in /tls/live/server.crt -noout -fingerprint -sha256 -dates -ext subjectAltName
`;
const engine = process.env.VAULTS_ENGINE ?? 'podman';
if (!['podman', 'docker'].includes(engine)) throw new Error('VAULTS_ENGINE must be podman or docker.');
const run = spawnSync(engine, ['run', '--rm', '--network=none', '--read-only', '--cap-drop=all',
  '--security-opt=no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=4m',
  '-e', `ACTION=${action}`, '-e', `SAN=${san}`, '-e', `HOST_WINDOWS=${process.platform === 'win32' ? '1' : '0'}`, '-v', `${realpathSync(target)}:/tls:Z`,
  '--entrypoint', 'sh', IMAGE, '-ceu', script],
  { stdio: 'inherit', windowsHide: true });
if (run.error || run.status !== 0) throw new Error('Certificate operation failed; the previous live pair was preserved until validation completed.');
console.log(`Public CA: ${resolve(target, 'ca', 'ca.crt')}`);
console.log('Install that CA explicitly only after verifying its displayed SHA-256 fingerprint. Never distribute ca.key.');
