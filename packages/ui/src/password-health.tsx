import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button';
import { analyzePasswords, type HealthItem, type HealthFinding } from './product-features.mjs';

export function PasswordHealth({ load, open, close, scope }: { load: () => Promise<HealthItem[]>; open: (finding: HealthFinding) => void; close: () => void; scope: string }) {
  const [findings, setFindings] = useState<HealthFinding[]>([]);
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', trapFocus);
    return () => { window.removeEventListener('keydown', trapFocus); previous?.focus(); };
  }, []);
  useEffect(() => {
    let disposed = false;
    void load().then(items => { const next = analyzePasswords(items); if (!disposed) { setFindings(next); setState('done'); } }).catch(() => { if (!disposed) setState('error'); });
    return () => { disposed = true; };
  }, [load]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [close]);
  return createPortal(<div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4" onClick={e => { if (e.target === e.currentTarget) close(); }}><section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="password-health-title" className="max-h-[85dvh] w-full max-w-xl overflow-auto rounded-2xl border border-white/15 bg-[#11162b] p-6"><div className="flex items-center justify-between gap-3"><h2 id="password-health-title" className="text-xl font-bold">Password health</h2><Button autoFocus variant="ghost" onClick={close}>Close</Button></div><p className="mt-2 text-sm text-slate-400">{scope}. Checks run locally while unlocked.</p><p className="mt-2 text-xs text-slate-500">Checks short passwords, common patterns and reuse. This is not a breach check or a guarantee of strength.</p><div className="mt-5 grid gap-3" role="status">{state === 'loading' ? <p>Checking passwords…</p> : state === 'error' ? <p>Could not finish the check. Close and retry after syncing.</p> : !findings.length ? <p>No issues found by these checks.</p> : findings.map((finding, index) => <button key={index} type="button" className="rounded-xl border border-white/10 p-4 text-left hover:bg-white/5" onClick={() => open(finding)}><strong className="block">{finding.title}</strong><span className="mt-1 block text-xs text-slate-400">{finding.label} · {finding.issues.join(' · ')}</span></button>)}</div></section></div>, document.body);
}
