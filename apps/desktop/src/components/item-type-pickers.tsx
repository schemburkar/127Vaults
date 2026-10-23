import { useState } from "react";
import { Check, ChevronDown, CreditCard, Globe2, KeyRound, Landmark, Router, Terminal, Wifi } from "lucide-react";
import { Input, cn } from "@127vaults/ui";
import { ITEM_TYPES, TYPE_GROUPS, RELATED_TYPES, type ItemType, type SectionType } from "@127vaults/domain/item-types";

const TYPE_ICONS = { note: Terminal, identity: Globe2, passport: Globe2, license: Globe2, membership: Globe2, database: Globe2, email: Globe2, medical: Globe2, api: Globe2, custom: Globe2, login: Globe2, bank: Landmark, card: CreditCard, wifi: Wifi, router: Router, ssh: Terminal, password: KeyRound, passkey: KeyRound };
const TYPE_DESCRIPTIONS: Record<ItemType, string> = {
  note: "Private text and notes",
  identity: "Personal details and addresses",
  passport: "Passport details and dates",
  license: "License details and keys",
  membership: "Membership and rewards details",
  database: "Database connection credentials",
  email: "Mail account credentials",
  medical: "Private health information",
  api: "Service access credentials",
  custom: "Your own fields and sections",
  login: "Website or app sign-in",
  passkey: "Passwordless website sign-in",
  bank: "Account and online banking",
  card: "Debit or credit card",
  wifi: "Wireless network access",
  router: "Network device and admin access",
  ssh: "Server or device access",
  password: "A standalone secret or code",
};

export function TypePicker({ value, onSelect }: { value: ItemType; onSelect: (type: ItemType) => void }) {
  const Icon = TYPE_ICONS[value];
  return <details className="group relative w-full">
    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-xl border border-white/15 bg-[#11162b] px-2 py-1.5 text-sm text-slate-100 hover:border-[#E0BB95]/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E0BB95] [&::-webkit-details-marker]:hidden">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#E0BB95]/12 text-[#E0BB95]"><Icon size={17} /></span>
      <span className="min-w-0 flex-1 truncate font-semibold">{ITEM_TYPES[value].label}</span>
      <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
    </summary>
    <div className="absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-3rem))] rounded-xl border border-white/15 bg-[#11162b] p-2 shadow-2xl">
      <p className="px-3 py-2 text-xs text-slate-400">Choose the main item type</p>
      {TYPE_GROUPS.map((group) => <div key={group.label} className="mb-2 last:mb-0">
        <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{group.label}</p>
        {group.types.map((type) => { const OptionIcon = TYPE_ICONS[type]; return <button key={type} type="button" className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/10", type === value && "bg-[#E0BB95]/10")} onClick={(event) => { onSelect(type); event.currentTarget.closest("details")?.removeAttribute("open"); }}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/7 text-[#E0BB95]"><OptionIcon size={17} /></span><span className="min-w-0 flex-1"><strong className="block text-sm text-slate-100">{ITEM_TYPES[type].label}</strong><small className="block text-xs text-slate-400">{TYPE_DESCRIPTIONS[type]}</small></span>{type === value && <Check size={16} className="shrink-0 text-[#E0BB95]" />}</button>; })}
      </div>)}
    </div>
  </details>;
}

export function RelatedPicker({ type, onSelect }: { type: ItemType; onSelect: (type: SectionType, label: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = [...RELATED_TYPES[type], { type: "custom" as const, label: "Custom details", description: "A named group of your own fields" }]
    .filter((option) => `${option.label} ${option.description}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="mt-4">
    <button type="button" className="w-full rounded-xl border border-dashed border-[#E0BB95]/50 bg-[#E0BB95]/8 px-4 py-3 text-left text-sm font-semibold text-[#E0BB95] hover:bg-[#E0BB95]/12" aria-expanded={open} onClick={() => setOpen((current) => !current)}>＋ Add related detail</button>
    {open && <div className="mt-2 rounded-xl border border-white/12 bg-[#11162b] p-3">
      <label className="grid gap-2 text-xs text-slate-400">Find a related detail<Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search options…" /></label>
      <p className="my-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Suggested for {ITEM_TYPES[type].label}</p>
      <div className="grid gap-2 sm:grid-cols-2">{options.map((option) => <button key={option.type} type="button" className="rounded-lg border border-white/10 bg-white/3 p-3 text-left hover:border-[#E0BB95]/40 hover:bg-white/7" onClick={() => { onSelect(option.type, option.label); setOpen(false); setQuery(""); }}><strong className="block text-sm text-slate-100">{option.label}</strong><span className="mt-1 block text-xs text-slate-400">{option.description}</span></button>)}</div>
      {!options.length && <p className="py-3 text-xs text-slate-400">No matching related detail.</p>}
    </div>}
  </div>;
}
