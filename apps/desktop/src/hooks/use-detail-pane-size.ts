import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

const storageKey = '127vaults:desktop-detail-width';
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export function useDetailPaneSize(enabled: boolean, layout: string) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState<number | null>(() => {
    try { const value = Number(localStorage.getItem(storageKey)); return Number.isFinite(value) && value >= 320 && value <= 10000 ? value : null; }
    catch { return null; }
  });
  const [metrics, setMetrics] = useState({ width: 0, available: 0, top: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const latest = useRef(preferred);
  useEffect(() => {
    if (!enabled) { drag.current = null; setDragging(false); return; }
    const root = rootRef.current, detail = root?.querySelector<HTMLElement>('.desktop-detail');
    const sidebar = root?.querySelector<HTMLElement>('.desktop-sidebar');
    if (!root || !detail || !sidebar) return;
    const measure = () => {
      const bounds = root.getBoundingClientRect(), pane = detail.getBoundingClientRect();
      const available = bounds.width - (window.innerWidth > 850 ? sidebar.getBoundingClientRect().width : 0);
      const next = { width: pane.width, available, top: pane.top - bounds.top };
      setMetrics(current => Object.keys(next).every(key => next[key as keyof typeof next] === current[key as keyof typeof next]) ? current : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root); observer.observe(detail); observer.observe(sidebar); measure();
    return () => observer.disconnect();
  }, [enabled, layout]);
  const minimum = 320, maximum = Math.max(minimum, metrics.available - (window.innerWidth > 850 ? 280 : 240));
  const remember = (value: number | null) => {
    latest.current = value; setPreferred(value);
    try { if (value === null) localStorage.removeItem(storageKey); else localStorage.setItem(storageKey, String(value)); } catch { /* Session resizing still works without storage. */ }
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (cancelled) { latest.current = preferred; }
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (latest.current !== null) remember(latest.current);
  };
  const rootStyle = preferred !== null && metrics.available > 0 ? { '--desktop-detail-width': `${clamp(preferred, minimum, maximum)}px` } as CSSProperties : undefined;
  return {
    rootRef, rootStyle, sized: preferred !== null && metrics.available > 0, dragging,
    separatorProps: {
      role: 'separator' as const, tabIndex: 0, 'aria-label': 'Resize detail pane', 'aria-orientation': 'vertical' as const,
      'aria-valuemin': minimum, 'aria-valuemax': Math.round(maximum), 'aria-valuenow': Math.round(metrics.width),
      'aria-valuetext': `${Math.round(metrics.width)} pixels wide`, 'aria-controls': 'desktop-item-details',
      title: 'Drag to resize details. Arrow keys adjust width; double-click to reset.',
      style: { right: `${metrics.width - 5}px`, top: `${metrics.top}px` },
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, width: metrics.width }; setDragging(true);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const next = clamp(drag.current.width + drag.current.x - event.clientX, minimum, maximum);
        latest.current = next; setPreferred(next);
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event),
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
      onLostPointerCapture: () => { if (drag.current) { drag.current = null; setDragging(false); if (latest.current !== null) remember(latest.current); } },
      onDoubleClick: () => remember(null),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 50 : 16;
        const next = event.key === 'ArrowLeft' ? metrics.width + step : event.key === 'ArrowRight' ? metrics.width - step : event.key === 'Home' ? minimum : event.key === 'End' ? maximum : null;
        if (next !== null) { event.preventDefault(); event.stopPropagation(); remember(clamp(next, minimum, maximum)); }
        else if (event.key === 'Enter') { event.preventDefault(); remember(null); }
      },
    },
  };
}
