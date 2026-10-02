import { createFixtureFacade } from './fixture-core.mjs';
import { createLoginSession } from './login-session.mjs';

const el = id => document.getElementById(id);
let core;
let current;
let previous;
let interval;
const session = createLoginSession({ onLock() {
  core?.lock();
  if (current) {
    core.forget(previous);
    previous = current;
    current = undefined;
  }
} });
function render() {
  const state = session.status();
  if (previous && core.isValid(previous)) throw new Error('A stale handle revived.');
  el('session').textContent = state.locked ? 'Locked' : 'Fixture active';
  el('current').textContent = current ? (core.isValid(current) ? 'Valid in Rust' : 'Invalid in Rust') : 'None';
  el('previous').textContent = previous ? (core.isValid(previous) ? 'ERROR: still valid' : 'Invalid in Rust') : 'None';
  el('create').disabled = !core || !state.locked;
  el('lock').disabled = !core || state.locked;
  el('verify').disabled = !core;
}
function fail() {
  try { session.lock('error'); } catch { /* Continue clearing the UI after a core failure. */ }
  try { core?.dispose(); } catch { /* A trapped/freed WASM instance is no longer usable. */ }
  core = undefined;
  current = undefined;
  previous = undefined;
  clearInterval(interval);
  el('error').hidden = false;
  el('error').textContent = 'The Rust WASM core could not load or run. Run pnpm fixture:build, check the local server, then reload. No simulated result is available.';
  el('loading').textContent = 'Unavailable';
  el('revision').textContent = '—';
  el('formats').textContent = '—';
  el('session').textContent = 'Locked';
  el('current').textContent = 'None';
  el('previous').textContent = 'None';
  el('result').textContent = 'Fixture actions are disabled.';
  for (const id of ['create', 'lock', 'verify']) el(id).disabled = true;
}
el('create').addEventListener('click', () => {
  try {
    session.beginAfterUnlock(); // Fixture-only bypass; never a real account unlock.
    current = core.createFixture();
    if (!core.isValid(current) || (previous && core.isValid(previous))) throw new Error('Invalid fixture state.');
    el('result').textContent = 'Fixture created inside Rust. No fixture bytes were returned to JavaScript.';
    render();
  } catch { fail(); }
});
el('lock').addEventListener('click', () => {
  try { session.lock(); render(); el('result').textContent = 'Locked. The previous handle is invalid in Rust.'; }
  catch { fail(); }
});
el('verify').addEventListener('click', () => {
  try {
    if (!session.status().locked) session.recordUserActivity();
    render();
    el('result').textContent = 'Validity checked against the loaded Rust store.';
  } catch { fail(); }
});
window.addEventListener('pagehide', () => { clearInterval(interval); session.dispose(); core?.dispose(); core = undefined; });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && core) render(); });
for (const name of ['pointerdown', 'keydown']) document.addEventListener(name, event => {
  if (event.isTrusted && !session.status().locked) session.recordUserActivity();
});
try {
  const { default: init, FixtureCore } = await import('/wasm/vaults_browser_fixture.js');
  const missing = new URLSearchParams(location.search).get('wasm') === 'missing';
  const response = await fetch(missing ? '/wasm/missing.wasm' : '/wasm/vaults_browser_fixture_bg.wasm', { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('WASM asset unavailable.');
  await init({ module_or_path: response });
  core = createFixtureFacade(FixtureCore);
  const capabilities = core.capabilities();
  if (!capabilities.experimental || capabilities.supportedFormats.length !== 0) throw new Error('Unexpected capabilities.');
  el('revision').textContent = String(capabilities.interfaceRevision);
  el('formats').textContent = 'None (reported by Rust)';
  el('loading').textContent = 'Loaded · actual WASM';
  el('result').textContent = 'Ready. Create a disposable fixture to begin.';
  render();
  interval = setInterval(() => { try { render(); } catch { fail(); } }, 1000);
} catch { fail(); }
