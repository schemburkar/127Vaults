import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyRelease } from './verify-release.mjs';
import { fileURLToPath } from 'node:url';

// Installer attachment is opt-in; all other package assets remain in R2.
export async function installerAssets(root, tag, revision, deps = {}) {
  const assets = [];
  for (const platform of ['windows', 'linux']) {
    const directory = join(resolve(root), 'installer', tag.slice(1), platform);
    const manifest = await (deps.verifyRelease || verifyRelease)(directory);
    if (manifest.product !== 'installer' || manifest.platform !== platform || manifest.packageVersion !== tag.slice(1)
      || (manifest.requestedSourceRevision || manifest.sourceRevision) !== revision) throw Error('Installer does not match release version/source.');
    const name = `127vaults-installer-${tag.slice(1)}-${platform}-x64.${platform === 'windows' ? 'zip' : 'tar.gz'}`;
    const entry = manifest.files.find(file => file.name === name);
    if (!entry) throw Error('Installer archive missing from verified manifest.');
    const bytes = await (deps.readFile || readFile)(join(directory, name));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== entry.sha256 || bytes.length !== entry.sizeBytes) throw Error('Installer archive changed after verification.');
    assets.push({ name, bytes, sha256 });
  }
  const bytes = Buffer.from(assets.map(asset => `${asset.sha256}  ${asset.name}\n`).join(''));
  assets.push({ name: `127vaults-installer-${tag.slice(1)}-SHA256SUMS.txt`, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
  return assets;
}

export async function attachAssets(release, assets, mode, api) {
  const existing = [];
  for (let page = 1; ; page++) {
    const rows = await api.request(`/releases/${release.id}/assets?per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw Error('Unable to list GitHub release assets.');
    existing.push(...rows);
    if (rows.length < 100) break;
  }
  // Preflight every name before uploading; never overwrite an existing asset.
  for (const asset of assets) {
    const found = existing.filter(row => row.name === asset.name);
    if (found.length > 1 || found.some(row => row.size !== asset.bytes.length || row.digest !== `sha256:${asset.sha256}` || row.state !== 'uploaded')) {
      throw Error(`Existing GitHub asset differs: ${asset.name}`);
    }
  }
  for (const asset of assets) {
    if (existing.some(row => row.name === asset.name) || mode === '--plan') continue;
    const result = await api.upload(release.id, asset);
    if (result?.name !== asset.name || result.size !== asset.bytes.length || result.digest !== `sha256:${asset.sha256}` || result.state !== 'uploaded') {
      throw Error(`GitHub upload verification failed: ${asset.name}`);
    }
  }
  return assets.map(({name, sha256}) => ({name, sha256}));
}

export async function publishNotes([tag, revision, notesFile, mode = '--plan', installersRoot], deps = {}) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag || '') || !/^[a-f0-9]{40}$/.test(revision || '') || !notesFile || !['--plan', '--publish'].includes(mode)) {
    throw Error('Usage: node scripts/release/github.mjs vX.Y.Z <40-character commit> <notes.md> [--plan|--publish] [release-output-root]');
  }
  const exec = deps.execFileSync || execFileSync, spawn = deps.spawnSync || spawnSync;
  const remote = exec('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true }).trim();
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(remote);
  if (!match) throw Error('Expected a GitHub HTTPS origin.');
  const environment = deps.env ?? process.env;
  let token = environment.GITHUB_TOKEN || environment.GH_TOKEN;
  if (!token) {
    const credential = spawn('git', ['credential', 'fill'], {
      input: `protocol=https\nhost=github.com\npath=${match[1]}/${match[2]}\n\n`, encoding: 'utf8', windowsHide: true, timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    });
    if (credential.status !== 0) throw Error('GitHub credentials unavailable from the configured Git credential helper.');
    token = credential.stdout.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
    if (!token) throw Error('Git credential helper returned no access token.');
  }
  const base = `https://api.github.com/repos/${match[1]}/${match[2]}`;
  async function request(path, method = 'GET', value) {
    const response = await (deps.fetch || fetch)(base + path, { method, signal: AbortSignal.timeout(30000), headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      ...(value ? { 'Content-Type': 'application/json' } : {}),
    }, ...(value ? { body: JSON.stringify(value) } : {}) });
    if (response.status === 404) return null;
    if (!response.ok) throw Error(`GitHub ${method} ${path || '/'} failed: HTTP ${response.status}`);
    return response.json();
  }
  const repo = await request('');
  if (!repo?.private) throw Error('Expected the configured private repository.');
  if (!await request(`/commits/${revision}`)) throw Error('Push the release source commit before publishing its GitHub release.');
  const body = await (deps.readFile || readFile)(notesFile, 'utf8');
  const assets = installersRoot ? await installerAssets(installersRoot, tag, revision, deps) : [];
  async function upload(id, asset) {
    const url = `https://uploads.github.com/repos/${match[1]}/${match[2]}/releases/${id}/assets?name=${encodeURIComponent(asset.name)}`;
    const response = await (deps.fetch || fetch)(url, { method: 'POST', signal: AbortSignal.timeout(120000), redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/octet-stream', 'X-GitHub-Api-Version': '2022-11-28' }, body: asset.bytes });
    if (!response.ok) throw Error(`GitHub asset upload failed: HTTP ${response.status}`);
    return response.json();
  }
  async function verifyTag(required = false) {
    const ref = await request(`/git/ref/tags/${tag}`);
    if (!ref) { if (required) throw Error('GitHub release tag is missing.'); return; }
    let object = ref.object;
    for (let depth = 0; object?.type === 'tag' && depth < 4; depth++) object = (await request(`/git/tags/${object.sha}`))?.object;
    if (object?.type !== 'commit' || object.sha !== revision) throw Error('GitHub tag does not point at the exact package source commit.');
  }
  await verifyTag();
  const existing = await request(`/releases/tags/${tag}`);
  if (existing) {
    await verifyTag(true);
    // Attaching installers preserves the existing notes, which may describe the
    // original notes-only release. Source and version must still match exactly.
    if ((existing.body !== body && (!installersRoot || existing.body?.replace('no package assets are attached to this GitHub release.', 'the standalone installer archives and checksums are also attached below.') !== body)) || existing.draft || existing.target_commitish !== revision) throw Error('Existing GitHub release differs; review it before updating.');
    const attached = assets.length ? await attachAssets(existing, assets, mode, {request, upload}) : [];
    if (assets.length && mode === '--publish') {
      const updatedBody = existing.body?.replace('no package assets are attached to this GitHub release.', 'the standalone installer archives and checksums are also attached below.');
      if (updatedBody !== existing.body) await request(`/releases/${existing.id}`, 'PATCH', {body: updatedBody});
    }
    return { status: assets.length ? mode === '--plan' ? 'assets-ready' : 'assets-verified' : 'already-published', url: existing.html_url, ...(assets.length ? {assets: attached} : {}) };
  }
  if (mode === '--plan') return { status: 'ready', tag, revision, private: repo.private, assets: assets.length };
  const result = await request('/releases', 'POST', { tag_name: tag, target_commitish: revision, name: `127Vaults ${tag.slice(1)}`, body, draft: false, prerelease: false });
  if (!result) throw Error('GitHub release creation failed.');
  await verifyTag(true);
  const attached = assets.length ? await attachAssets(result, assets, mode, {request, upload}) : [];
  return { status: 'published', url: result.html_url, ...(assets.length ? {assets: attached} : {}) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishNotes(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
