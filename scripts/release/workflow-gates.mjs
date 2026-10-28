import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function assertMainSynchronized(revision, directory = process.cwd()) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw Error('Expected the exact 40-character release source.');
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true }).trim();
  if (git(['branch','--show-current']) !== 'main') throw Error('Release requires local main.');
  if (git(['status','--porcelain'])) throw Error('Commit intended release work; preserve unrelated edits before publishing.');
  const head = git(['rev-parse','HEAD']), remote = git(['rev-parse','refs/remotes/origin/main']);
  if (head !== revision || head !== remote || git(['rev-list','--count','origin/main..main']) !== '0') throw Error('Fetch and synchronize local main and origin/main before creating a release.');
  git(['merge-base','--is-ancestor',revision,'origin/main']);
  return { sourceRevision: revision, localMain: head, remoteMain: remote, unpushedCommits: 0 };
}
export async function checkReleaseNotes(version, directory = process.cwd()) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw Error('Expected a coordinated X.Y.Z release version.');
  const entries = JSON.parse(await readFile(resolve(directory,'public-website/release-notes.json'),'utf8'));
  const matching = entries.filter(entry => entry.version === version);
  if (matching.length !== 1 || !matching[0].changes?.length) throw Error('Prepare versioned public release notes first.');
  const markdown = await readFile(resolve(directory,`docs/release/${version}.md`),'utf8');
  const html = await readFile(resolve(directory,'public-website/downloads.html'),'utf8');
  if (!markdown.replaceAll('\r\n','\n').startsWith(`# 127Vaults ${version}\n`) || !html.includes(`id="version-${version.replaceAll('.','-')}"`)) throw Error('Build and commit matching Markdown and public site notes first.');
  return { version, notesFile: `docs/release/${version}.md` };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action,value] = process.argv.slice(2);
    const result = action === 'sync' ? assertMainSynchronized(value) : action === 'notes' ? await checkReleaseNotes(value) : (() => { throw Error('Use workflow-gates.mjs sync REVISION | notes VERSION'); })();
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
