import { useEffect, useState } from 'react';
import { Button } from '@127vaults/ui';
import { watchPwaUpdate } from './pwa-update';

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
const installed = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
let installPrompt: InstallEvent | null = null;
let offlineReady = false, shellReady = false;
let updateReady = false;
type SyncState = { unlocked: boolean; pending: number; offline: boolean; syncing: boolean; error: string; at: number | null };
function checkShell(worker: ServiceWorker | null) {
  return new Promise<boolean>(resolve => {
    if (!worker) { resolve(false); return; }
    const channel = new MessageChannel();
    const finish = (ready: boolean) => { clearTimeout(timeout); channel.port1.close(); resolve(ready); };
    const timeout = window.setTimeout(() => finish(false), 15000);
    channel.port1.onmessage = event => finish(event.data?.ready === true);
    worker.postMessage({ type: '127vaults-check-shell' }, [channel.port2]);
  });
}

export function PwaLifecycle() {
  useEffect(() => {
    const beforeInstall = (event: Event) => { event.preventDefault(); installPrompt = event as InstallEvent; window.dispatchEvent(new Event('vaults:install-state')); };
    const onInstalled = () => { installPrompt = null; window.dispatchEvent(new Event('vaults:install-state')); };
    const replicaStatus = (event: Event) => { offlineReady = !!(event as CustomEvent<{ ready: boolean }>).detail.ready; window.dispatchEvent(new Event('vaults:install-state')); };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('vaults:pwa-status', replicaStatus);
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      let disposed = false;
      let stopUpdates: (() => void) | undefined;
      const notify = () => { if (installed()) navigator.serviceWorker.controller?.postMessage({ type: '127vaults-installed' }); };
      const scope = /^\/t\/[a-z0-9-]+\/$/.test(location.pathname) ? location.pathname : '/';
      navigator.serviceWorker.register(`${scope}sw.js`, { scope, updateViaCache: 'none' }).then(async registration => {
        if (disposed) return;
        stopUpdates = watchPwaUpdate(registration, () => {
          updateReady = true;
          window.dispatchEvent(new Event('vaults:install-state'));
          window.dispatchEvent(new CustomEvent('vaults:toast', { detail: { title: 'Update ready', detail: 'Save your work, close all 127Vaults windows and reopen to use the update. Encrypted queued changes remain on this device.', kind: 'info' } }));
        });
        const active = await navigator.serviceWorker.ready;
        const ready = await checkShell(active.active);
        if (disposed) return;
        shellReady = ready; notify(); window.dispatchEvent(new Event('vaults:install-state'));
      }).catch(() => window.dispatchEvent(new CustomEvent('vaults:toast', { detail: { title: 'Offline app is not ready', detail: 'Connect and reopen the app to download its files.', kind: 'error' } })));
      navigator.serviceWorker.addEventListener('controllerchange', notify);
      return () => {
        disposed = true; stopUpdates?.();
        window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', onInstalled); window.removeEventListener('vaults:pwa-status', replicaStatus);
        navigator.serviceWorker.removeEventListener('controllerchange', notify);
      };
    }
    return () => { window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', onInstalled); window.removeEventListener('vaults:pwa-status', replicaStatus); };
  }, []);
  return null;
}

export function PwaControls({ compact = false }: { compact?: boolean }) {
  const [, refresh] = useState(0);
  const [instructions, setInstructions] = useState(false);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [sync, setSync] = useState<SyncState>(() => (window as any).__vaultsSyncState || { unlocked: false, pending: 0, offline: false, syncing: false, error: '', at: null });
  useEffect(() => {
    const update = () => refresh(value => value + 1);
    const syncUpdate = (event: Event) => setSync((event as CustomEvent<SyncState>).detail);
    window.addEventListener('vaults:install-state', update);
    window.addEventListener('vaults:sync-state', syncUpdate);
    navigator.storage?.persisted?.().then(setPersistent).catch(() => {});
    return () => { window.removeEventListener('vaults:install-state', update); window.removeEventListener('vaults:sync-state', syncUpdate); };
  }, []);
  const requestStorage = async () => {
    try { const result = await navigator.storage?.persist?.(); setPersistent(result ?? false); }
    catch { setPersistent(false); }
  };
  if (installed()) return compact ? null : <div className="mt-6 rounded-xl border border-white/10 p-4 text-sm">
    <h3 className="font-semibold">Installed app</h3>
    {updateReady && <p className="mt-2 text-sky-300" role="status">Update ready. Save your work, close all 127Vaults windows and reopen. Encrypted queued changes remain on this device.</p>}
    <p className="mt-2 text-slate-400" role="status">{offlineReady && shellReady ? 'Ready for offline use. Unlock with your master password; saved changes sync when connected.' : 'Connect and unlock, then Sync to prepare a complete offline copy.'}</p>
    <p className="mt-2 text-xs text-slate-500">Sync runs while the app is open. Removing the app or clearing its website data removes this device’s local copy.</p>
    {sync.unlocked && <div className="mt-3 border-t border-white/10 pt-3"><p className="text-xs text-slate-400">{sync.pending ? `${sync.pending} encrypted change${sync.pending === 1 ? '' : 's'} awaiting sync.` : sync.offline ? 'Working from this device’s encrypted copy.' : 'No pending local changes.'}{sync.at && ` Last complete copy: ${new Date(sync.at).toLocaleString()}.`}</p>{sync.error && <p className="mt-2 text-xs text-red-300" role="alert">{sync.error}</p>}<Button variant="secondary" className="mt-3" disabled={sync.syncing} onClick={() => void (window as any).__vaultsActions.runAction('reload')}>{sync.syncing ? 'Syncing…' : sync.error ? 'Review and retry sync' : 'Sync now'}</Button></div>}
    {persistent === true ? <p className="mt-3 text-xs text-slate-400">Persistent device storage enabled.</p> : <><Button variant="secondary" className="mt-3" onClick={requestStorage}>Keep data on this device</Button>{persistent === false && <p className="mt-2 text-xs text-slate-400">Storage persistence depends on your browser. Keep a recovery copy of your account secret.</p>}</>}
  </div>;
  return <div className={compact ? 'mt-4 text-center text-xs text-slate-400' : 'mt-6 rounded-xl border border-white/10 p-4 text-sm text-slate-400'}>
    <Button variant="ghost" onClick={async () => {
      if (installPrompt) { const prompt = installPrompt; await prompt.prompt(); await prompt.userChoice; installPrompt = null; refresh(value => value + 1); }
      else setInstructions(value => !value);
    }}>Install 127Vaults</Button>
    {instructions && <p className="mt-2 leading-6">On iPhone or iPad, open in Safari, tap Share, then Add to Home Screen. On Android, choose Install app or Add to Home screen in your browser menu. Open the installed app while connected and register it once; future unlocks need only your master password.</p>}
    {!compact && <p className="mt-2 text-xs">Browser tabs require a server connection. Install the app for offline access.</p>}
  </div>;
}
