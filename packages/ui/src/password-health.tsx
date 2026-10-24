import { useEffect, useRef, useState } from 'react';
import { Button } from './button';
import { analyzePasswords, breachedPasswords, changePasswordUrl, type HealthFinding, type HealthItem } from './product-features.mjs';

const categories = ['All issues', 'Short', 'Predictable', 'Reused', 'Breached'] as const;
const matches = (finding: HealthFinding, category: string) => category === 'All issues' || finding.issues.some(issue => issue.startsWith(({ Short: 'Short', Predictable: 'Common', Reused: 'Reused', Breached: 'Found' } as Record<string, string>)[category]));
export function PasswordHealth({ load, open, close, scope, visit = url => window.open(url, '_blank', 'noopener,noreferrer') }: { load: () => Promise<HealthItem[]>; open: (finding: HealthFinding) => void; close: () => void; scope: string; visit?: (url: string) => void }) {
  const [findings, setFindings] = useState<HealthFinding[]>([]);
  const [state, setState] = useState('loading');
  const [breach, setBreach] = useState('unchecked');
  const [category, setCategory] = useState<string>('All issues');
  const [revision, setRevision] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    setState('loading'); setBreach('unchecked'); setFindings([]);
    void load().then(items => { if (!abort.signal.aborted) { setFindings(analyzePasswords(items)); setState('done'); } }).catch(() => { if (!abort.signal.aborted) setState('error'); });
    return () => abort.abort();
  }, [load, revision]);
  async function checkBreaches() {
    const abort = controller.current;
    if (!abort || abort.signal.aborted) return;
    setBreach('checking');
    try {
      const items = await load();
      abort.signal.throwIfAborted();
      const breached = await breachedPasswords(items, { signal: abort.signal });
      if (!abort.signal.aborted) { setFindings(analyzePasswords(items, breached)); setBreach('done'); }
    } catch { if (!abort.signal.aborted) setBreach('error'); }
  }
  return <section aria-labelledby="password-health-title" className="password-health min-w-0">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3"><strong>Password health</strong><div className="flex gap-2"><Button variant="ghost" disabled={state === 'loading' || breach === 'checking'} onClick={() => setRevision(value => value + 1)}>Refresh</Button><Button variant="ghost" onClick={close}>Close</Button></div></div>
    <h2 id="password-health-title" className="text-2xl font-bold">Make every password stronger</h2>
    <p className="mt-2 text-sm text-slate-400">{scope}. Short, predictable and reused passwords are checked locally while unlocked.</p>
    <div className="my-5 rounded-xl border border-white/10 p-4"><p className="mb-3 text-sm text-slate-400">Optional breach check with Have I Been Pwned. Only the first five characters of each password’s SHA-1 hash are sent; passwords and full hashes stay on this device.</p><Button variant="secondary" disabled={state !== 'done' || breach === 'checking'} onClick={() => void checkBreaches()}>{breach === 'checking' ? 'Checking breaches…' : 'Check for breached passwords'}</Button><p role="status" className="mt-2 text-xs text-slate-400">{breach === 'done' ? 'Breach check complete. A match means this password appeared in known breaches, not necessarily that this account was breached.' : breach === 'error' ? 'Breach check unavailable. Local findings remain available; try again.' : 'unchecked' === breach ? 'Breached passwords have not been checked.' : 'Checking saved passwords…'}</p></div>
    <div role="group" aria-label="Issue categories" className="mb-5 flex flex-wrap gap-2">{categories.map(value => <Button key={value} variant={category === value ? 'secondary' : 'ghost'} aria-pressed={category === value} onClick={() => setCategory(value)}>{value} ({findings.filter(finding => matches(finding, value)).length})</Button>)}</div>
    {state === 'loading' ? <p role="status">Checking passwords…</p> : state === 'error' ? <p role="alert">Could not finish the check. Refresh after syncing.</p> : <><p role="status" className="mb-3 text-sm text-slate-400">{findings.filter(finding => matches(finding, category)).length} affected password fields. These checks are not a guarantee of strength.</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-white/15 text-slate-400"><tr><th className="p-3">Item</th><th className="p-3">Issues</th><th className="p-3">Suggested action</th></tr></thead><tbody>{findings.filter(finding => matches(finding, category)).map((finding, index) => <tr key={`${finding.vaultId}:${finding.itemId}:${index}`} className="border-b border-white/10 align-top"><td className="p-3"><Button variant="ghost" onClick={() => open(finding)}>{finding.title}</Button><p className="mt-1 text-xs text-slate-400">{finding.label}</p></td><td className="p-3"><ul>{finding.issues.map(issue => <li key={issue} className="mb-2">{issue}</li>)}</ul></td><td className="p-3"><p className="mb-3 text-slate-400">{finding.issues.some(issue => issue.startsWith('Found')) ? 'Change this password now, and anywhere else you used it.' : finding.issues.some(issue => issue.startsWith('Reused')) ? 'Use a different generated password for every account.' : 'Use a long, unique generated password or random passphrase of at least 16 characters.'}</p><div className="flex flex-wrap gap-2">{changePasswordUrl(finding.website) && <Button size="sm" variant="secondary" onClick={() => visit(changePasswordUrl(finding.website)!)}>Change on website ↗</Button>}<Button size="sm" variant="ghost" onClick={() => open(finding)}>Open saved item</Button></div></td></tr>)}</tbody></table></div>{!findings.filter(finding => matches(finding, category)).length && <p className="p-6 text-slate-400">No issues found in this category.</p>}<p className="mt-5 text-xs text-slate-500">Website links use /.well-known/change-password. If the site does not support it, open its account security settings. After changing the password there, update the saved item here.</p></>}
  </section>;
}
