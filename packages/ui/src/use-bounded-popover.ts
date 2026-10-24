import { useEffect, useRef } from "react";

/** A top-layer menu that fits beside its trigger without enlarging its scroll pane. */
export function useBoundedPopover() {
  const trigger = useRef<HTMLDetailsElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const details = trigger.current, panel = menu.current;
    if (!details || !panel) return;
    const position = () => {
      const rect = details.querySelector('summary')!.getBoundingClientRect();
      const gap = 8, edge = 16, width = Math.min(352, window.innerWidth - edge * 2);
      const below = window.innerHeight - rect.bottom - gap - edge;
      const above = rect.top - gap - edge;
      const upward = below < 220 && above > below;
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(edge, Math.min(rect.right - width, window.innerWidth - edge - width))}px`;
      panel.style.maxHeight = `${Math.max(0, Math.min(512, upward ? above : below))}px`;
      panel.style.top = upward ? 'auto' : `${rect.bottom + gap}px`;
      panel.style.bottom = upward ? `${window.innerHeight - rect.top + gap}px` : 'auto';
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panel.matches(':popover-open')) event.stopImmediatePropagation();
    };
    const sync = () => {
      if (details.open) { position(); if (!panel.matches(':popover-open')) panel.showPopover(); }
      else if (panel.matches(':popover-open')) panel.hidePopover();
    };
    const dismissed = () => { if (!panel.matches(':popover-open')) details.open = false; };
    const scroll = (event: Event) => { if (details.open && !panel.contains(event.target as Node)) position(); };
    document.addEventListener('keydown', escape, true);
    details.addEventListener('toggle', sync);
    panel.addEventListener('toggle', dismissed);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('keydown', escape, true);
      details.removeEventListener('toggle', sync); panel.removeEventListener('toggle', dismissed);
      window.removeEventListener('resize', position); window.removeEventListener('scroll', scroll, true);
    };
  }, []);
  return { trigger, menu };
}
