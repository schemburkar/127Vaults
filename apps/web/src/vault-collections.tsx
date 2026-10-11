import { useEffect, useState } from 'react';
import { Button, Input } from '@127vaults/ui';

type Vault = { vaultId: string; name: string };
type Collection = { id: string; name: string; vault_ids: string[] };
type View = { kind: 'all' | 'vault' | 'collection'; id?: string } | null;
type State = { settings: { collections: Collection[]; default_view: View }; view: View };
const empty: State = { settings: { collections: [], default_view: null }, view: null };
const actions = () => (window as any).__vaultsActions;
const run = (action: () => unknown) => Promise.resolve().then(action).catch(() => window.dispatchEvent(new CustomEvent('vaults:toast', { detail: { title: 'Vault action could not complete', detail: 'Unlock the vault and retry.', kind: 'error' } })));
export function useVaultSettings() {
  const [state, setState] = useState<State>(() => (window as any).__vaultsSettings || empty);
  useEffect(() => {
    const update = (event: Event) => setState((event as CustomEvent<State>).detail);
    window.addEventListener('vaults:settings', update);
    return () => window.removeEventListener('vaults:settings', update);
  }, []);
  return state;
}
export function CollectionLinks({ className }: { className: string }) {
  const { settings, view } = useVaultSettings();
  if (!settings.collections.length) return null;
  return <div className="mt-4 grid gap-1"><p className="px-3 text-[10px] font-bold tracking-[.16em] text-slate-500">COLLECTIONS</p>{settings.collections.map(row => <Button key={row.id} variant="ghost" className={`${className} ${view?.kind === 'collection' && view.id === row.id ? 'active !bg-[#E0BB95]/12 !text-[#E0BB95]' : ''}`} onClick={() => void run(() => actions().selectBrowseView({ kind: 'collection', id: row.id }))}><span className="truncate">{row.name}</span></Button>)}</div>;
}
export function CollectionsSettings({ vaults }: { vaults: Vault[] }) {
  const { settings } = useVaultSettings(), view = settings.default_view;
  const selected = view ? view.kind === 'all' ? 'all' : `${view.kind}:${view.id}` : 'automatic';
  return <div className="mt-7 border-t border-white/10 pt-5">
    <h3 className="font-semibold">Collections</h3><p className="mt-2 text-sm text-slate-400">Group vaults into a view. Your collections and default view sync with the desktop app.</p>
    <div className="mt-3 grid gap-2">{settings.collections.map(row => <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 p-2"><Button variant="ghost" className="min-w-0 flex-1 justify-start" onClick={() => void run(() => actions().selectBrowseView({ kind: 'collection', id: row.id }))}><span className="truncate">{row.name}</span></Button><Button variant="ghost" onClick={() => actions().openCollectionDialog(row.id)}>Edit</Button><Button variant="ghost" onClick={() => void run(() => actions().removeCollection(row.id))}>Remove</Button></div>)}</div>
    <Button variant="secondary" className="mt-3" onClick={() => actions().openCollectionDialog()}>Create collection</Button>
    <label className="mt-5 grid gap-2 text-sm">Open after unlocking<select aria-label="Default vault view" className="rounded-xl border border-white/10 bg-[#11162b] p-3 text-white" value={selected} onChange={event => void run(() => actions().setDefaultView(event.target.value))}><option value="automatic">First available vault</option><option value="all">All items</option>{vaults.map(row => <option key={row.vaultId} value={`vault:${row.vaultId}`}>{row.name}</option>)}{settings.collections.map(row => <option key={row.id} value={`collection:${row.id}`}>Collection: {row.name}</option>)}</select></label>
  </div>;
}
export function CollectionDialog() {
  const [vaults, setVaults] = useState<Vault[]>(() => (window as any).__vaultsSnapshot || []);
  const [draft, setDraft] = useState<{ id: string | null; name: string; vault_ids: string[] }>({ id: null, name: '', vault_ids: [] });
  useEffect(() => {
    const edit = (event: Event) => { setDraft((event as CustomEvent<typeof draft>).detail); const status = document.getElementById('web-collection-status'); if (status) status.textContent = ''; };
    const update = (event: Event) => setVaults((event as CustomEvent<Vault[]>).detail);
    const locked = () => setDraft({ id: null, name: '', vault_ids: [] });
    window.addEventListener('vaults:edit-collection', edit); window.addEventListener('vaults:vaults', update); window.addEventListener('vaults:locked', locked);
    return () => { window.removeEventListener('vaults:edit-collection', edit); window.removeEventListener('vaults:vaults', update); window.removeEventListener('vaults:locked', locked); };
  }, []);
  return <dialog id="web-collection-dialog" className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-auto rounded-2xl border border-white/10 bg-[#11162b] p-6 text-slate-100 shadow-2xl backdrop:bg-slate-950/70"><form id="web-collection-form"><h2 className="text-xl font-bold">{draft.id ? 'Edit collection' : 'Create collection'}</h2><input id="web-collection-id" type="hidden" value={draft.id || ''} readOnly /><label className="mt-5 grid gap-2 text-sm">Collection name<Input id="web-collection-name" maxLength={80} required value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><fieldset id="web-collection-vaults" className="mt-5 grid gap-2"><legend className="mb-2 text-sm font-semibold">Include vaults</legend>{vaults.map(row => <label key={row.vaultId} className="flex min-h-11 items-center gap-3 rounded-xl border border-white/10 p-3 text-sm"><input type="checkbox" value={row.vaultId} checked={draft.vault_ids.includes(row.vaultId)} onChange={event => setDraft({ ...draft, vault_ids: event.target.checked ? [...draft.vault_ids, row.vaultId] : draft.vault_ids.filter(id => id !== row.vaultId) })} />{row.name}</label>)}</fieldset><p id="web-collection-status" role="status" className="mt-3 text-sm text-red-300" /><div className="mt-6 flex justify-end gap-2"><Button id="web-collection-cancel" type="button" variant="secondary">Cancel</Button><Button id="web-collection-save" type="submit">Save collection</Button></div></form></dialog>;
}
type Lifecycle = { retired: { vaultId: string; name: string; retirementChoice?: string }[]; pending: { source: string; choice: 'archive' | 'move' | 'restore'; destination?: string | null } | null };
export function VaultLifecycleSettings({ vaults }: { vaults: Vault[] }) {
  const [state, setState] = useState<Lifecycle>(() => (window as any).__vaultsLifecycle || { retired: [], pending: null });
  const [source, setSource] = useState(''), [destination, setDestination] = useState(''), [choice, setChoice] = useState<'archive' | 'move'>('archive');
  useEffect(() => {
    const update = (event: Event) => setState((event as CustomEvent<Lifecycle>).detail);
    window.addEventListener('vaults:lifecycle', update);return () => window.removeEventListener('vaults:lifecycle', update);
  }, []);
  const sourceId = vaults.some(row => row.vaultId === source) ? source : vaults[0]?.vaultId || '';
  const targets = vaults.filter(row => row.vaultId !== sourceId), destinationId = targets.some(row => row.vaultId === destination) ? destination : targets[0]?.vaultId || '';
  const selectClass = 'rounded-xl border border-white/10 bg-[#11162b] p-3 text-white';
  return <div className="mt-7 border-t border-white/10 pt-5"><h3 className="font-semibold">Archive or move a vault</h3><p className="mt-2 text-sm text-slate-400">Requires a connection. Archive keeps items recoverable. Move copies items into another vault before retiring the source.</p>
    {state.pending ? <div className="mt-4 rounded-xl border border-amber-300/20 p-4"><p className="text-sm">A vault action is pending.</p><div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => void run(() => actions().manageVault(state.pending!.source, state.pending!.choice, state.pending!.destination || null))}>Resume</Button><Button variant="secondary" onClick={() => void run(() => actions().cancelVaultRemoval())}>Cancel pending action</Button></div></div> : <div className="mt-4 grid gap-3 text-sm"><label className="grid gap-2">Source vault<select aria-label="Source vault" className={selectClass} value={sourceId} onChange={event => setSource(event.target.value)}>{vaults.map(row => <option key={row.vaultId} value={row.vaultId}>{row.name}</option>)}</select></label><label className="grid gap-2">Action<select aria-label="Vault removal action" className={selectClass} value={choice} onChange={event => setChoice(event.target.value as typeof choice)}><option value="archive">Archive vault</option><option value="move" disabled={!targets.length}>Move items to another vault</option></select></label>{choice === 'move' && <label className="grid gap-2">Destination<select aria-label="Destination vault" className={selectClass} value={destinationId} onChange={event => setDestination(event.target.value)}>{targets.map(row => <option key={row.vaultId} value={row.vaultId}>{row.name}</option>)}</select></label>}<Button variant="secondary" disabled={!sourceId || choice === 'move' && !destinationId} onClick={() => void run(() => actions().manageVault(sourceId, choice, choice === 'move' ? destinationId : null))}>{choice === 'move' ? 'Move vault items' : 'Archive vault'}</Button></div>}
    {!!state.retired.filter(row => row.retirementChoice === 'archive').length && <div className="mt-6"><h3 className="font-semibold">Archived vaults</h3>{state.retired.filter(row => row.retirementChoice === 'archive').map(row => <div key={row.vaultId} className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-white/10 p-3 text-sm"><span className="min-w-0 truncate">{row.name}</span><Button variant="ghost" onClick={() => void run(() => actions().manageVault(row.vaultId, 'restore'))}>Restore</Button></div>)}</div>}
  </div>;
}
