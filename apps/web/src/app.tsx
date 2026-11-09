import { markerClass, useBoundedPopover } from "@127vaults/ui";
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import {
  Star,
  ShieldCheck,
  Check,
  ChevronDown,
  CreditCard,
  Copy,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Landmark,
  LayoutList,
  LayoutGrid,
  PanelsTopLeft,
  LockKeyhole,
  Plus,
  RefreshCw,
  Router,
  Search,
  Settings as SettingsIcon,
  Terminal,
  Trash2,
  Vault as VaultIcon,
  Wifi,
  X,
} from "lucide-react";
import { FieldValueEditor, FieldTypePicker, PasskeyDetails, KeyboardHelp, AuthenticatorEditor, AuthenticatorCode, FAVORITE_ID, TOTP_ID, isFavorite, setFavorite, setAuthenticator, parseTotp, Button, IconButton, Input, SecretGenerator, type GeneratorOptions } from "@127vaults/ui";
import { QRCodeSVG } from "qrcode.react";
import { ITEM_TYPES, TYPE_GROUPS, RELATED_TYPES, SECTION_TYPES, CUSTOM_SECTION, addWebsite, TYPE_FIELD_ID, SECTION_PREFIX, addRelatedSection, addSectionField, completeRelatedFields, itemType, ordinaryFields, primaryFields, removeSection, renameSection, replaceItemType, sections, setItemType, type ItemType, type ItemField, type SectionType } from "@127vaults/domain/item-types";
import { browseColumnValue, browseGroups, type BrowseMode } from "@127vaults/domain/item-browser";

import * as productFeatures from "../../../packages/ui/src/product-features.mjs";
import { ItemWorkspace } from "./item-workspace";
import { PwaControls, PwaLifecycle } from './pwa-controls';
import { CollectionLinks, CollectionsSettings, CollectionDialog, VaultLifecycleSettings, useVaultSettings } from './vault-collections';
(window as any).__vaultsFeatures = productFeatures;

const generateSecret = (options: GeneratorOptions) => new Promise<string>((resolve, reject) => {
  const timer = window.setTimeout(() => reject(new Error("Generator unavailable. Reload the app and unlock the vault.")), 5000);
  window.dispatchEvent(new CustomEvent("vaults:generate-secret", { detail: {
    options,
    resolve: (value: string) => { clearTimeout(timer); resolve(value); },
    reject: (error: unknown) => { clearTimeout(timer); reject(error); },
  } }));
});

const eyebrow = "mb-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500";
const muted = "text-slate-400";
const fieldLabel = "grid gap-2 text-[13px] font-semibold text-slate-400";
const panel = "overflow-auto rounded-[1.25rem] border border-white/7 bg-[#46484821] shadow-[0_14px_36px_-24px_rgba(0,0,0,.8)] backdrop-blur-sm";
const detailSection = "ui-page-section mt-7 [&>h3]:mb-3 [&>h3]:text-xs [&>h3]:font-bold [&>h3]:uppercase [&>h3]:tracking-[0.08em] [&>h3]:text-slate-500 [&>label+label]:mt-4";
const inlineStatus = "inline-block min-h-5 text-xs text-slate-500";
const backButton = "mb-3 w-fit !px-1 text-[#E0BB95]";

function WebSecretGenerator(props: Parameters<typeof SecretGenerator>[0]) {
  return <SecretGenerator {...props} autoGenerate triggerIcon={<RefreshCw size={16} aria-hidden="true" />} />;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("127Vaults interface failed", error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="grid min-h-dvh place-items-center bg-[#04071d] p-6 text-slate-100"><section className="max-w-md rounded-2xl border border-red-400/20 bg-[#11162b] p-7 text-center"><h1 className="text-xl font-bold">The interface could not be displayed</h1><p className="mt-2 text-sm text-slate-400">Your vault remains locked. Reload the app to safely try again.</p><Button className="mt-5" onClick={() => location.reload()}>Reload 127Vaults</Button></section></main>;
  }
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className={fieldLabel}>
    {label}
    {children}
  </label>
);

type ItemSummary = {
  row: { itemId: string; code: string };
  index: { title?: string; website?: string; itemType?: string; createdAt?: number; updatedAt?: number; favorite?: boolean };
};
type SearchAction = { id: string; label: string; description: string };
type DeviceSummary = {
  deviceId: string;
  protectionClass?: string;
  credentialState?: string;
  status?: string;
};
type WebVaultSummary = { vaultId: string; name: string; selected: boolean };
type CustomField = {
  id?: string;
  label?: string;
  type?: string;
  value?: string;
};
type ToastNotice = { id: string; title: string; detail: string; kind: "info" | "success" | "error" };

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

