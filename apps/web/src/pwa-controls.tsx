import { useEffect, useState } from 'react';
import { Button } from '@127vaults/ui';

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
const installed = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
let installPrompt: InstallEvent | null = null;
let offlineReady = false, shellReady = false;

export function PwaLifecycle() {
  useEffect(() => {
    const beforeInstall = (event: Event) => { event.preventDefault(); installPrompt = event as InstallEvent; window.dispatchEvent(new Event('vaults:install-state')); };
    const onInstalled = () => { installPrompt = null; window.dispatchEvent(new Event('vaults:install-state')); };
    const replicaStatus = (event: Event) => { offlineReady = !!(event as CustomEvent<{ ready: boolean }>).detail.ready; window.dispatchEvent(new Event('vaults:install-state')); };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('vaults:pwa-status', replicaStatus);
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      const notify = () => { if (installed()) navigator.serviceWorker.controller?.postMessage({ type: '127vaults-installed' }); };
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(async registration => {
        await navigator.serviceWorker.ready;
        shellReady = true; notify(); window.dispatchEvent(new Event('vaults:install-state'));
        // Let waiting releases activate after all old windows close; never
        // reload a running editor or abandon a queued encrypted write.
        if (registration.waiting) window.dispatchEvent(new CustomEvent('vaults:toast', { detail: { title: 'Update ready', detail: 'Close all 127Vaults windows and reopen to use the update.', kind: 'info' } }));
      }).catch(() => window.dispatchEvent(new CustomEvent('vaults:toast', { detail: { title: 'Offline app is not ready', detail: 'Connect and reopen the app to download its files.', kind: 'error' } })));
      navigator.serviceWorker.addEventListener('controllerchange', notify);
      return () => {
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
  useEffect(() => {
    const update = () => refresh(value => value + 1);
    window.addEventListener('vaults:install-state', update);
    navigator.storage?.persisted?.().then(setPersistent).catch(() => {});
    return () => window.removeEventListener('vaults:install-state', update);
  }, []);
  const requestStorage = async () => {
    const result = await navigator.storage?.persist?.(); setPersistent(result ?? false);
  };
  if (installed()) return compact ? null : <div className="mt-6 rounded-xl border border-white/10 p-4 text-sm">
    <h3 className="font-semibold">Installed app</h3>
    <p className="mt-2 text-slate-400" role="status">{offlineReady && shellReady ? 'Ready for offline use. Unlock with your master password; saved changes sync when connected.' : 'Connect and unlock, then Sync to prepare a complete offline copy.'}</p>
    <p className="mt-2 text-xs text-slate-500">Sync runs while the app is open. Removing the app or clearing its website data removes this device’s local copy.</p>
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
