import { useEffect, useState } from 'react';
import { Button } from './button';
import { Input } from './input';
import { parseTotp, totp } from './product-features.mjs';

export function AuthenticatorEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  let error = '';
  if (value.trim()) try { parseTotp(value); } catch (e) { error = (e as Error).message; }
  return <section className="mt-7 grid gap-3"><h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Authenticator</h3><label className="grid gap-2 text-sm text-slate-400">Setup secret or otpauth URI<Input type="password" autoComplete="off" value={value} onChange={e => onChange(e.target.value)} placeholder="Paste the service’s setup key" aria-invalid={!!error} /></label><p className="text-xs text-slate-500">Optional. The setup secret is encrypted with this item. Leave blank to remove it.</p>{error && <p role="alert" className="text-xs text-red-300">{error}</p>}</section>;
}

export function AuthenticatorCode({ value, copy }: { value: string; copy: (value: string) => Promise<unknown> }) {
  const [result, setResult] = useState<{ code: string; remaining: number; period: number } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setResult(null); setError('');
    const update = () => { void totp(value).then(next => { if (!disposed) { setResult(next); setError(''); } }).catch(e => { if (!disposed) { setResult(null); setError((e as Error).message); } }); };
    update(); const timer = setInterval(update, 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [value]);
  return <section className="mt-7 rounded-xl border border-white/10 p-4"><h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Authenticator code</h3>{error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : <div className="mt-3 flex flex-wrap items-center gap-4"><strong className="font-mono text-2xl tracking-widest">{result?.code || '••••••'}</strong><span className="text-xs text-slate-400">{result ? `${result.remaining}s remaining` : 'Generating…'}</span><Button variant="secondary" disabled={!result} onClick={() => { void totp(value).then(next => copy(next.code)).catch(e => setError((e as Error).message)); }}>Copy code</Button></div>}{result && <div role="progressbar" className="mt-3 h-1 overflow-hidden rounded-full bg-white/10" aria-valuenow={result.remaining} aria-valuemin={0} aria-valuemax={result.period} aria-label="Code time remaining"><div className="h-full bg-[#E0BB95]/70" style={{ width: `${result.remaining / result.period * 100}%` }} /></div>}</section>;
}
