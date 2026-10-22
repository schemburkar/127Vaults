import { useEffect, useId, useRef, useState } from "react";

const labels: Record<string, string> = { text: "Text", password: "Secret", url: "URL", date: "Date", email: "Email", number: "Number", note: "Note", phone: "Phone", address: "Address" };
const kinds = Object.keys(labels);

export function FieldTypePicker({ value, onChange, options = kinds }: { value: string; onChange: (value: string) => void; options?: string[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const panel = popup.current!;
    const rect = trigger.current!.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 140) - 8)) + "px";
    panel.style.width = Math.max(rect.width, 140) + "px";
    const below = window.innerHeight - rect.bottom;
    panel.style.top = (below >= 280 ? rect.bottom + 6 : Math.max(8, rect.top - Math.min(264, rect.top - 8))) + "px";
    panel.style.maxHeight = Math.max(80, Math.min(256, below >= 280 ? below - 14 : rect.top - 16)) + "px";
    panel.showPopover();
    const closeOnMove = () => { setOpen(false); trigger.current?.focus(); };
    window.addEventListener("resize", closeOnMove);
    const closeOnScroll = (event: Event) => { if (!panel.contains(event.target as Node)) closeOnMove(); };
    window.addEventListener("scroll", closeOnScroll, true);
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", closeOnMove);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);
  return <div ref={root} className="relative min-w-0" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); return; }
    if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const rows = Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]'));
      const current = rows.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      rows[next]?.focus();
    }
  }}>
    <input type="hidden" className="field-type-value" value={value} readOnly />
    <button ref={trigger} type="button" aria-label={`Field type: ${labels[value] || value}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-white/15 bg-[#11162b] px-3 py-2 text-sm text-slate-100 transition hover:border-[#E0BB95]/60 focus-visible:outline-2 focus-visible:outline-[#E0BB95]">
      {labels[value] || value}<span aria-hidden="true" className="text-slate-400">⌄</span>
    </button>
    {open && <div ref={popup} popover="manual" id={id} role="listbox" aria-label="Field type" className="fixed m-0 z-50 grid max-h-64 overflow-auto rounded-xl border border-white/15 bg-[#11162b] p-1 shadow-xl">
      {options.map(kind => <button key={kind} type="button" role="option" aria-selected={kind === value} onClick={() => { onChange(kind); setOpen(false); trigger.current?.focus(); }} className={`flex min-h-10 items-center justify-between gap-4 rounded-lg px-3 text-left text-sm text-slate-100 hover:bg-white/10 focus:bg-white/10 focus:outline-none ${kind === value ? "bg-white/10 text-[#E0BB95]" : ""}`}>
        {labels[kind] || kind}<span aria-hidden="true">{kind === value ? "✓" : ""}</span>
      </button>)}
    </div>}
  </div>;
}