function ItemTypePicker() {
  const popover = useBoundedPopover();
  const [type, setType] = useState<ItemType>("login");
  const [hasPasskey, setHasPasskey] = useState(false);
  useEffect(() => {
    const load = (event: Event) => { const fields = (event as CustomEvent<ItemField[]>).detail; setType(itemType(fields)); setHasPasskey(fields.some(field => field.id === "__127vaults_passkey")); };
    const removed = () => setHasPasskey(false);
    const changed = (event: Event) => setType((event as CustomEvent<ItemType>).detail);
    window.addEventListener("vaults:set-editor-fields", load);
    window.addEventListener("vaults:item-type", changed);
    window.addEventListener("vaults:remove-editor-passkey", removed);
    return () => { window.removeEventListener("vaults:set-editor-fields", load); window.removeEventListener("vaults:item-type", changed); window.removeEventListener("vaults:remove-editor-passkey", removed); };
  }, []);
  const select = (next: ItemType, target: HTMLButtonElement) => {
    target.closest("details")?.removeAttribute("open");
    if (next === type || type === "passkey" || hasPasskey) return;
    const populated = ["url", "item-username", "item-password"].some((id) => (document.getElementById(id) as HTMLInputElement | null)?.value) || [...document.querySelectorAll<HTMLInputElement>("#custom-fields .typed-value")].some((input) => input.value) || !!document.querySelector("#custom-fields input[data-field-id^='__127vaults_section:']");
    if (populated && !window.confirm("Change the main type? Its current type fields and related details will be removed. Save a copy first if you need them.")) return;
    for (const id of ["url", "item-username", "item-password"]) { const input = document.getElementById(id) as HTMLInputElement | null; if (input) input.value = ""; }
    window.dispatchEvent(new CustomEvent("vaults:select-item-type", { detail: next }));
  };
  const Icon = TYPE_ICONS[type];
  return <div className={fieldLabel}><span>Type</span><details ref={popover.trigger} className="group relative min-w-0"><summary id="item-type" className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-white/10 bg-[#11162b] px-2 py-1.5 text-sm text-white hover:border-[#E0BB95]/50 [&::-webkit-details-marker]:hidden"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#E0BB95]/12 text-[#E0BB95]"><Icon size={17} /></span><span className="min-w-0 flex-1 truncate">{ITEM_TYPES[type].label}</span><ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" /></summary><div ref={popover.menu} popover="auto" className="ui-type-popover rounded-xl border border-white/15 bg-[#11162b] p-2 shadow-2xl"><p className="px-3 py-2 text-xs text-slate-400">Choose the main item type</p>{TYPE_GROUPS.map((group) => <div key={group.label}><p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{group.label}</p>{group.types.map((option) => { const OptionIcon = TYPE_ICONS[option]; return <button key={option} type="button" className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/10 ${option === type ? "bg-[#E0BB95]/10" : ""}`} onClick={(event) => select(option, event.currentTarget)}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/7 text-[#E0BB95]"><OptionIcon size={17} /></span><span className="min-w-0 flex-1"><strong className="block text-sm text-white">{ITEM_TYPES[option].label}</strong><small className="block text-xs text-slate-400">{TYPE_DESCRIPTIONS[option]}</small></span>{option === type && <Check size={16} className="shrink-0 text-[#E0BB95]" />}</button>; })}</div>)}</div></details></div>;
}

function RelatedPicker({ type, onSelect }: { type: ItemType; onSelect: (type: SectionType, label: string) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const options = [...RELATED_TYPES[type], { type: "custom" as const, label: "Custom details", description: "A named group of your own fields" }].filter((option) => `${option.label} ${option.description}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="mt-4"><button type="button" className="w-full rounded-xl border border-dashed border-[#E0BB95]/50 bg-[#E0BB95]/8 px-4 py-3 text-left text-sm font-semibold text-[#E0BB95] hover:bg-[#E0BB95]/12" aria-expanded={open} onClick={() => setOpen((current) => !current)}>＋ Add related detail</button>{open && <div className="mt-2 rounded-xl border border-white/12 bg-[#11162b] p-3"><label className={fieldLabel}>Find a related detail<Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search options…" /></label><p className="my-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Suggested for {ITEM_TYPES[type].label}</p><div className="grid gap-2 sm:grid-cols-2">{options.map((option) => <button key={option.type} type="button" className="rounded-lg border border-white/10 bg-white/3 p-3 text-left hover:border-[#E0BB95]/40 hover:bg-white/7" onClick={() => { onSelect(option.type, option.label); setOpen(false); setQuery(""); }}><strong className="block text-sm text-white">{option.label}</strong><span className="mt-1 block text-xs text-slate-400">{option.description}</span></button>)}</div>{!options.length && <p className="py-3 text-xs text-slate-400">No matching related detail.</p>}</div>}</div>;
}

function ToastRegion() {
  const [notices, setNotices] = useState<ToastNotice[]>([]);
  useEffect(() => {
    const add = (event: Event) => {
      const notice = (event as CustomEvent<Omit<ToastNotice, "id">>).detail;
      const id = crypto.randomUUID();
      // Keep rapid offline saves and reconnect notices from covering the
      // editor on a phone-sized screen.
      setNotices((current) => [...current.slice(-1), { ...notice, id }]);
      window.setTimeout(() => setNotices((current) => current.filter((row) => row.id !== id)), notice.kind === "error" ? 8000 : 4500);
    };
    window.addEventListener("vaults:toast", add);
    return () => window.removeEventListener("vaults:toast", add);
  }, []);
  return <div className="pointer-events-none fixed right-5 top-5 z-[70] grid w-[min(22rem,calc(100vw-2rem))] gap-2" aria-live="polite" aria-label="Notifications">{notices.map((notice) => <div key={notice.id} className={`pointer-events-auto rounded-xl border p-4 shadow-2xl ${notice.kind === "error" ? "border-red-400/25 bg-[#2a1118]" : notice.kind === "success" ? "border-emerald-400/25 bg-[#10251f]" : "border-white/10 bg-[#11162b]"}`}><strong className="block text-sm">{notice.title}</strong>{notice.detail && <p className="mt-1 text-xs leading-5 text-slate-400">{notice.detail}</p>}</div>)}</div>;
}


function CustomFieldsEditor() {
  const [fields, setFields] = useState<ItemField[]>([]);
  const [expandedRelatedId, setExpandedRelatedId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  useEffect(() => {
    const set = (event: Event) => { setFields(completeRelatedFields((event as CustomEvent<ItemField[]>).detail.map((field) => ({ ...field })))); setExpandedRelatedId(null); setRevealed(new Set()); };
    const selectType = (event: Event) => { const type = (event as CustomEvent<ItemType>).detail; setFields((current) => replaceItemType(current, type)); setExpandedRelatedId(null); window.dispatchEvent(new CustomEvent("vaults:item-type", { detail: type })); };
    const add = (event: Event) =>
      setFields((current) =>
        ordinaryFields(current).length >= 32 || current.length >= 50
          ? current
          : [
              ...current,
              {
                ...(event as CustomEvent<ItemField>).detail,
                label: (event as CustomEvent<ItemField>).detail.label || "",
                type: (event as CustomEvent<ItemField>).detail.type || "text",
                value: (event as CustomEvent<ItemField>).detail.value || "",
                id:
                  (event as CustomEvent<ItemField>).detail.id ||
                  crypto.randomUUID(),
              },
            ],
      );
    window.addEventListener("vaults:set-editor-fields", set);
    window.addEventListener("vaults:select-item-type", selectType);
    window.addEventListener("vaults:add-editor-field", add);
    return () => {
      window.removeEventListener("vaults:set-editor-fields", set);
      window.removeEventListener("vaults:select-item-type", selectType);
      window.removeEventListener("vaults:add-editor-field", add);
    };
  }, []);
  const update = (id: string, patch: Partial<CustomField>) => {
    if (patch.type) setRevealed(current => { const next = new Set(current); next.delete(id); return next; });
    setFields((current) =>
      current.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    );
  };
  const addRelated = (type: SectionType, label: string) => {
    const existing = sections(fields).filter((section) => section.type === type).length;
    let next = addRelatedSection(fields, type, existing ? `${label} ${existing + 1}` : label);
    const added = sections(next).at(-1);
    if (added && type === "custom") next = addSectionField(next, added.id);
    if (next.length > 50) { window.dispatchEvent(new CustomEvent("vaults:toast", { detail: { title: "Item is full", detail: "Remove an unused detail before adding another.", kind: "error" } })); return; }
    setFields(next);
    setExpandedRelatedId(added?.id ?? null);
  };
  const toggleReveal = (id: string) => setRevealed((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const typedEditor = (field: ItemField) => <label key={field.id} className={fieldLabel}>{field.label}<div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"><FieldValueEditor kind={field.type} revealed={revealed.has(field.id)} data-field-id={field.id} data-field-label={field.label} data-field-type={field.type} className="typed-value" value={field.value} onValueChange={(value) => update(field.id, { value })} />{field.type === "password" && <div className="flex gap-2"><IconButton label={`${revealed.has(field.id) ? "Hide" : "Reveal"} ${field.label || "secret"}`} variant="secondary" aria-pressed={revealed.has(field.id)} onClick={() => toggleReveal(field.id)}>{revealed.has(field.id) ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</IconButton><WebSecretGenerator generate={generateSecret} label={field.label || "secret"} initialMode={/pin/i.test(field.label) ? "pin" : "password"} onUse={(value) => update(field.id, { value })} /></div>}</div></label>;
  return (
    <div id="custom-fields" className="mt-3 grid gap-2">
      <label className="flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={isFavorite(fields)} onChange={e => setFields(current => setFavorite(current, e.target.checked))} />Favorite</label>
      {itemType(fields) === "login" && <Button variant="secondary" onClick={() => setFields(current => addWebsite(current))}>Add another website</Button>}
      <PasskeyDetails fields={fields} onRemove={() => { const next = setItemType(fields.filter(f => f.id !== "__127vaults_passkey" && f.id !== "__127vaults_passkey_key"), itemType(fields) === "passkey" ? "login" : itemType(fields)); setFields(next); window.dispatchEvent(new Event("vaults:remove-editor-passkey")); window.dispatchEvent(new CustomEvent("vaults:item-type", { detail: itemType(next) })); }} />
      {(itemType(fields) !== "passkey" || fields.some(f => f.id === TOTP_ID && f.value)) && <AuthenticatorEditor copy={async value => { await (window as any).__vaultsActions.copyField(value); }} value={fields.find(f => f.id === TOTP_ID)?.value || ""} onChange={value => setFields(current => setAuthenticator(current, value))} />}
      {fields.filter(f => f.id === TOTP_ID).map(f => <input key={f.id} type="hidden" className="item-metadata" data-field-id={f.id} data-field-label={f.label} data-field-type={f.type} value={f.value} />)}
      {fields.filter((field) => field.id === TYPE_FIELD_ID || field.id === FAVORITE_ID || field.id.startsWith(SECTION_PREFIX)).map((field) => <input key={field.id} type="hidden" className="item-metadata" data-field-id={field.id} data-field-label={field.label} data-field-type={field.type} value={field.value} readOnly />)}
      {primaryFields(fields).length > 0 && <h4 className="mt-4 text-xs font-bold uppercase text-[#E0BB95]">{ITEM_TYPES[itemType(fields)].label} fields</h4>}
      {primaryFields(fields).map(typedEditor)}
      <section className="mt-7 border-t border-white/10 pt-6"><div className="flex items-center justify-between gap-3"><div><h3 className="text-xs font-bold uppercase tracking-[.08em] text-slate-500">Related to this {ITEM_TYPES[itemType(fields)].label}</h3><p className="mt-2 text-sm text-slate-400">Keep cards, logins, and other details together with this item. Name each one so it is easy to find.</p></div><span className="shrink-0 text-xs text-slate-500">{sections(fields).length} added</span></div>
        <div className="mt-4 grid gap-3">{sections(fields).map((section) => <div key={section.id} className="overflow-hidden rounded-xl border border-white/10 bg-white/3"><div className="flex flex-wrap items-center gap-2 p-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#E0BB95]/12 text-[#E0BB95]"><KeyRound size={17} /></span><button type="button" className="min-w-0 flex-1 text-left" aria-expanded={expandedRelatedId === section.id} onClick={() => setExpandedRelatedId(expandedRelatedId === section.id ? null : section.id)}><strong className="block truncate text-sm text-white">{section.label}</strong><span className="mt-1 block text-xs text-slate-500">{section.type === "custom" ? CUSTOM_SECTION.label : SECTION_TYPES[section.type].label} · {section.fields.filter((field) => field.value).length} field(s) added</span></button><Button type="button" size="sm" variant="ghost" onClick={() => setExpandedRelatedId(expandedRelatedId === section.id ? null : section.id)}>{expandedRelatedId === section.id ? "Done" : "Edit"}</Button><Button type="button" size="sm" variant="ghost" title={`Remove ${section.label}`} onClick={() => { setFields((current) => removeSection(current, section.id)); if (expandedRelatedId === section.id) setExpandedRelatedId(null); }}><Trash2 size={15} />Remove</Button></div>
          {expandedRelatedId !== section.id && section.fields.map((field) => <input key={field.id} type="hidden" className="typed-value" data-field-id={field.id} data-field-label={field.label} data-field-type={field.type} value={field.value} readOnly />)}
          {expandedRelatedId === section.id && <div className="grid gap-4 border-t border-white/10 p-4"><label className={fieldLabel}>Name<Input value={section.label} onChange={(event) => setFields((current) => renameSection(current, section.id, event.target.value))} placeholder="e.g. Daily spending card" /></label>{section.type === "custom" ? section.fields.map((field) => <div key={field.id} className="grid gap-2 rounded-lg border border-white/10 p-3 sm:grid-cols-[1fr_8rem]"><label className={fieldLabel}>Field name<Input required maxLength={128} value={field.label} onChange={(event) => update(field.id, { label: event.target.value })} /></label><label className={fieldLabel}>Kind<FieldTypePicker value={field.type || "text"} onChange={(type) => update(field.id, { type })} /></label><div className="sm:col-span-2">{typedEditor(field)}</div><Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => setFields((current) => current.filter((row) => row.id !== field.id))}><Trash2 size={14} />Remove field</Button></div>) : section.fields.map(typedEditor)}{section.type === "custom" && <Button type="button" variant="secondary" disabled={fields.length >= 50} className="justify-self-start" onClick={() => { if (fields.length >= 50) return; setFields((current) => addSectionField(current, section.id)); }}><Plus size={15} />Add field</Button>}</div>}
        </div>)}</div><RelatedPicker type={itemType(fields)} onSelect={addRelated} />
      </section>
      <div className="mt-7 flex items-center justify-between gap-3"><h3 className="text-xs font-bold uppercase tracking-[.08em] text-slate-500">Custom fields</h3><Button id="add-custom-field" disabled={fields.length >= 50 || ordinaryFields(fields).length >= 32} type="button" variant="secondary"><Plus size={16} />Add field</Button></div>
      {ordinaryFields(fields).map((field, index) => {
        const id = field.id!;
        const inputClass =
          "custom-value min-h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-[#E0BB95] focus:ring-4 focus:ring-[#E0BB95]/10";
        return (
          <div
            key={id}
            className="custom-field grid grid-cols-[minmax(8rem,1fr)_7rem_minmax(10rem,2fr)_auto] items-start gap-2 max-[560px]:grid-cols-[1fr_7rem] max-[560px]:[&_.custom-value]:col-span-2 max-[560px]:[&_.ui-button]:col-start-2 max-[560px]:[&_.ui-button]:justify-self-end"
            data-field-id={id}
          >
            <Input
              className="custom-label"
              placeholder="Field name"
              maxLength={128}
              required
              value={field.label ?? ""}
              aria-label={`Custom field ${index + 1} name`}
              onChange={(event) => update(id, { label: event.target.value })}
            />
            <FieldTypePicker value={field.type || "text"} onChange={(type) => update(id, { type })} />
            <div className="grid gap-2 max-[560px]:col-span-2">
              <div className={field.type === "password" ? "grid grid-cols-[minmax(0,1fr)_auto] gap-2" : "grid"}>
              <FieldValueEditor kind={field.type || "text"} revealed={revealed.has(id)} className={inputClass} value={field.value || ""} aria-label={`Custom field ${index + 1} value`} onValueChange={(value) => update(id, { value })} />
              {field.type === "password" && <div className="flex gap-2"><IconButton label={`${revealed.has(id) ? "Hide" : "Reveal"} ${field.label || "secret"}`} variant="secondary" aria-pressed={revealed.has(id)} onClick={() => toggleReveal(id)}>{revealed.has(id) ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</IconButton><WebSecretGenerator generate={generateSecret} label={field.label || "secret"} onUse={(value) => update(id, { value })} /></div>}
              </div>
            </div>
            <Button
              variant="ghost"
              className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
              aria-label={`Remove custom field ${index + 1}`}
              onClick={() =>
                setFields((current) => current.filter((item) => item.id !== id))
              }
            >
              Remove
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function CustomFieldsView() {
  const [fields, setFields] = useState<ItemField[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [showQr, setShowQr] = useState(false);
  const [wifiPassword, setWifiPassword] = useState("");
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ fields: ItemField[]; password: string }>).detail;
      setFields(detail.fields);
      setWifiPassword(detail.password);
      setRevealed(new Set());
      setShowQr(false);
    };
    window.addEventListener("vaults:view-fields", update);
    return () => window.removeEventListener("vaults:view-fields", update);
  }, []);
  const copy = async (value?: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), Number(localStorage.getItem("127vaults:clipboard-seconds") || 30) * 1000);
  };
  const renderField = (field: ItemField) => {
    const secret = field.type === "password", shown = revealed.has(field.id);
    return <div key={field.id} className="vault-detail-field grid min-h-16 grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-2 border-t border-white/7 px-3 max-[560px]:grid-cols-[5rem_minmax(0,1fr)]">
      <span className="text-xs font-medium text-slate-500">{field.label}</span>
      <strong className={`min-w-0 break-all text-sm ${secret ? "font-mono" : ""}`}>{secret && !shown ? "••••••••••••" : field.value || "—"}</strong>
      <div className="flex gap-1 max-[560px]:col-start-2">{secret && <IconButton label={`${shown ? "Hide" : "Reveal"} ${field.label}`} aria-pressed={shown} onClick={() => setRevealed((current) => { const next = new Set(current); shown ? next.delete(field.id) : next.add(field.id); return next; })}>{shown ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</IconButton>}<IconButton label={`Copy ${field.label}`} onClick={() => copy(field.value)}><Copy size={16} aria-hidden="true" /></IconButton></div>
    </div>;
  };
  const ssid = fields.find((field) => field.id === "ssid")?.value;
  const security = fields.find((field) => field.id === "wifi_security")?.value || "WPA";
  const escapeWifi = (value: string) => value.replace(/([\\;,:"])/g, "\\$1");
  return (
    <div id="view-custom-fields" className="mt-4 overflow-hidden rounded-xl border border-white/8 bg-black/5 empty:hidden">
      <PasskeyDetails fields={fields} />
      {fields.find(f => f.id === TOTP_ID)?.value && <AuthenticatorCode value={fields.find(f => f.id === TOTP_ID)!.value} copy={copy} />}
      {primaryFields(fields).length > 0 && <h4 className="border-t border-white/10 px-3 py-2 text-xs font-bold uppercase text-[#E0BB95]">{ITEM_TYPES[itemType(fields)].label}</h4>}
      {primaryFields(fields).map(renderField)}
      {sections(fields).map((section) => <section key={section.id}><h4 className="border-t border-white/10 px-3 py-2 text-xs font-bold uppercase text-[#E0BB95]">{section.label}</h4>{section.fields.map(renderField)}</section>)}
      {ordinaryFields(fields).map(renderField)}
      {itemType(fields) === "wifi" && ssid && <div className="border-t border-white/10 p-4"><Button variant="secondary" onClick={() => setShowQr((current) => !current)}>{showQr ? "Hide join QR" : "Show Wi-Fi join QR"}</Button>{showQr && <div className="mt-3 inline-grid gap-2 rounded-xl bg-white p-4 text-slate-900"><QRCodeSVG size={180} value={`WIFI:T:${escapeWifi(security)};S:${escapeWifi(ssid)};P:${escapeWifi(wifiPassword)};;`} /><span className="text-xs">Scan to join {ssid}</span></div>}</div>}
    </div>
  );
}

function ItemList({ layout }: { layout: "list" | "grid" }) {
  const [vaultCount, setVaultCount] = useState(() => (window as any).__vaultsSnapshot?.length ?? 0);
  useEffect(() => {
    const update = (event: Event) => setVaultCount((event as CustomEvent<WebVaultSummary[]>).detail.length);
    window.addEventListener("vaults:vaults", update);
    return () => window.removeEventListener("vaults:vaults", update);
  }, []);
  const [browseMode, setBrowseMode] = useState<BrowseMode>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | ItemType>("all");
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1440px)").matches);
  const [view, setView] = useState<{
    items: ItemSummary[];
    actions: SearchAction[];
    selectedId: string | null;
    empty: string;
  }>({ items: [], actions: [], selectedId: null, empty: "This vault has no items yet." });
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1440px)");
    const updateWidth = () => setWide(media.matches);
    media.addEventListener("change", updateWidth);
    return () => media.removeEventListener("change", updateWidth);
  }, []);
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<Partial<typeof view>>).detail ?? {};
      setView((current) => ({
        ...current,
        ...detail,
        items: detail.items ?? [],
        actions: detail.actions ?? [],
      }));
    };
    window.addEventListener("vaults:items", update);
    return () => window.removeEventListener("vaults:items", update);
  }, []);
  if (!view.items.length && !view.actions.length)
    return (
      <div className="vault-empty-state rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
        <h2 className="text-base font-semibold">{!vaultCount ? "Create your first vault" : view.empty === "No favorites yet." ? "No favorites yet" : view.empty === "No matching items." ? "No matching items" : "Add your first item"}</h2>
        <p className="mt-2 text-sm text-slate-400">{!vaultCount ? "Start with a vault to keep your items together." : view.empty === "No favorites yet." ? "Star an item to keep it handy here." : view.empty === "No matching items." ? "Try a different name or website." : "Add a login, card, or another detail you want to keep handy."}</p>
        {(!vaultCount || view.empty !== "No matching items." && view.empty !== "No favorites yet.") && <Button className="mt-5" onClick={() => !vaultCount ? document.getElementById("create-vault")?.click() : document.getElementById("new-item")?.click()}><Plus size={16} aria-hidden="true" />{!vaultCount ? "Create vault" : "Add item"}</Button>}
      </div>
    );
  const visibleItems = layout === "grid" && wide && typeFilter !== "all"
    ? view.items.filter((item) => item.index.itemType === typeFilter)
    : view.items;
  return (
    <>
      {(view.actions ?? []).map((action) => (
        <button key={action.id} className="mb-1 flex min-h-14 w-full items-center gap-3 rounded-xl border border-[#E0BB95]/20 bg-[#E0BB95]/8 px-3 text-left hover:bg-[#E0BB95]/14" onClick={() => (window as any).__vaultsActions.runAction(action.id)}>
          <Search className="size-4 shrink-0 text-[#E0BB95]" aria-hidden="true" />
          <span className="min-w-0"><b className="block text-sm">{action.label}</b><small className="block truncate text-[11px] text-slate-500">{action.description}</small></span>
        </button>
      ))}
      {layout === "grid" && <div className="vault-browse-controls" role="group" aria-label="Filter and group items">{([ ["all", "All"], ["updated", "Updated"], ["created", "Created"], ["type", "Item type"] ] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={browseMode === mode} className={browseMode === mode ? "active" : ""} onClick={() => setBrowseMode(mode)}>{label}</button>)}<label className="vault-type-filter">Type <select aria-label="Filter by item type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | ItemType)}><option value="all">All types</option>{(Object.keys(ITEM_TYPES) as ItemType[]).map((type) => <option key={type} value={type}>{ITEM_TYPES[type].label}</option>)}</select></label></div>}
      <div className={layout === "grid" ? "vault-row-grid" : "grid gap-1.5"}>
      {layout === "grid" && <div className="vault-grid-head" aria-hidden="true"><span>Item</span><span>Website</span><span>Type</span><span>Last modified</span><span>Item ID</span></div>}
      {!visibleItems.length && <p className="px-4 py-8 text-sm text-slate-500">No matching items. Older items may not have a type until they are edited.</p>}
      {browseGroups(visibleItems, layout === "grid" && wide ? browseMode : "all", (item) => item.index).map((group) => <div className="vault-item-group" key={group.key}>
      {layout === "grid" && browseMode !== "all" && <div className="vault-group-heading"><span>{group.label}</span><span>{group.items.length}</span></div>}
      {group.items.map((item) => (
        <button
          key={item.row.itemId}
          data-item-id={item.row.itemId}
          className={`vault-item-row grid min-h-16 w-full cursor-pointer grid-cols-[2.75rem_1fr_auto] items-center gap-3 rounded-xl border p-2.5 text-left text-slate-100 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#E0BB95]/10 ${view.selectedId === item.row.itemId ? "border-[#E0BB95]/35 bg-[#E0BB95]/12" : "border-transparent bg-transparent hover:bg-[#E0BB95]/10"}`}
          aria-current={view.selectedId === item.row.itemId ? "true" : undefined}
          onClick={(event) =>
            (window as any).__vaultsActions.openItem(item, event.currentTarget)
          }
        >
          <span className={`grid size-11 place-items-center rounded-xl text-sm font-extrabold ${view.selectedId === item.row.itemId ? "bg-[#E0BB95]/18 text-[#E0BB95]" : "bg-white/7 text-slate-300"}`}>
            {(item.index.title || "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <b className="block truncate text-sm font-semibold">
              {item.index.favorite && <Star size={12} className="mr-1 inline text-[#E0BB95]" aria-label="Favorite" />}{item.index.title || "Untitled"}
            </b>
            <small className="block truncate text-[11px] text-[#E0BB95]">
              {item.index.website || "No website"}
            </small>
          </span>
          <span className="vault-grid-website min-w-0 truncate text-sm text-slate-400">{item.index.website || "—"}</span>
          <span className="vault-grid-type min-w-0 truncate text-xs text-slate-400">{ITEM_TYPES[item.index.itemType as ItemType]?.label || "Type unavailable"}</span>
          <span className="vault-grid-modified min-w-0 truncate text-xs text-slate-400">{browseColumnValue("updated", item.index)}</span>
          <span className="vault-grid-id min-w-0 truncate font-mono text-xs text-slate-500" title={item.row.code}>{item.row.code}</span>
          <span className="vault-list-arrow text-slate-600">›</span>
        </button>
      ))}
      </div>)}
      </div>
    </>
  );
}

