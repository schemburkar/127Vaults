import { createLoginItem } from '/packages/domain/src/login-item.mjs';
import { Ecf1WorkerClient } from './ecf1-worker-client.mjs';
import { createLoginSession } from './login-session.mjs';

const STORAGE_KEY = '127vaults.disposable.ecf1.login-item.v1';
const el = id => document.getElementById(id);
const worker = new Ecf1WorkerClient();
let unlocked = false;
let busy = false;
const session = createLoginSession({ onLock() {
  worker.lock();
  unlocked = false;
  clearSecrets();
  queueMicrotask(render);
} });

function readRecord() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return value?.format === 'ECF1' && Number.isInteger(value.revision) ? value : null;
  } catch { return null; }
}
function itemFromForm() {
  return createLoginItem({ title: el('title').value, username: el('username').value,
    password: el('password').value, urls: [el('url').value], customFields: [] });
}
function clearSecrets() {
  for (const id of ['master', 'secret', 'title', 'url', 'username', 'password']) el(id).value = '';
}
function fillItem(item) {
  el('title').value = item.title; el('username').value = item.username;
  el('password').value = item.password; el('url').value = item.urls[0] ?? '';
}
function render() {
  const record = readRecord();
  el('state').textContent = busy ? 'Working…' : unlocked ? 'Unlocked' : 'Locked';
  el('mode').textContent = unlocked ? (record ? 'Decrypted in this session' : 'Ready to create') : 'Locked';
  el('format').textContent = record?.format ?? 'None';
  el('bytes').textContent = String(record?.item?.envelope?.length ?? 0);
  el('revision').textContent = record ? String(record.revision) : '—';
  el('storage').textContent = record ? 'Encrypted envelopes + public metadata' : 'Empty';
  el('unlock').disabled = busy || unlocked || !record;
  el('lock').disabled = busy || !unlocked;
  el('reset').disabled = busy || !record;
  for (const id of ['title', 'url', 'username', 'password']) el(id).disabled = busy || !unlocked;
  el('save').disabled = busy || !unlocked;
  el('save').textContent = record ? 'Save encrypted edit' : 'Create encrypted fixture';
}
async function lock(message = 'Locked. Rendered secrets and Rust key handles were cleared.') {
  busy = true; render();
  session.lock('manual');
  busy = false; render(); el('message').textContent = message;
}
el('unlock').addEventListener('click', async () => {
  const record = readRecord(); if (!record) return;
  busy = true; render();
  try {
    const password = el('master').value;
    const accountSecret = el('secret').value;
    session.beginAfterUnlock(); // Disposable bypass; Batch 5 supplies real authentication.
    const result = await worker.request('unlock', { record, password, accountSecret });
    const item = createLoginItem(result.item); session.openItem(item); fillItem(item); unlocked = true;
    el('message').textContent = 'Decrypted only after Rust/WASM unlocked the stored ECF1 hierarchy.';
  } catch { session.lock('unlock-failed'); el('message').textContent = 'Unlock failed. Inputs and rendered item data were cleared.'; }
  busy = false; render();
});
el('lock').addEventListener('click', () => lock());
el('reset').addEventListener('click', async () => {
  localStorage.removeItem(STORAGE_KEY); await lock('Disposable encrypted fixture deleted.');
});
el('item-form').addEventListener('submit', async event => {
  event.preventDefault(); busy = true; render();
  try {
    const item = itemFromForm(); const record = readRecord();
    session.openItem(item);
    const result = record
      ? await worker.request('save', { record, item })
      : await worker.request('create', { password: el('master').value, accountSecret: el('secret').value, item });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result.record));
    el('message').textContent = record ? 'Encrypted edit replaced the stored item envelope.' : 'Plaintext was encrypted before the ECF1 record entered browser storage.';
  } catch { session.closeItem(); el('message').textContent = 'The item was not stored. Check the fictitious inputs and try again.'; }
  busy = false; render();
});
window.addEventListener('pagehide', () => { clearSecrets(); session.dispose(); worker.dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

try {
  const response = await fetch('/wasm/vaults_browser_fixture_bg.wasm', { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error();
  el('message').textContent = readRecord() ? 'Encrypted fixture found. Enter its fictitious unlock values.' : 'No fixture stored. Unlock this disposable session to create one.';
  if (!readRecord()) {
    session.beginAfterUnlock(); unlocked = true;
    el('master').value = 'fictitious master password';
    el('secret').value = '09'.repeat(32);
    fillItem(createLoginItem({ title: 'Example account', username: 'demo.user@example.test',
      password: 'not-a-real-password', urls: ['https://example.test'], customFields: [] }));
  }
} catch { el('message').textContent = 'Compiled Rust/WASM unavailable. Run pnpm fixture:build.'; }
render();
for (const name of ['pointerdown', 'keydown']) document.addEventListener(name, event => {
  if (event.isTrusted && unlocked) session.recordUserActivity();
});
