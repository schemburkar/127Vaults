import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./utils";

/** Keep values as strings: account numbers and imported values must never be coerced. */
export function FieldValueEditor({ kind, revealed = false, value, onValueChange, className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & { kind: string; revealed?: boolean; value: string; onValueChange: (value: string) => void }) {
  const shared = {
    ...props, value, "data-original-value": /[\r\n]/.test(value) ? value : undefined, autoComplete: "off", spellCheck: false,
    className: cn("min-h-11 min-w-0 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-[#E0BB95] focus:ring-3 focus:ring-[#E0BB95]/15", className),
  };
  // Password inputs strip line breaks. Keep the original in a hidden form value
  // while masked, and use a textarea on reveal so key text survives web saves.
  if (kind === "password" && !revealed && /[\r\n]/.test(value)) return <div className="min-w-0"><input {...shared} type="hidden" readOnly /><input type="password" value="••••••••••••" readOnly aria-label={props["aria-label"] || "Concealed multiline value"} className={shared.className} autoComplete="off" /></div>;
  if (kind === "note" || kind === "address" || (value.includes("\n") && (kind !== "password" || revealed))) return <textarea {...shared as TextareaHTMLAttributes<HTMLTextAreaElement>} rows={3} onChange={event => onValueChange(event.target.value)} />;
  const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return <input {...shared} type={kind === "password" && !revealed ? "password" : kind === "date" && (!value || dateValue) ? "date" : "text"} inputMode={kind === "number" ? "decimal" : kind === "url" ? "url" : kind === "email" ? "email" : kind === "phone" ? "tel" : "text"} onChange={event => onValueChange(event.target.value)} />;
}
