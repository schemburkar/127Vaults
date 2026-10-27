import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@127vaults/ui";
import { X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ReadonlyItem } from "./readonly-item";


type Field = { id: string; label: string; type: string; value: string };
type Detail = { title: string; website: string; username: string; password: string; customFields: Field[] };

export function DetachedItem() {
  const params = new URLSearchParams(location.search);
  const vaultId = params.get("vault"), itemId = params.get("detail");
  const active = useRef(true);
  const snapshot = useRef("");
  const [item, setItem] = useState<Detail | null>(null);
  const [message, setMessage] = useState("Loading item…");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  useEffect(() => {
    let last = 0;
    const activity = (event: Event) => {
      if (!event.isTrusted || !active.current || Date.now() - last < 60000) return;
      last = Date.now();
      void invoke("session_activity").catch(() => {});
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    return () => { window.removeEventListener("pointerdown", activity); window.removeEventListener("keydown", activity); };
  }, []);
  useEffect(() => {
    let disposed = false;
    active.current = true;
    const clear = () => { disposed = true; active.current = false; setItem(null); setRevealed({}); setMessage("Vault locked. Reopen this item from the main window after unlocking."); };
    const refresh = async () => {
      try {
        const result = await invoke<Detail>("item_get", { vaultId, itemId });
        if (!disposed) { const next = JSON.stringify(result); if (snapshot.current !== next) { setRevealed({}); snapshot.current = next; setMessage(""); } setItem(result); }
      } catch { if (!disposed) { disposed = true; active.current = false; setItem(null); setRevealed({}); setMessage("This item is unavailable. Reopen it from the main window."); } }
    };
    const subscription = listen("vaults-locked", clear);
    const deletion = listen<{ vaultId: string; itemId: string }>("vaults-item-deleted", event => {
      if (event.payload.vaultId === vaultId && event.payload.itemId === itemId) clear();
    });
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => { disposed = true; active.current = false; clearInterval(timer); void subscription.then(unlisten => unlisten()); void deletion.then(unlisten => unlisten()); };
  }, [vaultId, itemId]);
  const secret = (field: string) => invoke<string>("item_secret", { vaultId, itemId, field });
  const copy = async (field: string, value: string, hidden: boolean) => {
    try { const text = hidden ? await secret(field) : value; if (!active.current) return; await invoke("clipboard_copy", { value: text }); setMessage("Copied · clipboard clears in 30 seconds"); }
    catch { setMessage("Could not copy this field."); }
  };
  const toggleReveal = async (field: string) => {
    if (revealed[field] !== undefined) { setRevealed(current => { const next = { ...current }; delete next[field]; return next; }); return; }
    try { const before = snapshot.current; const value = await secret(field); if (active.current && snapshot.current === before) setRevealed(current => ({ ...current, [field]: value })); }
    catch { setMessage("This secret is unavailable."); }
  };
  const display = item && { ...item, password: revealed.password ?? "", customFields: item.customFields.map(field => ({ ...field, value: revealed[field.id] ?? field.value })) };
  return <main className="ui-item-window desktop-detail min-h-screen p-6">
    {message && <p className="mb-4 text-sm text-slate-400" role="status">{message}</p>}
    {display ? <ReadonlyItem item={display} revealed={new Set(Object.keys(revealed))} toggleReveal={field => void toggleReveal(field)}
      requireRevealForDrag copyValue={value => copy("", value, false)} copyField={copy} openWebsite={url => void openUrl(url)}
      dragValue={(event, _label, value) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("text/plain", value); }} endDrag={() => {}}
      actions={<Button variant="ghost" onClick={() => void getCurrentWindow().close().catch(() => setMessage("Could not close this window."))}><X size={17} aria-hidden="true" /> Close</Button>} />
      : <Button variant="ghost" onClick={() => void getCurrentWindow().close().catch(() => setMessage("Could not close this window."))}>Close</Button>}
  </main>;
}
