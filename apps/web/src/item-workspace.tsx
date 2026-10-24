import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PanelsTopLeft, ExternalLink } from "lucide-react";
import { Button, IconButton, ItemTabs, PasskeyDetails, AuthenticatorCode, TOTP_ID } from "@127vaults/ui";
import { visibleFields, type ItemField } from "@127vaults/domain/item-types";

type Item = { itemId: string; vaultId: string; index: { title: string; website?: string }; body: { username?: string; password?: string; customFields: ItemField[] } };
type Tab = Pick<Item, "itemId" | "vaultId" | "index">;
type Popout = { key: string; window: Window; item: Item };
const keyOf = (item: Tab) => `${item.vaultId}:${item.itemId}`;
const actions = () => (window as any).__vaultsActions;
const toast = (title: string) => window.dispatchEvent(new CustomEvent("vaults:toast", { detail: { title, detail: "", kind: "error" } }));

function WindowDetail({ item }: { item: Item }) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const copy = async (value: string) => {
    try { await actions().copyField(value); setNotice("Copied"); } catch { setNotice("Could not copy this field."); }
  };
  const fields = [{ id: "website", label: "Website", type: "text", value: item.index.website || "" }, { id: "username", label: "Username", type: "text", value: item.body.username || "" }, { id: "password", label: "Password", type: "password", value: item.body.password || "" }, ...visibleFields(item.body.customFields)];
  return <main className="ui-item-window popout-detail min-h-screen bg-[#11162b] p-6 text-slate-100"><p className="mb-2 text-xs text-slate-400">127Vaults · Item window</p><h1 className="mb-6 text-2xl font-bold">{item.index.title || "Untitled"}</h1><p role="status" className="mb-4 text-sm text-slate-400">{notice}</p>
    {fields.map(field => <section key={field.id} className="mb-4 rounded-xl border border-white/10 p-4"><h2 className="mb-2 text-xs text-slate-400">{field.label}</h2><p className="mb-3 break-all whitespace-pre-wrap">{field.type === "password" && !revealed.has(field.id) ? "••••••••" : field.value || "—"}</p><div className="flex gap-2"><Button variant="secondary" onClick={() => void copy(field.value)}>Copy</Button>{field.type === "password" && <Button variant="ghost" onClick={() => setRevealed(current => { const next = new Set(current); next.has(field.id) ? next.delete(field.id) : next.add(field.id); return next; })}>{revealed.has(field.id) ? "Hide" : "Reveal"}</Button>}</div></section>)}
    <PasskeyDetails fields={item.body.customFields} />{item.body.customFields.find(field => field.id === TOTP_ID)?.value && <AuthenticatorCode value={item.body.customFields.find(field => field.id === TOTP_ID)!.value} copy={copy} />}
    <p className="mt-5 text-xs text-slate-400">Edit this item in the main window.</p>
  </main>;
}

export function ItemWorkspace() {
  const [actionHost, setActionHost] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [popouts, setPopouts] = useState<Popout[]>([]);
  const windows = useRef<Popout[]>([]);
  useEffect(() => { windows.current = popouts; }, [popouts]);
  useEffect(() => {
    setActionHost(document.getElementById("item-workspace-actions"));
    const update = (event: Event) => {
      const item = (event as CustomEvent<Item | null>).detail;
      setSelected(item);
      if (item) {
        setTabs(current => current.map(tab => keyOf(tab) === keyOf(item) ? { itemId: item.itemId, vaultId: item.vaultId, index: item.index } : tab));
        setPopouts(current => current.map(popout => popout.key === keyOf(item) ? { ...popout, item } : popout));
      }
    };
    const closeWindows = () => { for (const popout of windows.current) { popout.window.close(); } windows.current = []; };
    const locked = () => { closeWindows(); setPopouts([]); setSelected(null); setTabs([]); };
    const deleted = (event: Event) => {
      const key = keyOf((event as CustomEvent<Tab>).detail);
      setTabs(current => current.filter(tab => keyOf(tab) !== key));
      for (const popout of windows.current) if (popout.key === key) popout.window.close();
      windows.current = windows.current.filter(popout => popout.key !== key);
      setPopouts(current => current.filter(popout => popout.key !== key));
      setSelected(current => current && keyOf(current) === key ? null : current);
    };
    window.addEventListener("vaults:detail-item", update);
    window.addEventListener("vaults:locked", locked);
    window.addEventListener("vaults:item-deleted", deleted);
    window.addEventListener("beforeunload", closeWindows);
    const timer = setInterval(() => setPopouts(current => current.filter(popout => !popout.window.closed)), 1000);
    return () => { clearInterval(timer); closeWindows(); window.removeEventListener("vaults:detail-item", update); window.removeEventListener("vaults:locked", locked); window.removeEventListener("vaults:item-deleted", deleted); window.removeEventListener("beforeunload", closeWindows); };
  }, []);
  const open = async (tab: Tab) => { try { await actions().openWorkspaceItem(tab); } catch { toast("Item could not be opened. Try syncing and select it again."); } };
  const popOut = () => {
    if (!selected) return;
    const key = keyOf(selected), existing = windows.current.find(popout => popout.key === key && !popout.window.closed);
    if (existing) { existing.window.focus(); return; }
    const child = window.open("", "", "popup,width=620,height=760");
    if (!child) { toast("Allow popups for this vault to open an item window."); return; }
    child.document.title = "127Vaults · Item details";
    document.querySelectorAll('link[rel="stylesheet"], style').forEach(node => child.document.head.appendChild(node.cloneNode(true)));
    child.document.body.style.margin = "0";
    const touch = () => window.dispatchEvent(new Event("vaults:workspace-activity"));
    child.addEventListener("pointerdown", touch); child.addEventListener("keydown", touch);
    const popout = { key, window: child, item: selected };
    windows.current = [...windows.current.filter(row => !row.window.closed), popout];
    setPopouts(windows.current);
  };
  return <>
    {tabs.length > 0 && <ItemTabs tabs={tabs.map(tab => ({...tab, title: tab.index.title}))} activeKey={selected ? keyOf(selected) : null} onSelect={tab => void open(tab)} onClose={tab => {
      const active = selected && keyOf(tab) === keyOf(selected);
      if (active && !actions().closeWorkspaceItem()) return;
      const remaining = tabs.filter(row => keyOf(row) !== keyOf(tab));
      setTabs(remaining);
      if (active && remaining.length) void open(remaining[Math.min(tabs.findIndex(row => keyOf(row) === keyOf(tab)), remaining.length - 1)]);
    }} />}
    {selected && actionHost && createPortal(<><IconButton label="Keep in tab" onClick={() => { const tab = { itemId: selected.itemId, vaultId: selected.vaultId, index: selected.index }; setTabs(current => current.some(row => keyOf(row) === keyOf(tab)) ? current : [...current, tab]); }}><PanelsTopLeft size={17} aria-hidden="true" /></IconButton><IconButton label="Open in window" onClick={popOut}><ExternalLink size={17} aria-hidden="true" /></IconButton></>, actionHost)}
    {popouts.filter(popout => !popout.window.closed).map(popout => createPortal(<WindowDetail key={popout.key} item={popout.item} />, popout.window.document.body, popout.key))}
  </>;
}
