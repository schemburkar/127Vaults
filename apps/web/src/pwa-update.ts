// A waiting release must not replace the worker beneath an open editor.
// Notify both existing and subsequently downloaded updates, and let the browser
// activate normally once all windows using the previous release are closed.
export function watchPwaUpdate(registration: ServiceWorkerRegistration, notify: () => void) {
  let disposed = false;
  let announced: ServiceWorker | null = null;
  const workers = new Set<ServiceWorker>();
  const check = () => {
    const waiting = registration.waiting;
    if (!disposed && waiting && waiting !== announced) {
      announced = waiting;
      notify();
    }
  };
  const track = () => {
    const worker = registration.installing;
    if (worker && !workers.has(worker)) {
      workers.add(worker);
      worker.addEventListener('statechange', check);
    }
    check();
  };
  registration.addEventListener('updatefound', track);
  track();
  return () => {
    disposed = true;
    registration.removeEventListener('updatefound', track);
    for (const worker of workers) worker.removeEventListener('statechange', check);
  };
}
