import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Publish notes only; installer assets remain in the private Cloudflare catalogue.
export async function publishNotes([tag, revision, notesFile, mode = '--plan'], deps = {}) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag || '') || !/^[a-f0-9]{40}$/.test(revision || '') || !notesFile || !['--plan', '--publish'].includes(mode)) {
    throw Error('Usage: node scripts/release/github.mjs vX.Y.Z <40-character commit> <notes.md> [--plan|--publish]');
  }
  const exec = deps.execFileSync || execFileSync, spawn = deps.spawnSync || spawnSync;
  const remote = exec('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true }).trim();
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(remote);
  if (!match) throw Error('Expected a GitHub HTTPS origin.');
  const credential = spawn('git', ['credential', 'fill'], {
    input: `protocol=https\nhost=github.com\npath=${match[1]}/${match[2]}\n\n`, encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
  });
  if (credential.status !== 0) throw Error('GitHub credentials unavailable from the configured Git credential helper.');
  const token = credential.stdout.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  if (!token) throw Error('Git credential helper returned no access token.');
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
  const existing = await request(`/releases/tags/${tag}`);
  if (existing) {
    if (existing.body !== body || existing.draft || existing.target_commitish !== revision) throw Error('Existing GitHub release differs; review it before updating.');
    return { status: 'already-published', url: existing.html_url };
  }
  if (mode === '--plan') return { status: 'ready', tag, revision, private: repo.private, assets: 0 };
  const result = await request('/releases', 'POST', { tag_name: tag, target_commitish: revision, name: `127Vaults ${tag.slice(1)}`, body, draft: false, prerelease: false });
  if (!result) throw Error('GitHub release creation failed.');
  return { status: 'published', url: result.html_url };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishNotes(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
