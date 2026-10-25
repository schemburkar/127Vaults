import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@127vaults/ui";

type Request = { message: string; resolve: (accepted: boolean) => void };
const ConfirmationContext = createContext({ ask: async (_message: string) => false, cancel: () => {} });

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const finish = useCallback((accepted: boolean) => {
    const current = pending.current;
    pending.current = null;
    dialog.current?.close();
    setRequest(null);
    current?.resolve(accepted);
  }, []);
  const ask = useCallback((message: string) => {
    // Ignore repeated actions while a decision is already pending.
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>(resolve => {
      const next = { message, resolve };
      pending.current = next;
      setRequest(next);
    });
  }, []);
  useEffect(() => {
    if (!request) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, [request]);
  useEffect(() => () => { pending.current?.resolve(false); pending.current = null; }, []);
  return <ConfirmationContext.Provider value={{ ask, cancel: () => finish(false) }}>{children}
    <dialog role="dialog" ref={dialog} className="desktop-confirmation rounded-2xl border border-white/15 bg-[#11162b] p-6 text-slate-100 shadow-2xl backdrop:bg-black/60" aria-labelledby="desktop-confirmation-title" aria-describedby="desktop-confirmation-message" onCancel={event => { event.preventDefault(); finish(false); }}>
      <h2 id="desktop-confirmation-title" className="text-lg font-semibold">Confirm action</h2>
      <p id="desktop-confirmation-message" className="mt-3 text-sm leading-6 text-slate-300">{request?.message}</p>
      <div className="mt-6 flex justify-end gap-2"><Button variant="secondary" autoFocus onClick={() => finish(false)}>Cancel</Button><Button onClick={() => finish(true)}>Confirm</Button></div>
    </dialog>
  </ConfirmationContext.Provider>;
}
export function useConfirmation() { return useContext(ConfirmationContext); }
