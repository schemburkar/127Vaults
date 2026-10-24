import { useEffect, useRef, useState } from "react";
function Glyph({path,size=16}:{path:string;size?:number}) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path}/></svg>; }
const ChevronDown=({size=16})=><Glyph size={size} path="m6 9 6 6 6-6"/>;
const ChevronLeft=({size=16})=><Glyph size={size} path="m15 18-6-6 6-6"/>;
const ChevronRight=({size=16})=><Glyph size={size} path="m9 18 6-6-6-6"/>;
const X=({size=16})=><Glyph size={size} path="m6 6 12 12M6 18 18 6"/>;

type Tab = { vaultId?: string; itemId: string; title: string };
export const tabKey = (tab: Pick<Tab, "vaultId" | "itemId">) => `${tab.vaultId}:${tab.itemId}`;

export function ItemTabs<T extends Tab>({ tabs, activeKey, onSelect, onClose }: {
  tabs: T[]; activeKey: string | null; onSelect: (tab: T) => void; onClose: (tab: T) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const node = strip.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setOverflow(node.scrollWidth > node.clientWidth + 1));
    observer.observe(node);
    setOverflow(node.scrollWidth > node.clientWidth + 1);
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || event.deltaX || node.scrollWidth <= node.clientWidth) return;
      if (event.deltaY) {
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientWidth : 1);
        event.preventDefault();
        node.scrollLeft += delta;
      }
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => { observer.disconnect(); node.removeEventListener("wheel", wheel); };
  }, [tabs.length]);
  useEffect(() => {
    const node = strip.current;
    const selected = node?.querySelector<HTMLElement>('[aria-selected="true"]')?.parentElement;
    if (!node || !selected) return;
    const bounds = selected.getBoundingClientRect(), viewport = node.getBoundingClientRect();
    if (bounds.left < viewport.left) node.scrollLeft -= viewport.left - bounds.left;
    else if (bounds.right > viewport.right) node.scrollLeft += bounds.right - viewport.right;
  }, [activeKey, tabs.length]);
  return <div className="item-tabs-bar">
    {overflow && <button className="item-tabs-control" aria-label="Scroll tabs left" onClick={() => strip.current?.scrollBy({ left: -240, behavior: "smooth" })}><ChevronLeft size={16} /></button>}
    <div ref={strip} className="item-tabs" role="tablist" aria-label="Open items">
      {tabs.map((tab, index) => <div key={tabKey(tab)} className="item-tab">
        <button role="tab" title={tab.title || "Untitled"} aria-selected={activeKey === tabKey(tab)} tabIndex={activeKey === tabKey(tab) || (!tabs.some(row => tabKey(row) === activeKey) && index === 0) ? 0 : -1}
          onClick={() => onSelect(tab)} onKeyDown={event => {
            const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault();
            strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus({ preventScroll: true });
            onSelect(tabs[next]);
          }}>{tab.title || "Untitled"}</button>
        <button className="item-tab-close" aria-label={`Close tab ${tab.title}`} onClick={() => onClose(tab)}><X size={14} /></button>
      </div>)}
    </div>
    {overflow && <button className="item-tabs-control" aria-label="Scroll tabs right" onClick={() => strip.current?.scrollBy({ left: 240, behavior: "smooth" })}><ChevronRight size={16} /></button>}
    <details className="item-tabs-menu">
      <summary aria-label={`Open tabs (${tabs.length})`} title={`${tabs.length} open tabs`}><span>{tabs.length}</span><ChevronDown size={14} /></summary>
      <div role="navigation" aria-label="Find an open tab">{tabs.map(tab => <button key={tabKey(tab)} title={tab.title} aria-current={activeKey === tabKey(tab) ? "page" : undefined} onClick={event => { onSelect(tab); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{tab.title || "Untitled"}</button>)}</div>
    </details>
  </div>;
}
