import { Ecf1WorkerClient, ECF1_DEADLINE_MS } from '/src/ecf1-worker-client.mjs';

const output = document.querySelector('#result');
const client = new Ecf1WorkerClient();
let phase = 'deadline';
try {
  const deadlineStarted = performance.now();
  let deadline = false;
  try { await client.request('stall'); } catch (error) { deadline = error.message === 'CANCELLED'; }
  const deadlineElapsed = performance.now() - deadlineStarted;
  if (!deadline || deadlineElapsed < ECF1_DEADLINE_MS - 250) throw new Error('INTERNAL_ERROR');
  phase = 'busy-cancellation';
  const stalled = client.request('stall');
  let busy = false;
  try { await client.request('smoke'); } catch (error) { busy = error.message === 'BUSY'; }
  if (!busy) throw new Error('INTERNAL_ERROR');
  client.lock();
  let cancelled = false;
  try { await stalled; } catch (error) { cancelled = error.message === 'CANCELLED'; }
  if (!cancelled) throw new Error('INTERNAL_ERROR');
  phase = 'adversarial-smoke';
  const checks = await client.request('smoke');
  output.textContent = `PASS · worker, busy, cancellation, deadline, redacted errors, ${checks.join(', ')} · fixed deadline ${ECF1_DEADLINE_MS / 1000}s`;
  output.dataset.status = 'pass';
} catch (error) {
  output.textContent = `FAIL · ${phase} · ${error.message}`;
  output.dataset.status = 'fail';
} finally { client.dispose(); }
