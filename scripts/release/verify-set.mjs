import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { execute } from './process.mjs';

const agreements = ['LICENSE.md', 'COMMERCIAL-LICENSE.md'];
const text = value => String(value).replace(/\r\n/g, '\n');

// Read agreements from the actual installer/archive, not just its companion files.
export async function verifyEmbeddedAgreements(directories, settings, run = execute) {
  for (const directory of directories) {
    const manifest = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'));
    for (const asset of manifest.files.filter(file => /\.(?:zip|tar\.gz|exe|deb|AppImage)$/.test(file.name))) {
      const archive = join(directory, asset.name);
      for (const agreement of agreements) {
        const expected = await readFile(join(directory, agreement), 'utf8');
        let actual;
        if (/\.(?:exe|AppImage)$/.test(asset.name)) {
          const member = asset.name.endsWith('.exe') ? agreement : `usr/lib/127Vaults Desktop/${agreement}`;
          actual = await run(settings.sevenZip, ['e', '-so', archive, member], { capture: true, quiet: true });
        } else if (asset.name.endsWith('.deb')) {
          const linuxPath = '/mnt/' + archive[0].toLowerCase() + archive.slice(2).replaceAll('\\', '/');
          const python = "import subprocess,tarfile,io,sys; data=subprocess.check_output(['dpkg-deb','--fsys-tarfile',sys.argv[1]]); t=tarfile.open(fileobj=io.BytesIO(data)); m=next(m for m in t.getmembers() if m.name.endswith('/'+sys.argv[2])); sys.stdout.buffer.write(t.extractfile(m).read())";
          actual = await run('wsl.exe', ['-d', settings.wslDistro, ...(settings.wslUser ? ['-u', settings.wslUser] : []), '--exec', 'python3', '-c', python, linuxPath, agreement], { capture: true, quiet: true });
        } else {
          const stem = manifest.product === 'extension' ? '127vaults-extension' : basename(asset.name).replace(/\.(?:zip|tar\.gz)$/, '');
          actual = await run('tar', ['-xOf', archive, `${stem}/${agreement}`], { capture: true, quiet: true });
        }
        // execute() trims terminal output; preserve content and normalize platform line endings.
        assert.equal(text(actual).trim(), text(expected).trim(), `Embedded agreement differs: ${asset.name}/${agreement}`);
      }
    }
  }
}

export async function verifyLiveDelivery(config, catalogue, token, { fetchImpl = fetch, partSize = 4 * 1024 * 1024 } = {}) {
  const auth = { Authorization: `Bearer ${token}` };
  const unauthenticatedDenialStatuses = new Set();
  const request = async (path, options = {}, read = response => response, authenticated = true) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetchImpl(config.origin + path, {
          ...options, headers: { ...(authenticated ? auth : {}), ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(45000),
        });
        if ([502, 503, 504].includes(response.status) && attempt < 2) {
          await response.body?.cancel();
        } else return await read(response);
      } catch (error) {
        if (attempt >= 2 || !(error instanceof TypeError || ['AbortError', 'TimeoutError'].includes(error.name))) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  };
  const listed = await request('/api/access-admin/releases', {}, async response => {
    assert.equal(response.status, 200, 'Live release catalogue unavailable');
    return response.json();
  });
  assert.equal(listed.sourceRevision, catalogue.sourceRevision);
  assert.deepEqual(listed.artifacts.map(a => [a.id, a.sha256, a.sizeBytes]), catalogue.artifacts.map(a => [a.id, a.sha256, a.sizeBytes]));
  for (const asset of catalogue.artifacts.filter(a => !a.supporting)) {
    const path = '/api/access-admin/releases/artifacts/' + asset.id;
    const denied = await request(path, { method: 'HEAD' }, response => response, false);
    // Repeated rehearsals can exhaust the admin endpoint's unauthenticated rate
    // limit. Both responses deny access; authenticated download checks follow.
    assert.ok([401, 429].includes(denied.status), 'Installer accepted unauthenticated access');
    unauthenticatedDenialStatuses.add(denied.status);
    const head = await request(path, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), asset.sizeBytes);
  }
  const server = catalogue.artifacts.find(a => a.id === 'server');
  assert.ok(server, 'Missing server archive');
  const digest = createHash('sha256');
  for (let start = 0; start < server.sizeBytes; start += partSize) {
    const end = Math.min(server.sizeBytes, start + partSize) - 1;
    const bytes = await request('/api/access-admin/releases/artifacts/server', { headers: { Range: `bytes=${start}-${end}` } }, async part => {
      assert.equal(part.status, 206);
      assert.equal(part.headers.get('content-range'), `bytes ${start}-${end}/${server.sizeBytes}`);
      return Buffer.from(await part.arrayBuffer());
    });
    assert.equal(bytes.length, end - start + 1);
    digest.update(bytes);
  }
  assert.equal(digest.digest('hex'), server.sha256, 'Live server download checksum mismatch');
  return { status: 'passed', artifacts: catalogue.artifacts.length, authenticatedServerBytes: server.sizeBytes,
    unauthenticatedDenialStatuses: [...unauthenticatedDenialStatuses].sort(),
    sourceRevision: catalogue.sourceRevision, verifiedAt: new Date().toISOString() };
}