function OwnershipRequests() {
  type Grant = { grantId: string; expiresAt: string };
  const [grants, setGrants] = useState<Grant[]>(() => (window as any).__vaultsOwnershipRequests || []);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setGrants((window as any).__vaultsOwnershipRequests || []);
    window.addEventListener('vaults:ownership', update);
    update();
    return () => window.removeEventListener('vaults:ownership', update);
  }, []);
  if (!grants.length) return null;
  return <section className="mb-4 grid gap-3 rounded-xl border border-white/10 p-4" aria-label="Pending ownership requests"><h3 className="font-semibold">Pending ownership requests</h3><p className="text-sm text-slate-400">Accept after an unlock within the last five minutes. Server ownership does not grant access to anyone else's vault.</p>{grants.map(grant => <Button key={grant.grantId} disabled={pending !== null} onClick={async () => { setPending(grant.grantId); try { await (window as any).__vaultsActions.acceptOwnership(grant.grantId); } finally { setPending(null); } }}>{pending === grant.grantId ? 'Confirming ownership…' : `Accept ownership · expires ${new Date(grant.expiresAt).toLocaleString()}`}</Button>)}</section>;
}
function DeviceList() {
  const [view, setView] = useState<{
    devices: DeviceSummary[];
    currentDeviceId: string | null;
  }>({ devices: [], currentDeviceId: null });
  useEffect(() => {
    const update = (event: Event) =>
      setView((event as CustomEvent<typeof view>).detail);
    window.addEventListener("vaults:devices", update);
    return () => window.removeEventListener("vaults:devices", update);
  }, []);
  return (
    <ul id="device-list" className="my-5 grid gap-2 p-0">
      {view.devices.map((device) => {
        const current = device.deviceId === view.currentDeviceId;
        return (
          <li
            key={device.deviceId}
            className="flex list-none items-center justify-between gap-4 rounded-xl border border-white/8 bg-white/3 p-3"
          >
            <div>
              <strong className="block text-sm">
                {current
                  ? "This browser"
                  : `Device ${device.deviceId.slice(0, 8)}`}
              </strong>
              <span className="block text-xs text-slate-500">
                {device.protectionClass ?? "unknown"} protection · credential{" "}
                {device.credentialState ?? "unknown"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <b
                className={
                  device.status === "active"
                    ? "text-xs text-[#E0BB95]"
                    : "text-xs text-slate-500"
                }
              >
                {device.status ?? "unknown"}
              </b>
              {!current && device.status === "active" && (
                <Button
                  variant="ghost"
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  aria-label={`Revoke device ${device.deviceId.slice(0, 8)}`}
                  onClick={() =>
                    (window as any).__vaultsActions.revokeDevice(device)
                  }
                >
                  Revoke
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
function Brand({ entry = false, collapsed = false, onCollapse, compact = false, menuOpen = false }: { entry?: boolean; collapsed?: boolean; onCollapse?: () => void; compact?: boolean; menuOpen?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${entry ? "entry-brand mb-8" : "brand relative px-2 pb-7 pt-2 max-[560px]:p-1"}`}>
      {onCollapse && <button type="button" className="sidebar-brand-toggle absolute inset-x-0 top-0 h-12 rounded-xl" aria-label={compact ? "Toggle navigation" : collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={compact ? menuOpen : !collapsed} onClick={onCollapse} />}
      <img src="/brand-mark.svg" alt="" className={entry ? "size-10 shrink-0" : "size-9 shrink-0"} />
      <b className="max-[800px]:hidden"><img src="/wordmark.svg" alt="127 Vaults" width="127" height="40" /></b>
      {entry && (
        <span id="state" className="sr-only" aria-live="polite">
          Loading
        </span>
      )}
    </div>
  );
}

function Registration() {
  return (
    <div id="registration-flow" hidden>
      <Button id="registration-exit" variant="ghost" className={backButton}>
        ← Back to login
      </Button>
      <p id="registration-label" className={eyebrow}>FIRST USER REGISTRATION</p>
      <h1 className="mb-2 text-[2rem] font-bold tracking-[-0.025em]">Create your account</h1>
      <p id="setup-guidance" className={muted}>Get the one-time bootstrap code from your server operator.</p>
      <div
        id="registration-progress"
        className="step-dots my-5 flex gap-2 [&>i]:h-1 [&>i]:flex-1 [&>i]:rounded-full [&>i]:bg-slate-700"
        aria-label="Registration progress"
      >
        {[0, 1, 2, 3].map((step) => (
          <i key={step} className={step === 0 ? "active !bg-[#E0BB95]" : ""} />
        ))}
      </div>
      <div className="registration-step grid gap-4" data-registration-step="0">
        <Field label="Username">
          <Input id="registration-username" autoComplete="username" />
        </Field>
        <Field label="Setup or invitation code">
          <Input id="bootstrap" type="password" autoComplete="off" />
        </Field>
        <Button className="registration-next mt-2 w-full">Next</Button>
      </div>
      <div className="registration-step grid gap-4" data-registration-step="1" hidden>
        <Field label="Display name">
          <Input id="display" autoComplete="name" />
        </Field>
        <Field label="Email">
          <Input id="email" type="email" autoComplete="email" />
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" className="registration-back">
            Back
          </Button>
          <Button className="registration-next">Next</Button>
        </div>
      </div>
      <div className="registration-step grid gap-4" data-registration-step="2" hidden>
        <p className={muted}>
          This account secret was generated on this device. Store a recovery
          copy somewhere safe.
        </p>
        <output id="account-secret-display" className="block break-all rounded-xl border border-[#E0BB95]/25 bg-[#E0BB95]/10 p-4 font-mono text-xs font-semibold leading-6 text-[#E0BB95]" />
        <Button id="copy-account-secret" variant="secondary" className="mt-2 w-full">
          Copy account secret
        </Button>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" className="registration-back">
            Back
          </Button>
          <Button className="registration-next">I saved it — Next</Button>
        </div>
      </div>
      <div className="registration-step grid gap-4" data-registration-step="3" hidden>
        <Field label="Create master password">
          <Input
            id="registration-master"
            type="password"
            minLength={20}
            autoComplete="new-password"
            placeholder="At least 20 characters"
          />
        </Field>
        <Field label="Confirm master password">
          <Input
            id="registration-master-confirm"
            type="password"
            minLength={20}
            autoComplete="new-password"
          />
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" className="registration-back">
            Back
          </Button>
          <Button id="setup">Create account</Button>
        </div>
      </div>
      <form id="cloud-member-verification" className="grid gap-4" hidden>
        <Field label="Email verification code"><Input id="cloud-member-code" inputMode="numeric" pattern="[0-9]{8}" autoComplete="one-time-code" required /></Field>
        <Button type="submit">Verify and create account</Button>
        <Button type="button" variant="secondary" id="cloud-member-resend">Send another code</Button>
      </form>
      <span id="setup-status" className={`inline-status ${inlineStatus}`} role="status" />
    </div>
  );
}

function Authentication() {
  return (
    <div id="entry-shell" className="ui-access-shell grid min-h-dvh place-items-center overflow-auto bg-[radial-gradient(circle_at_top,#18203d,#04071d_58%)] p-6 max-[560px]:p-3">
      <section id="access" className="ui-access-card w-full max-w-[35rem] rounded-[1.75rem] border border-white/10 bg-[#11162b] p-10 shadow-[0_28px_80px_-30px_rgba(0,0,0,.75)] max-[560px]:rounded-[1.25rem] max-[560px]:p-6">
        <div className="mx-auto mb-7 grid size-16 place-items-center rounded-2xl bg-[#9D1F32] text-white shadow-lg shadow-[#9D1F32]/15">
          <LockKeyhole className="size-7" aria-hidden="true" />
          <span id="state" className="sr-only" aria-live="polite">Loading</span>
        </div>
        <div
          id="message"
          className="notice info my-5 hidden rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 text-sm text-slate-300"
          role="status"
          aria-live="polite"
        >
          Starting secure client…
        </div>
        <div id="login-flow">
          <p className={`${eyebrow} text-center`}>WELCOME BACK</p>
          <h1 className="mb-2 text-center text-[2rem] font-bold tracking-[-0.025em]">Unlock 127Vaults</h1>
          <p className={`${muted} text-center`}>Open your encrypted vault on this device.</p>
          <div id="login-username-step" className="flow-step mt-7 grid gap-4">
            <Field label="Username">
              <Input id="username" autoComplete="username" autoFocus />
            </Field>
            <Button id="login-next" className="mt-2 w-full">
              Next
            </Button>
          </div>
          <div id="login-password-step" className="flow-step grid gap-4" hidden>
            <Button id="login-back" variant="ghost" className={backButton}>
              ← Back
            </Button>
            <p className="mb-1 font-bold" id="login-account-name" />
            <label id="legacy-secret-field" className={fieldLabel} hidden>
              Account secret (first unlock on this device)
              <Input
                id="secret"
                type="password"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <Field label="Master password">
              <Input
                id="master"
                type="password"
                minLength={20}
                autoComplete="current-password"
                placeholder="Enter your master password"
              />
            </Field>
            <input id="device" type="hidden" />
            <Button id="login" className="mt-2 w-full">
              Login
            </Button>
          </div>
          <div className="mt-3 flex min-h-5 justify-between gap-4 text-xs text-slate-500">
            <span id="access-step" />
            <span id="login-status" className={`inline-status ${inlineStatus}`} role="status" />
          </div>
          <Button
            id="show-registration"
            variant="ghost"
            className="mx-auto mt-5 flex w-fit !px-2 text-[#E0BB95]"
          >
            Create first owner
          </Button>
          <Button id="register-browser-device" variant="ghost" className="mx-auto mt-3 flex w-fit text-[#E0BB95]" hidden>Register this device</Button>
          <PwaControls compact />
          <Button id="lock" hidden disabled>
            Lock
          </Button>
        </div>
        <Registration />
      </section>
    </div>
  );
}

function Sidebar({ collapsed, onCollapse }: { collapsed: boolean; onCollapse: () => void }) {
  const { view: browseView } = useVaultSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 800px)").matches);
  useEffect(() => { const query = window.matchMedia("(max-width: 800px)"); const update = () => setCompact(query.matches); query.addEventListener("change", update); return () => query.removeEventListener("change", update); }, []);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  useEffect(() => {
    const update = (event: Event) => setFavoritesOnly(!!(event as CustomEvent<{ favoriteView?: boolean }>).detail?.favoriteView);
    window.addEventListener("vaults:items", update);
    return () => window.removeEventListener("vaults:items", update);
  }, []);
  const [vaults, setVaults] = useState<WebVaultSummary[]>([]);
  useEffect(() => { const update = (event: Event) => setVaults((event as CustomEvent<WebVaultSummary[]>).detail); window.addEventListener("vaults:vaults", update); if ((window as any).__vaultsSnapshot) setVaults((window as any).__vaultsSnapshot); return () => window.removeEventListener("vaults:vaults", update); }, []);
  const nav = "nav w-full justify-start text-slate-400 shadow-none [&>svg]:size-4 [&>svg]:shrink-0 [&>span]:min-w-0 [&>span]:truncate [&>span]:text-left [&>b]:ml-auto";
  return (
    <aside className={`sidebar row-span-2 flex flex-col p-3 text-white ${menuOpen ? "menu-open" : ""}`}>
      <Brand collapsed={collapsed} compact={compact} menuOpen={menuOpen} onCollapse={compact ? () => setMenuOpen(open => !open) : onCollapse} />
      <nav ref={node => { node?.querySelectorAll("button").forEach(button => { const label = button.textContent?.trim(); if (label && !button.getAttribute("aria-label")) { button.setAttribute("aria-label", label); button.title = label; } }); }} className="sidebar-links flex min-h-0 flex-1 flex-col" aria-label="Main navigation" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) setMenuOpen(false); }}>
      <Button id="nav-all-items" variant="ghost" aria-pressed={!favoritesOnly && browseView?.kind === 'all'} className={`${nav} ${!favoritesOnly && browseView?.kind === 'all' ? "active" : ""}`}>
        <LayoutList aria-hidden="true" /> <span>All items</span>
        <b id="nav-count">0</b>
      </Button>
      <Button id="nav-favorites" variant="ghost" aria-pressed={favoritesOnly} className={`${nav} ${favoritesOnly ? "active" : ""}`}><Star aria-hidden="true" /><span>Favorites</span></Button>
      <Button id="password-health" variant="ghost" className={nav}><ShieldCheck aria-hidden="true" /><span>Password health</span></Button>
      <div className="vault-nav-heading mt-6 mb-2 flex items-center justify-between gap-2 px-3"><p>Vaults <span className="desktop-section-count">{vaults.length}</span></p><IconButton id="create-vault" label="Add vault" className="!size-9 !min-h-9"><Plus size={16} aria-hidden="true" /></IconButton></div>
      {vaults.map((vault) => <Button key={vault.vaultId} variant="ghost" className={`${nav} ${vault.selected ? "active" : ""}`} onClick={() => (window as any).__vaultsActions.selectVault(vault.vaultId)}><span aria-hidden="true" className={markerClass(vault.vaultId)} /><span>{vault.name}</span></Button>)}
      <CollectionLinks className={nav} />
      <div className="mt-auto space-y-1 max-[560px]:contents">
        <Button id="reload" variant="ghost" className={`${nav} max-[560px]:hidden`} title="Sync now"><RefreshCw aria-hidden="true" /><span>Sync</span></Button>
        <Button id="mobile-sync" variant="ghost" className={`${nav} hidden max-[560px]:flex`}>
          <RefreshCw aria-hidden="true" /> <span>Sync</span>
        </Button>
        <Button id="settings-toggle" variant="ghost" className={nav}>
          <SettingsIcon aria-hidden="true" /> <span>Settings</span>
        </Button>
        <Button id="lock-app" variant="ghost" className={nav}>
          <LockKeyhole aria-hidden="true" /> <span>Lock</span>
        </Button>
      </div>
      </nav>
    </aside>
  );
}

function ItemDetail() {
  return (
    <section className={`item-detail ${panel} px-[clamp(1.5rem,4vw,4rem)] py-8 max-[800px]:fixed max-[800px]:bottom-0 max-[800px]:left-[4.5rem] max-[800px]:right-0 max-[800px]:z-10 max-[800px]:max-h-[82dvh] max-[800px]:rounded-b-none max-[800px]:bg-[#11162b]/95 max-[800px]:shadow-2xl max-[560px]:left-0 max-[560px]:max-h-[84dvh] max-[560px]:px-4 max-[560px]:py-5`}>
      <Button id="close-item-detail" variant="ghost" className="mb-3 hidden max-[800px]:inline-flex" aria-label="Close item details"><X size={17} aria-hidden="true" /> Close</Button>
      <ItemWorkspace />
      <div id="item-empty" className="grid h-full place-content-center px-6 text-center text-slate-500 [&>h2]:mb-1 [&>h2]:mt-4 [&>h2]:text-xl [&>h2]:font-bold [&>h2]:text-white">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#E0BB95]/12 text-2xl text-[#E0BB95] [&>svg]:size-6">
          <KeyRound aria-hidden="true" />
        </div>
        <h2>Select an item</h2>
        <p>Choose an item from the list or create a new item.</p>
      </div>
      <article id="item-view" hidden>
        <div className="vault-detail-heading ui-page-header flex items-start justify-between gap-4 [&_h2]:mb-1 [&_h2]:text-[1.75rem] [&_h2]:font-bold">
          <div>
            <p id="view-type" className={eyebrow}>LOGIN</p>
            <h2 id="view-title" />
            <a id="view-url" className="text-sm text-[#E0BB95] hover:underline" target="_blank" rel="noreferrer" />
          </div>
          <div className="flex flex-wrap items-center gap-1"><IconButton id="favorite-item" label="Add to favorites" aria-pressed={false}><Star size={17} /></IconButton><Button id="duplicate-item" variant="ghost">Duplicate</Button><Button id="delete-item" variant="ghost">Delete</Button><Button id="edit-item" variant="secondary">
            Edit
          </Button><span id="item-workspace-actions" className="inline-flex items-center gap-1" /></div>
        </div>
        <section id="view-signin" className={detailSection}>
          <h3>Sign in</h3>
          <div className="overflow-hidden rounded-xl border border-white/8 bg-black/5">
            <div id="view-username-row" className="vault-detail-field grid min-h-16 grid-cols-[6rem_1fr_auto] items-center gap-4 px-4 max-[560px]:grid-cols-[4.5rem_1fr] max-[560px]:gap-2">
              <span className="text-xs font-medium text-slate-500">Username</span>
              <strong id="view-username" className="min-w-0 truncate text-sm" />
              <IconButton
                id="copy-username"
                label="Copy username"
                className="!min-h-9 !border-0 !bg-transparent !px-2 !text-xs !text-[#E0BB95] shadow-none hover:!bg-[#E0BB95]/10"
              >
                <Copy size={16} aria-hidden="true" />
              </IconButton>
            </div>
            <div id="view-password-row" className="vault-detail-field grid min-h-16 grid-cols-[6rem_1fr_auto] items-center gap-4 border-t border-white/7 px-4 max-[560px]:grid-cols-[4.5rem_1fr] max-[560px]:gap-2">
              <span className="text-xs font-medium text-slate-500">Password</span>
              <strong id="view-password" className="min-w-0 truncate font-mono text-sm">
                ••••••••••••
              </strong>
              <div className="flex items-center gap-1 max-[560px]:col-start-2">
                <IconButton
                  id="reveal-password"
                  label="Reveal password"
                  aria-pressed={false}
                  className="secret-visibility !border-0 !bg-transparent !text-[#E0BB95] shadow-none hover:!bg-[#E0BB95]/10"
                >
                  <Eye size={16} className="reveal-icon" aria-hidden="true" /><EyeOff size={16} className="hide-icon" aria-hidden="true" />
                </IconButton>
                <IconButton
                  id="copy-password"
                  label="Copy password"
                  className="!min-h-9 !border-0 !bg-transparent !px-2 !text-xs !text-[#E0BB95] shadow-none hover:!bg-[#E0BB95]/10"
                >
                  <Copy size={16} aria-hidden="true" />
                </IconButton>
              </div>
            </div>
          </div>
        </section>
        <CustomFieldsView />
      </article>
      <form
        id="item-form"
        hidden
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
      >
        <input id="item-id" type="hidden" />
        <div className="vault-edit-header ui-page-header flex items-start justify-between gap-4 [&_h2]:mb-1 [&_h2]:text-[1.75rem] [&_h2]:font-bold max-[560px]:[&_h2]:text-xl">
          <div>
            <p id="form-mode" className={eyebrow}>
              NEW LOGIN
            </p>
            <h2 id="form-title">Create item</h2>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button id="cancel-edit" variant="secondary">Cancel</Button>
            <Button id="save" type="submit" disabled>Save</Button>
          </div>
        </div>
        <section className={detailSection}>
          <h3>Basics</h3>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-start"><Field label="Title"><Input id="title" maxLength={512} required aria-describedby="title-error" className="invalid:border-red-400 invalid:ring-4 invalid:ring-red-400/10" /><span id="title-error" className="hidden text-xs text-red-300">Title is required.</span></Field><ItemTypePicker /></div>
          <Field label="Website">
            <Input id="url" inputMode="url" placeholder="google.com" />
          </Field>
        </section>
        <section id="form-signin" className={detailSection}>
          <h3>Sign in</h3>
          <Field label="Username">
            <Input
              id="item-username"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
            />
          </Field>
          <label className={fieldLabel}>
            Password
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input
                id="item-password"
                type="password"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
              />
              <div className="flex gap-2">
                <IconButton id="toggle-edit-password" label="Reveal password" variant="secondary" aria-pressed={false} className="secret-visibility"><Eye size={16} className="reveal-icon" aria-hidden="true" /><EyeOff size={16} className="hide-icon" aria-hidden="true" /></IconButton>
                <WebSecretGenerator generate={generateSecret} onUse={(value) => {
                  const input = document.getElementById("item-password") as HTMLInputElement;
                  input.value = value; input.dispatchEvent(new Event("input", { bubbles: true }));
                }} />
              </div>
            </div>
          </label>
        </section>
        <section className={detailSection}>
          <CustomFieldsEditor />
        </section>
      </form>
    </section>
  );
}

function Vault() {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("127vaults:sidebar-collapsed") === "true"; } catch { return false; } });
  const collapseSidebar = () => { const next = !collapsed; setCollapsed(next); try { localStorage.setItem("127vaults:sidebar-collapsed", String(next)); } catch {} };
  const [layout, setLayout] = useState<"list" | "grid">(() => {
    try { return localStorage.getItem("127vaults:item-layout") === "grid" ? "grid" : "list"; }
    catch { return "list"; }
  });
  const changeLayout = (next: "list" | "grid") => {
    setLayout(next);
    try { localStorage.setItem("127vaults:item-layout", next); } catch { /* Storage may be disabled. */ }
  };
  return (
    <div id="vault" className={`grid h-dvh grid-cols-[15rem_1fr] grid-rows-[1fr_2rem] overflow-hidden bg-[#04071d] max-[800px]:grid-cols-1 max-[800px]:grid-rows-[3.75rem_minmax(0,1fr)] ${layout === "grid" ? "vault-grid" : ""} ${collapsed ? "sidebar-collapsed" : ""}`} hidden>
      <Sidebar collapsed={collapsed} onCollapse={collapseSidebar} />
      <main className="grid min-w-0 grid-rows-[4.25rem_1fr] overflow-hidden max-[800px]:col-start-1 max-[800px]:row-start-2 max-[800px]:h-full max-[560px]:grid-rows-[4rem_1fr]">
        <header className="flex items-center justify-between gap-5 border-b border-white/5 px-5 backdrop-blur max-[560px]:px-3">
          <div className="vault-search flex h-12 w-full max-w-2xl items-center gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,.03)] transition focus-within:border-[#E0BB95]/60 focus-within:bg-white/8 focus-within:ring-4 focus-within:ring-[#E0BB95]/10 max-[560px]:max-w-none">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <Input
              id="search"
              type="search"
              placeholder="Search items and actions"
              className="min-h-0 border-0 bg-transparent px-0 shadow-none focus:border-0 focus:ring-0"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-500">
            <Button id="new-item" className="shrink-0 max-[560px]:h-11 max-[560px]:!px-3 max-[560px]:text-xs">
              <Plus aria-hidden="true" />
              <span>New item</span>
            </Button>
          </div>
        </header>
        <div className="vault-content grid min-h-0 grid-cols-[minmax(19rem,36%)_1fr] gap-3 p-3 max-[800px]:grid-cols-1 max-[560px]:h-full max-[560px]:p-2">
          <section className={`vault-browser ${panel} p-5 max-[560px]:p-4`} aria-label="Vault items">
            <div className="vault-browser-heading flex items-start justify-between gap-3 max-[560px]:flex-wrap [&_h1]:mb-1 [&_h1]:text-2xl [&_h1]:font-bold [&_span]:text-xs [&_span]:text-slate-500">
              <div>
                <p id="vault-label" className={eyebrow}>PRIVATE VAULT</p>
                <h1 id="vault-title">Private</h1>
                <span id="vault-state">No vault</span>
              </div>
              <div className="vault-browser-actions flex items-center gap-2">
                <div className="vault-layout-toggle rounded-xl border border-white/10 bg-white/4 p-1" role="group" aria-label="Item layout">
                  <button type="button" className={`rounded-lg p-2 ${layout === "list" ? "bg-[#E0BB95]/15 text-[#E0BB95]" : "text-slate-400 hover:text-white"}`} aria-label="List view" aria-pressed={layout === "list"} onClick={() => changeLayout("list")}><LayoutList size={17} /></button>
                  <button type="button" className={`rounded-lg p-2 ${layout === "grid" ? "bg-[#E0BB95]/15 text-[#E0BB95]" : "text-slate-400 hover:text-white"}`} aria-label="Grid view" aria-pressed={layout === "grid"} onClick={() => changeLayout("grid")}><LayoutGrid size={17} /></button>
                </div>
              </div>
            </div>
            <div id="items" className="mt-5 grid gap-1.5" role="list">
              <ItemList layout={layout} />
            </div>
          </section>
          <ItemDetail />
        </div>
      </main>
      <footer id="session-footer" className="relative col-start-2 flex items-center gap-3 border-t border-white/5 px-4 text-[10px] text-slate-500 max-[560px]:hidden" title="Right-click for sync options">
        <span className="inline-block size-1.5 rounded-full bg-sky-400 ring-4 ring-sky-400/10" />
        <b>Personal server</b>
        <span>Private connection</span>
        <span id="session-dates" className="ml-auto">Local change — · Server sync —</span>
        <Button id="footer-inline-sync" size="sm" variant="ghost" className="!h-6 !min-h-6 px-2 text-xs" onClick={() => document.getElementById("reload")?.click()}>Sync now</Button>
        <div id="session-menu" className="absolute bottom-7 right-3 z-40 hidden w-64 rounded-xl border border-white/10 bg-[#11162b] p-1 text-sm text-slate-100 shadow-2xl">
          <button id="footer-sync" className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/8">Sync now</button>
          <button id="footer-use-server" className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/8">Discard local edits and use server…</button>
        </div>
      </footer>
    </div>
  );
}

function Settings() {
  const settingsTab = "settings-tab";
  const [activeTab, setActiveTab] = useState<"profile" | "devices" | "vaults" | "preferences">("profile");
  const [vaults, setVaults] = useState<WebVaultSummary[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [activeTab]);
  useEffect(() => { const tab = (event: Event) => setActiveTab((event as CustomEvent<typeof activeTab>).detail); const update = (event: Event) => setVaults((event as CustomEvent<WebVaultSummary[]>).detail); window.addEventListener("vaults:settings-view", tab); window.addEventListener("vaults:vaults", update); if ((window as any).__vaultsSnapshot) setVaults((window as any).__vaultsSnapshot); return () => { window.removeEventListener("vaults:settings-view", tab); window.removeEventListener("vaults:vaults", update); }; }, []);
  return (
    <dialog id="settings" className="web-settings-dialog" aria-labelledby="web-settings-title">
      <div className="web-settings">
        <aside className="web-settings-nav">
          <h2 id="web-settings-title">Settings</h2>
          <nav aria-label="Settings sections">{(["profile", "devices", "vaults", "preferences"] as const).map((tab) => <Button key={tab} variant="ghost" className={`${settingsTab} ${activeTab === tab ? "active" : ""}`} aria-current={activeTab === tab ? "page" : undefined} aria-controls={`settings-${tab}`} data-settings-view={tab}>{tab === "profile" ? <KeyRound size={17} aria-hidden="true" /> : tab === "devices" ? <PanelsTopLeft size={17} aria-hidden="true" /> : tab === "vaults" ? <VaultIcon size={17} aria-hidden="true" /> : <SettingsIcon size={17} aria-hidden="true" />}<span>{tab[0].toUpperCase() + tab.slice(1)}</span></Button>)}</nav>
        </aside>
        <div className="web-settings-main">
          <header className="web-settings-header">
            <div><h3 id="web-settings-panel-title">{activeTab[0].toUpperCase() + activeTab.slice(1)}</h3><p>{activeTab === "profile" ? "Your account and security in this browser." : activeTab === "devices" ? "Manage devices registered to your account." : activeTab === "vaults" ? "Manage your encrypted vaults." : "Choose how this browser handles your session and copied values."}</p></div>
            <Button id="close-settings" variant="ghost" className="settings-close" aria-label="Close settings" title="Close settings"><X size={18} /></Button>
          </header>
          <div ref={bodyRef} className="web-settings-body text-sm">
        <section className="web-settings-panel" aria-labelledby="web-settings-panel-title" id="settings-profile" hidden={activeTab !== "profile"}>
          <div className="grid gap-1 rounded-xl border border-white/8 bg-white/3 p-4">
            <span className="text-xs text-slate-500">Username</span>
            <strong id="profile-username" />
          </div>
          <div className="mt-3 grid gap-1 rounded-xl border border-white/8 bg-white/3 p-4"><span className="text-xs text-slate-500">Device ID</span><code id="profile-device" className="break-all text-xs" /></div>
          <div className="mt-3 grid gap-1 rounded-xl border border-white/8 bg-white/3 p-4"><span className="text-xs text-slate-500">Account secret</span><span id="profile-secret-status" className="text-sm" /></div>
          <PwaControls />
          <section id="cloud-family" className="mt-5 grid gap-3 rounded-xl border border-white/10 p-4" hidden>
            <h4 className="font-semibold">Family members</h4>
            <p id="cloud-family-status" role="status" />
            <form id="cloud-family-invite" className="grid gap-2" hidden>
              <Field label="Member email"><Input id="cloud-family-email" type="email" required /></Field>
              <Button type="submit">Create invitation</Button>
            </form>
            <div id="cloud-family-link" className="grid gap-2" hidden>
              <Field label="Private invitation link"><Input id="cloud-family-url" readOnly /></Field>
              <Button id="cloud-family-copy" type="button" variant="secondary">Copy invitation link</Button>
            </div>
            <ul id="cloud-family-members" className="grid gap-2" />
            <ul id="cloud-family-invitations" className="grid gap-2" />
          </section>
        </section>
        <section className="web-settings-panel" aria-labelledby="web-settings-panel-title" id="settings-preferences" hidden={activeTab !== "preferences"}>
          <KeyboardHelp />
          <div className="mt-6 grid gap-5 text-sm"><label className="grid gap-2">Lock after inactivity<select id="preference-lock-minutes" className="rounded-xl border border-white/10 bg-[#11162b] p-3 text-white"><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option></select></label><label className="grid gap-2">Clear copied values after<select id="preference-clipboard-seconds" className="rounded-xl border border-white/10 bg-[#11162b] p-3 text-white"><option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option></select></label></div>
        </section>
        <section className="web-settings-panel" aria-labelledby="web-settings-panel-title" id="settings-vaults" hidden={activeTab !== "vaults"}><div className="grid gap-2">{vaults.map((vault) => <div key={vault.vaultId} className="flex items-center gap-2 rounded-xl border border-white/10 p-1"><Button variant={vault.selected ? "secondary" : "ghost"} className="min-w-0 flex-1 justify-start" onClick={() => (window as any).__vaultsActions.selectVault(vault.vaultId)}><VaultIcon size={17} /><span className="truncate">{vault.name}</span>{vault.selected ? " · Current" : ""}</Button><Button variant="ghost" onClick={() => (window as any).__vaultsActions.openRenameVaultDialog(vault.vaultId)}>Rename</Button></div>)}</div><Button id="settings-create-vault" className="mt-5" onClick={() => (window as any).__vaultsActions.openCreateVaultDialog()}>Create vault</Button><CollectionsSettings vaults={vaults} /><VaultLifecycleSettings vaults={vaults} /></section>
        <section className="web-settings-panel" aria-labelledby="web-settings-panel-title" id="settings-devices" hidden={activeTab !== "devices"}>
          <div id="devices-list-page">
            <OwnershipRequests />
            <Button id="show-device-registration">Register a device</Button>
            <div id="device-status" className={`inline-status ${inlineStatus}`} role="status" />
            <DeviceList />
            <Button id="reload-devices" variant="secondary">
              Refresh devices
            </Button>
          </div>
          <div id="device-registration-page" hidden>
            <Button
              id="cancel-device-registration"
              variant="ghost"
              className={backButton}
            >
              ← Cancel
            </Button>
            <h2>Register a CLI device</h2>
            <p className={muted}>
              Run CLI login with <code>--enroll</code>, then enter its
              8-character code.
            </p>
            <label className={fieldLabel}>
              Enrollment code
              <textarea className="min-h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#E0BB95] focus:ring-4 focus:ring-[#E0BB95]/10" id="enrollment-request" rows={1} spellCheck={false} />
            </label>
            <Button id="begin-enrollment">Register device</Button>
            <textarea className="min-h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100" id="enrollment-approval" hidden readOnly />
            <textarea className="min-h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100" id="enrollment-completion" hidden />
            <Button id="complete-enrollment" hidden>
              Complete enrollment
            </Button>
            <div
              id="enrollment-status"
              className={`inline-status ${inlineStatus}`}
              role="status"
            />
          </div>
        </section>
          </div>
        </div>
      </div>
    </dialog>
  );
}

export function App() {
  useEffect(() => {
    const client = "/app/mvp-client.mjs";
    import(/* @vite-ignore */ client).catch((error) => {
      console.error("127Vaults secure client could not start", error);
      window.dispatchEvent(new CustomEvent("vaults:toast", { detail: { title: "Vault controls are unavailable", detail: "Reload the page. If this continues, rebuild the browser fixture and restart the local server.", kind: "error" } }));
      const message = document.getElementById("message");
      if (message) {
        message.className =
          "notice error my-5 rounded-xl border border-red-400/25 bg-red-400/10 px-3.5 py-3 text-sm text-red-200";
        message.textContent =
          "The secure client could not start. Reload the page or check the server build.";
      }
    });
  }, []);
  return (
    <AppErrorBoundary>
      <PwaLifecycle />
      <Authentication />
      <Vault />
      <Settings />
      <ToastRegion />
      <CollectionDialog />
      <dialog aria-labelledby="sync-review-title" id="sync-review-dialog" className="ui-dialog border border-white/10 bg-[#11162b] text-slate-100"><h2 id="sync-review-title" className="text-xl font-bold" /><p id="sync-review-detail" className="mt-3 text-sm text-slate-400" /><select id="sync-review-destination" aria-label="Recovery vault" hidden className="mt-4 w-full rounded-xl border border-white/10 bg-[#11162b] p-3 text-white" /><div className="ui-dialog-actions ui-dialog-actions-stack"><Button id="sync-review-mine">Keep my offline changes</Button><Button id="sync-review-server" variant="secondary">Use server version</Button><Button id="sync-review-later" variant="ghost">Review later</Button></div></dialog>
      <dialog aria-labelledby="browser-enrollment-title" id="browser-enrollment-dialog" className="ui-dialog border border-white/10 bg-[#11162b] text-slate-100"><h2 className="text-xl font-bold" id="browser-enrollment-title">Register this device</h2><p className="mt-3 text-sm text-slate-400">On an already registered device, unlock 127Vaults and open Settings → Devices → Register a device. Approve this one-time code:</p><output id="browser-enrollment-code" className="my-5 block text-center font-mono text-3xl tracking-widest" /><p id="browser-enrollment-status" className="text-sm text-slate-400" role="status" /><div className="ui-dialog-actions"><Button id="browser-enrollment-cancel" variant="secondary">Cancel</Button><Button id="browser-enrollment-check">Check approval</Button></div></dialog>
      <dialog aria-labelledby="web-vault-dialog-title" id="web-create-vault-dialog" className="ui-dialog border border-white/10 bg-[#11162b] text-slate-100"><form id="web-create-vault-form"><h2 id="web-vault-dialog-title" className="text-xl font-bold">Create vault</h2><p className="mt-2 text-sm text-slate-400">Your vault name is stored in encrypted account settings.</p><label className="mt-5 grid gap-2 text-sm">Vault name<Input id="web-vault-name" autoFocus maxLength={80} required /></label><div className="ui-dialog-actions"><Button id="web-create-vault-cancel" type="button" variant="secondary">Cancel</Button><Button id="web-create-vault-submit" type="submit">Create vault</Button></div></form></dialog>
      <dialog aria-labelledby="web-conflict-title" id="conflict-dialog" className="ui-dialog ui-dialog-wide border border-amber-300/20 bg-[#11162b] text-slate-100">
        <h2 className="text-xl font-bold" id="web-conflict-title">Resolve sync conflict</h2>
        <p id="conflict-detail" className="mt-2 text-sm leading-6 text-slate-400">This item changed on another device while you were editing it. Choose which version to keep.</p>
        <div id="merge-fields" className="mt-5 hidden max-h-[50dvh] overflow-auto rounded-xl border border-white/10" />
        <div className="ui-dialog-actions ui-dialog-actions-stack"><Button id="conflict-merge">Merge field by field…</Button><Button id="conflict-apply-merge" className="hidden">Use merged version</Button><Button id="conflict-keep" variant="secondary">Keep my changes and retry</Button><Button id="conflict-server" variant="secondary">Use server version</Button><Button id="conflict-cancel" variant="ghost">Cancel and keep editing</Button></div>
      </dialog>
      <dialog aria-labelledby="confirm-title" id="confirm-dialog" className="ui-dialog border border-white/10 bg-[#11162b] text-slate-100"><h2 id="confirm-title" className="text-xl font-bold"/><p id="confirm-detail" className="mt-2 text-sm leading-6 text-slate-400"/><div className="ui-dialog-actions"><Button id="confirm-cancel" variant="secondary">Cancel</Button><Button id="confirm-accept">Continue</Button></div></dialog>
    </AppErrorBoundary>
  );
}
