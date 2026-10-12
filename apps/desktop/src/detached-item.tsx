import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, PasskeyDetails, AuthenticatorCode, TOTP_ID } from "@127vaults/ui";
import { visibleFields } from "./item-types";

type Field = { id: string; label: string; type: string; value: string };
type Detail = { title: string; website: string; username: string; customFields: Field[] };

export function DetachedItem() {
  const params = new URLSearchParams(location.search);
  const vaultId = params.get("vault"), itemId = params.get("detail");
  const active = useRef(true);
  const [item, setItem] = useState<Detail | null>(null);
  const [message, setMessage] = useState("Loading item…");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  useEffect(() => {
    let disposed = false;
    active.current = true;
    const clear = () => { disposed = true; active.current = false; setItem(null); setRevealed({}); setMessage("Vault locked. Reopen this item from the main window after unlocking."); };
    const refresh = async () => {
      try {
        const result = await invoke<Detail>("item_get", { vaultId, itemId });
        if (!disposed) { setItem(result); setMessage(""); }
      } catch { if (!disposed) { disposed = true; active.current = false; setItem(null); setRevealed({}); setMessage("This item is unavailable. Reopen it from the main window."); } }
    };
    const subscription = listen("vaults-locked", clear);
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => { disposed = true; active.current = false; clearInterval(timer); void subscription.then(unlisten => unlisten()); };
  }, [vaultId, itemId]);
  const secret = (field: string) => invoke<string>("item_secret", { vaultId, itemId, field });
  const copy = async (field: string, value: string, hidden: boolean) => {
    try { await navigator.clipboard.writeText(hidden ? await secret(field) : value); setMessage("Copied · clipboard clears in 30 seconds"); setTimeout(() => void navigator.clipboard.writeText("").catch(() => {}), 30000); }
    catch { setMessage("Could not copy this field."); }
  };
  return <main className="ui-item-window desktop-detail min-h-screen p-6">
    <div className="mb-6 flex justify-between gap-3"><strong>Item window</strong><Button variant="ghost" onClick={() => void getCurrentWindow().close()}>Close</Button></div>
    <p className="mb-4 text-sm text-slate-400" role="status">{message}</p>
    {item && <><h1 className="mb-6 text-2xl font-bold">{item.title || "Untitled"}</h1>
      {[{ id: "website", label: "Website", type: "text", value: item.website }, { id: "username", label: "Username", type: "text", value: item.username }, { id: "password", label: "Password", type: "password", value: "" }, ...visibleFields(item.customFields)].map(field => <section key={field.id} className="mb-4 rounded-xl border border-white/10 p-4">
        <h2 className="mb-2 text-xs text-slate-400">{field.label}</h2>
        <p className="mb-3 break-all whitespace-pre-wrap">{field.type === "password" ? revealed[field.id] ?? "••••••••" : field.value}</p>
        <div className="flex gap-2"><Button variant="secondary" onClick={() => void copy(field.id, field.value, field.type === "password")}>Copy</Button>
          {field.type === "password" && <Button variant="ghost" onClick={async () => { if (revealed[field.id] !== undefined) { setRevealed(current => { const next = { ...current }; delete next[field.id]; return next; }); } else { try { const value = await secret(field.id); if (active.current) setRevealed(current => ({ ...current, [field.id]: value })); } catch { setMessage("This secret is unavailable."); } } }}>{revealed[field.id] !== undefined ? "Hide" : "Reveal"}</Button>}</div>
      </section>)}
      <PasskeyDetails fields={item.customFields} />
      {item.customFields.find(field => field.id === TOTP_ID)?.value && <AuthenticatorCode copy={value => navigator.clipboard.writeText(value)} value={item.customFields.find(field => field.id === TOTP_ID)!.value} />}
    </>}
  </main>;
}
