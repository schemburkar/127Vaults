import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import {
  KeyRound,
  LayoutList,
  LockKeyhole,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Vault as VaultIcon,
  X,
} from "lucide-react";
import { Button, Input } from "@127vaults/ui";
import { QRCodeSVG } from "qrcode.react";
import { ITEM_TYPES, TYPE_GROUPS, SECTION_TYPES, TYPE_FIELD_ID, SECTION_PREFIX, SECTION_FIELD_PREFIX, addSection, itemType, ordinaryFields, primaryFields, removeSection, sections, setItemType, type ItemType, type ItemField, type SectionType } from "../../desktop/src/item-types";

const eyebrow = "mb-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500";
const muted = "text-slate-400";
const fieldLabel = "grid gap-2 text-[13px] font-semibold text-slate-400";
const panel = "overflow-auto rounded-[1.25rem] border border-white/7 bg-[#46484821] shadow-[0_14px_36px_-24px_rgba(0,0,0,.8)] backdrop-blur-sm";
const detailSection = "mt-7 [&>h3]:mb-3 [&>h3]:text-xs [&>h3]:font-bold [&>h3]:uppercase [&>h3]:tracking-[0.08em] [&>h3]:text-slate-500 [&>label+label]:mt-4";
const inlineStatus = "inline-block min-h-5 text-xs text-slate-500";
const backButton = "mb-3 w-fit !px-1 text-[#E0BB95]";

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
  row: { itemId: string };
  index: { title?: string; website?: string };
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

function ToastRegion() {
  const [notices, setNotices] = useState<ToastNotice[]>([]);
  useEffect(() => {
    const add = (event: Event) => {
      const notice = (event as CustomEvent<Omit<ToastNotice, "id">>).detail;
      const id = crypto.randomUUID();
      setNotices((current) => [...current, { ...notice, id }]);
      window.setTimeout(() => setNotices((current) => current.filter((row) => row.id !== id)), notice.kind === "error" ? 8000 : 4500);
    };
    window.addEventListener("vaults:toast", add);
    return () => window.removeEventListener("vaults:toast", add);
  }, []);
  return <div className="pointer-events-none fixed right-5 top-5 z-[70] grid w-[min(22rem,calc(100vw-2rem))] gap-2" aria-live="polite" aria-label="Notifications">{notices.map((notice) => <div key={notice.id} className={`pointer-events-auto rounded-xl border p-4 shadow-2xl ${notice.kind === "error" ? "border-red-400/25 bg-[#2a1118]" : notice.kind === "success" ? "border-emerald-400/25 bg-[#10251f]" : "border-white/10 bg-[#11162b]"}`}><strong className="block text-sm">{notice.title}</strong>{notice.detail && <p className="mt-1 text-xs leading-5 text-slate-400">{notice.detail}</p>}</div>)}</div>;
}

function CustomFieldsEditor() {
  const [fields, setFields] = useState<ItemField[]>([]);
  useEffect(() => {
    const set = (event: Event) => setFields((event as CustomEvent<ItemField[]>).detail.map((field) => ({ ...field })));
    const add = (event: Event) =>
      setFields((current) =>
        ordinaryFields(current).length >= 32
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
    window.addEventListener("vaults:add-editor-field", add);
    return () => {
      window.removeEventListener("vaults:set-editor-fields", set);
      window.removeEventListener("vaults:add-editor-field", add);
    };
  }, []);
  const update = (id: string, patch: Partial<CustomField>) =>
    setFields((current) =>
      current.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    );
  return (
    <div id="custom-fields" className="mt-3 grid gap-2">
      <label className={fieldLabel}>Item type
        <select id="item-type" className="min-h-11 rounded-xl border border-white/10 bg-[#11162b] px-3 text-sm text-white" value={itemType(fields)} onChange={(event) => { const type = event.target.value as ItemType; setFields((current) => setItemType(current, type)); window.dispatchEvent(new CustomEvent("vaults:item-type", { detail: type })); }}>
          {TYPE_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.types.map((type) => <option key={type} value={type}>{ITEM_TYPES[type].label}</option>)}</optgroup>)}
        </select>
      </label>
      {fields.filter((field) => field.id === TYPE_FIELD_ID || field.id.startsWith(SECTION_PREFIX)).map((field) => <input key={field.id} type="hidden" data-field-id={field.id} data-field-label={field.label} data-field-type={field.type} value={field.value} readOnly />)}
      {primaryFields(fields).length > 0 && <h4 className="mt-4 text-xs font-bold uppercase text-[#E0BB95]">{ITEM_TYPES[itemType(fields)].label} fields</h4>}
      {primaryFields(fields).map((field) => <label key={field.id} className={fieldLabel}>{field.label}<input data-field-id={field.id} data-field-label={field.label} data-field-type={field.type} className="typed-value min-h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white" type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"} value={field.value} onChange={(event) => update(field.id, { value: event.target.value })} /></label>)}
      {sections(fields).map((section) => <div key={section.id} className="mt-4 grid gap-3 rounded-xl border border-white/10 p-4"><div className="flex items-center justify-between"><h4 className="text-sm font-bold text-[#E0BB95]">{section.label}</h4><Button size="sm" variant="ghost" onClick={() => setFields((current) => removeSection(current, section.id))}>Remove section</Button></div>{section.fields.map((field) => <label key={field.id} className={fieldLabel}>{field.label}<input data-field-id={field.id} data-field-label={field.label} data-field-type={field.type} className="typed-value min-h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white" type={field.type === "password" ? "password" : "text"} value={field.value} onChange={(event) => update(field.id, { value: event.target.value })} /></label>)}</div>)}
      <label className={fieldLabel}>Add section<select className="min-h-11 rounded-xl border border-white/10 bg-[#11162b] px-3 text-sm text-white" value="" onChange={(event) => { setFields((current) => addSection(current, event.target.value as SectionType)); event.target.value = ""; }}><option value="">Choose a section…</option>{Object.entries(SECTION_TYPES).map(([type, template]) => <option key={type} value={type}>{template.label}</option>)}</select></label>
      <h4 className="mt-4 text-xs font-bold uppercase text-[#E0BB95]">Custom fields</h4>
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
            <select
              className="min-h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#E0BB95] focus:ring-4 focus:ring-[#E0BB95]/10"
              value={field.type || "text"}
              aria-label={`Custom field ${index + 1} type`}
              onChange={(event) => update(id, { type: event.target.value })}
            >
              {[
                "text",
                "password",
                "url",
                "date",
                "email",
                "number",
                "note",
              ].map((kind) => (
                <option key={kind} value={kind}>
                  {kind[0].toUpperCase() + kind.slice(1)}
                </option>
              ))}
            </select>
            {field.type === "note" ? (
              <textarea
                className={`${inputClass} min-h-20 resize-y`}
                value={field.value ?? ""}
                aria-label={`Custom field ${index + 1} value`}
                onChange={(event) => update(id, { value: event.target.value })}
              />
            ) : (
              <input
                className={inputClass}
                type={
                  field.type === "password" ? "password" : field.type || "text"
                }
                value={field.value ?? ""}
                aria-label={`Custom field ${index + 1} value`}
                onChange={(event) => update(id, { value: event.target.value })}
              />
            )}
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
    return <div key={field.id} className="grid min-h-16 grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-2 border-t border-white/7 px-3 max-[560px]:grid-cols-[5rem_minmax(0,1fr)]">
      <span className="text-xs font-medium text-slate-500">{field.label}</span>
      <strong className={`min-w-0 break-all text-sm ${secret ? "font-mono" : ""}`}>{secret && !shown ? "••••••••••••" : field.value || "—"}</strong>
      <div className="flex gap-1 max-[560px]:col-start-2">{secret && <Button variant="ghost" size="sm" onClick={() => setRevealed((current) => { const next = new Set(current); shown ? next.delete(field.id) : next.add(field.id); return next; })}>{shown ? "Hide" : "Reveal"}</Button>}<Button variant="ghost" size="sm" onClick={() => copy(field.value)}>Copy</Button></div>
    </div>;
  };
  const ssid = fields.find((field) => field.id === "ssid")?.value;
  const security = fields.find((field) => field.id === "wifi_security")?.value || "WPA";
  const escapeWifi = (value: string) => value.replace(/([\\;,:"])/g, "\\$1");
  return (
    <div id="view-custom-fields">
      {primaryFields(fields).length > 0 && <h4 className="border-t border-white/10 px-3 py-2 text-xs font-bold uppercase text-[#E0BB95]">{ITEM_TYPES[itemType(fields)].label}</h4>}
      {primaryFields(fields).map(renderField)}
      {sections(fields).map((section) => <section key={section.id}><h4 className="border-t border-white/10 px-3 py-2 text-xs font-bold uppercase text-[#E0BB95]">{section.label}</h4>{section.fields.map(renderField)}</section>)}
      {ordinaryFields(fields).map(renderField)}
      {itemType(fields) === "wifi" && ssid && <div className="border-t border-white/10 p-4"><Button variant="secondary" onClick={() => setShowQr((current) => !current)}>{showQr ? "Hide join QR" : "Show Wi-Fi join QR"}</Button>{showQr && <div className="mt-3 inline-grid gap-2 rounded-xl bg-white p-4 text-slate-900"><QRCodeSVG size={180} value={`WIFI:T:${escapeWifi(security)};S:${escapeWifi(ssid)};P:${escapeWifi(wifiPassword)};;`} /><span className="text-xs">Scan to join {ssid}</span></div>}</div>}
    </div>
  );
}

function ItemList() {
  const [view, setView] = useState<{
    items: ItemSummary[];
    actions: SearchAction[];
    selectedId: string | null;
    empty: string;
  }>({ items: [], actions: [], selectedId: null, empty: "This vault has no items yet." });
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
      <p className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-500">
        {view.empty}
      </p>
    );
  return (
    <>
      {(view.actions ?? []).map((action) => (
        <button key={action.id} className="mb-1 flex min-h-14 w-full items-center gap-3 rounded-xl border border-[#E0BB95]/20 bg-[#E0BB95]/8 px-3 text-left hover:bg-[#E0BB95]/14" onClick={() => (window as any).__vaultsActions.runAction(action.id)}>
          <Search className="size-4 shrink-0 text-[#E0BB95]" aria-hidden="true" />
          <span className="min-w-0"><b className="block text-sm">{action.label}</b><small className="block truncate text-[11px] text-slate-500">{action.description}</small></span>
        </button>
      ))}
      {view.items.map((item) => (
        <button
          key={item.row.itemId}
          data-item-id={item.row.itemId}
          className={`grid min-h-16 w-full cursor-pointer grid-cols-[2.75rem_1fr_auto] items-center gap-3 rounded-xl border p-2.5 text-left text-slate-100 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#E0BB95]/10 ${view.selectedId === item.row.itemId ? "border-[#E0BB95]/35 bg-[#E0BB95]/12" : "border-transparent bg-transparent hover:bg-[#E0BB95]/10"}`}
          onClick={(event) =>
            (window as any).__vaultsActions.openItem(item, event.currentTarget)
          }
        >
          <span className={`grid size-11 place-items-center rounded-xl text-sm font-extrabold ${view.selectedId === item.row.itemId ? "bg-[#E0BB95]/18 text-[#E0BB95]" : "bg-white/7 text-slate-300"}`}>
            {(item.index.title || "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <b className="block truncate text-sm font-semibold">
              {item.index.title || "Untitled"}
            </b>
            <small className="block truncate text-[11px] text-[#E0BB95]">
              {item.index.website || "No website"}
            </small>
          </span>
          <span className="text-slate-600">›</span>
        </button>
      ))}
    </>
  );
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
function Brand({ entry = false }: { entry?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${entry ? "entry-brand mb-8" : "brand px-2 pb-7 pt-2 max-[560px]:p-1"}`}>
      <i className={`grid place-items-center rounded-xl bg-[#9D1F32] text-[11px] font-black not-italic text-white shadow-sm ${entry ? "size-10" : "size-9"}`}>127</i>
      <b className="text-[15px] font-bold tracking-[-0.02em] text-white max-[800px]:hidden">127Vaults</b>
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
      <p className={eyebrow}>FIRST USER REGISTRATION</p>
      <h1 className="mb-2 text-[2rem] font-bold tracking-[-0.025em]">Create your account</h1>
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
        <Field label="Bootstrap code">
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
      <span id="setup-status" className={`inline-status ${inlineStatus}`} role="status" />
    </div>
  );
}

function Authentication() {
  return (
    <div id="entry-shell" className="grid min-h-dvh place-items-center overflow-auto bg-[radial-gradient(circle_at_top,#18203d,#04071d_58%)] p-6 max-[560px]:p-3">
      <section id="access" className="w-full max-w-[35rem] rounded-[1.75rem] border border-white/10 bg-[#11162b] p-10 shadow-[0_28px_80px_-30px_rgba(0,0,0,.75)] max-[560px]:rounded-[1.25rem] max-[560px]:p-6">
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
              Account secret (one-time device upgrade)
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
            Not registered on this device? Register device
          </Button>
          <Button id="lock" hidden disabled>
            Lock
          </Button>
        </div>
        <Registration />
      </section>
    </div>
  );
}

function Sidebar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [vaults, setVaults] = useState<WebVaultSummary[]>([]);
  useEffect(() => { const update = (event: Event) => setVaults((event as CustomEvent<WebVaultSummary[]>).detail); window.addEventListener("vaults:vaults", update); return () => window.removeEventListener("vaults:vaults", update); }, []);
  const nav = "nav !min-h-11 w-full justify-start !border-0 !bg-transparent !px-3 text-slate-400 shadow-none hover:!bg-[#E0BB95]/10 hover:!text-[#E0BB95] max-[560px]:h-14 max-[560px]:min-w-0 max-[560px]:flex-1 max-[560px]:gap-1.5 max-[560px]:!px-2 max-[560px]:text-[10px] [&>svg]:size-4 [&>svg]:shrink-0 [&>span]:min-w-0 [&>span]:shrink [&>span]:truncate [&>span]:text-left [&>b]:ml-auto [&>b]:rounded-full [&>b]:bg-white/10 [&>b]:px-2 [&>b]:py-0.5 [&>b]:text-[10px] max-[560px]:[&>b]:hidden";
  return (
    <aside className={`sidebar row-span-2 flex flex-col p-3 text-white ${menuOpen ? "menu-open" : ""}`}>
      <Brand />
      <Button variant="ghost" className="mobile-menu-toggle" aria-label="Toggle navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Menu size={18} /><span>Vaults</span></Button>
      <nav className="sidebar-links flex min-h-0 flex-1 flex-col" aria-label="Main navigation" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) setMenuOpen(false); }}>
      <Button id="nav-all-items" variant="ghost" className={`${nav} active !bg-[#E0BB95]/12 !text-[#E0BB95]`}>
        <LayoutList aria-hidden="true" /> <span>All items</span>
        <b id="nav-count">0</b>
      </Button>
      <p className="mb-2 mt-6 px-3 text-[9px] font-bold tracking-[0.18em] text-slate-500 max-[800px]:hidden">VAULTS</p>
      {vaults.map((vault) => <Button key={vault.vaultId} variant="ghost" className={`${nav} ${vault.selected ? "active !bg-[#E0BB95]/12 !text-[#E0BB95]" : ""}`} onClick={() => (window as any).__vaultsActions.selectVault(vault.vaultId)}><VaultIcon aria-hidden="true" /><span>{vault.name}</span></Button>)}
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
      <Button id="close-item-detail" variant="ghost" className="mb-3 hidden max-[800px]:inline-flex">← Items</Button>
      <div id="item-empty" className="grid h-full place-content-center px-6 text-center text-slate-500 [&>h2]:mb-1 [&>h2]:mt-4 [&>h2]:text-xl [&>h2]:font-bold [&>h2]:text-white">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#E0BB95]/12 text-2xl text-[#E0BB95] [&>svg]:size-6">
          <KeyRound aria-hidden="true" />
        </div>
        <h2>Select an item</h2>
        <p>Choose an item from the list or create a new item.</p>
      </div>
      <article id="item-view" hidden>
        <div className="flex items-start justify-between gap-4 [&_h2]:mb-1 [&_h2]:text-[1.75rem] [&_h2]:font-bold">
          <div>
            <p id="view-type" className={eyebrow}>LOGIN</p>
            <h2 id="view-title" />
            <a id="view-url" className="text-sm text-[#E0BB95] hover:underline" target="_blank" rel="noreferrer" />
          </div>
          <Button id="edit-item" variant="secondary">
            Edit
          </Button>
        </div>
        <section id="view-signin" className={detailSection}>
          <h3>Sign in</h3>
          <div className="overflow-hidden rounded-xl border border-white/8 bg-black/5">
            <div id="view-username-row" className="grid min-h-16 grid-cols-[6rem_1fr_auto] items-center gap-4 px-4 max-[560px]:grid-cols-[4.5rem_1fr] max-[560px]:gap-2">
              <span className="text-xs font-medium text-slate-500">Username</span>
              <strong id="view-username" className="min-w-0 truncate text-sm" />
              <Button
                id="copy-username"
                variant="ghost"
                className="!min-h-9 !border-0 !bg-transparent !px-2 !text-xs !text-[#E0BB95] shadow-none hover:!bg-[#E0BB95]/10"
              >
                Copy
              </Button>
            </div>
            <div id="view-password-row" className="grid min-h-16 grid-cols-[6rem_1fr_auto] items-center gap-4 border-t border-white/7 px-4 max-[560px]:grid-cols-[4.5rem_1fr] max-[560px]:gap-2">
              <span className="text-xs font-medium text-slate-500">Password</span>
              <strong id="view-password" className="min-w-0 truncate font-mono text-sm">
                ••••••••••••
              </strong>
              <div className="flex items-center gap-1 max-[560px]:col-start-2">
                <Button
                  id="reveal-password"
                  variant="ghost"
                  className="!min-h-9 !border-0 !bg-transparent !px-2 !text-xs !text-[#E0BB95] shadow-none hover:!bg-[#E0BB95]/10"
                >
                  Reveal
                </Button>
                <Button
                  id="copy-password"
                  variant="ghost"
                  className="!min-h-9 !border-0 !bg-transparent !px-2 !text-xs !text-[#E0BB95] shadow-none hover:!bg-[#E0BB95]/10"
                >
                  Copy
                </Button>
              </div>
            </div>
            <CustomFieldsView />
          </div>
        </section>
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
        <div className="flex items-start justify-between gap-4 max-[560px]:sticky max-[560px]:top-0 max-[560px]:z-10 max-[560px]:-mx-4 max-[560px]:-mt-5 max-[560px]:border-b max-[560px]:border-white/10 max-[560px]:bg-[#11162b] max-[560px]:px-4 max-[560px]:py-3 [&_h2]:mb-1 [&_h2]:text-[1.75rem] [&_h2]:font-bold max-[560px]:[&_h2]:text-xl">
          <div>
            <p id="form-mode" className={eyebrow}>
              NEW LOGIN
            </p>
            <h2 id="form-title">Create item</h2>
          </div>
          <div className="hidden shrink-0 gap-2 max-[560px]:flex">
            <Button size="sm" onClick={() => (document.getElementById("item-form") as HTMLFormElement)?.requestSubmit()}>Save</Button>
            <Button size="sm" variant="secondary" onClick={() => document.getElementById("cancel-edit")?.click()}>Cancel</Button>
          </div>
        </div>
        <section className={detailSection}>
          <h3>Basics</h3>
          <Field label="Title">
            <Input id="title" maxLength={512} required aria-describedby="title-error" className="invalid:border-red-400 invalid:ring-4 invalid:ring-red-400/10" />
            <span id="title-error" className="hidden text-xs text-red-300">Title is required.</span>
          </Field>
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
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input
                id="item-password"
                type="password"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
              />
              <Button id="toggle-edit-password" variant="secondary">
                Reveal
              </Button>
            </div>
          </label>
        </section>
        <section className={detailSection}>
          <div className="flex items-center justify-between gap-3 [&>h3]:mb-0">
            <h3>Custom fields</h3>
            <Button id="add-custom-field" variant="secondary">
              <Plus aria-hidden="true" /> Add field
            </Button>
          </div>
          <CustomFieldsEditor />
        </section>
        <div className="sticky bottom-0 -mx-3 mt-7 flex justify-end gap-2 border-t border-white/7 px-3 pb-1 pt-4 max-[560px]:hidden">
          <Button id="save" type="submit" disabled>
            Save
          </Button>
          <Button id="cancel-edit" variant="secondary">
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}

function Vault() {
  return (
    <div id="vault" className="grid h-dvh grid-cols-[15rem_1fr] grid-rows-[1fr_2rem] overflow-hidden bg-[#04071d] max-[800px]:grid-cols-[4.5rem_1fr] max-[560px]:grid-cols-1 max-[560px]:grid-rows-[3.75rem_minmax(0,1fr)]" hidden>
      <Sidebar />
      <main className="grid min-w-0 grid-rows-[4.25rem_1fr] overflow-hidden max-[560px]:col-start-1 max-[560px]:row-start-2 max-[560px]:h-full max-[560px]:grid-rows-[4rem_1fr]">
        <header className="flex items-center justify-between gap-5 border-b border-white/5 px-5 backdrop-blur max-[560px]:px-3">
          <div className="flex h-12 w-full max-w-2xl items-center gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,.03)] transition focus-within:border-[#E0BB95]/60 focus-within:bg-white/8 focus-within:ring-4 focus-within:ring-[#E0BB95]/10 max-[560px]:max-w-none">
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
        <div className="grid min-h-0 grid-cols-[minmax(19rem,36%)_1fr] gap-3 p-3 max-[800px]:grid-cols-1 max-[560px]:h-full max-[560px]:p-2">
          <section className={`${panel} p-5 max-[560px]:p-4`}>
            <div className="flex items-start justify-between gap-3 max-[560px]:flex-wrap [&_h1]:mb-1 [&_h1]:text-2xl [&_h1]:font-bold [&_span]:text-xs [&_span]:text-slate-500">
              <div>
                <p id="vault-label" className={eyebrow}>PRIVATE VAULT</p>
                <h1 id="vault-title">Private</h1>
                <span id="vault-state">No vault</span>
              </div>
              <Button id="create-vault" variant="secondary">
                Create vault
              </Button>
            </div>
            <div id="items" className="mt-5 grid gap-1.5" role="list">
              <ItemList />
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
        <div id="session-menu" className="absolute bottom-7 right-3 z-40 hidden w-64 rounded-xl border border-white/10 bg-[#11162b] p-1 text-sm text-slate-100 shadow-2xl">
          <button id="footer-sync" className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/8">Sync now</button>
          <button id="footer-use-server" className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/8">Discard local edits and use server…</button>
        </div>
      </footer>
    </div>
  );
}

function Settings() {
  const settingsTab = "settings-tab w-full justify-start";
  const [activeTab, setActiveTab] = useState<"profile" | "devices" | "vaults" | "preferences">("profile");
  const [vaults, setVaults] = useState<WebVaultSummary[]>([]);
  useEffect(() => { const tab = (event: Event) => setActiveTab((event as CustomEvent<typeof activeTab>).detail); const update = (event: Event) => setVaults((event as CustomEvent<WebVaultSummary[]>).detail); window.addEventListener("vaults:settings-view", tab); window.addEventListener("vaults:vaults", update); return () => { window.removeEventListener("vaults:settings-view", tab); window.removeEventListener("vaults:vaults", update); }; }, []);
  return (
    <dialog id="settings" className="m-auto max-h-[min(44rem,calc(100dvh-2rem))] w-[min(50rem,calc(100vw-2rem))] overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#04071d] p-0 text-slate-100 shadow-2xl backdrop:bg-slate-950/45 backdrop:backdrop-blur-sm max-[560px]:inset-0 max-[560px]:m-0 max-[560px]:h-dvh max-[560px]:max-h-none max-[560px]:w-screen max-[560px]:max-w-none max-[560px]:rounded-none max-[560px]:border-0">
      <div className="grid min-h-[31rem] grid-cols-[12rem_1fr] max-[560px]:min-h-full max-[560px]:grid-cols-1 max-[560px]:grid-rows-[auto_1fr]">
        <aside className="flex flex-col border-r border-white/7 bg-transparent p-4 max-[560px]:grid max-[560px]:grid-cols-4 max-[560px]:items-center max-[560px]:gap-1 max-[560px]:border-b max-[560px]:border-r-0 max-[560px]:p-3">
          <div className="max-[560px]:col-span-4">
            <p className={eyebrow}>SETTINGS</p>
            <h2 className="text-xl font-bold">Settings</h2>
          </div>
          <Button
            variant="ghost"
            className={`${settingsTab} ${activeTab === "profile" ? "active bg-[#E0BB95]/12 text-[#E0BB95] shadow-sm" : ""}`}
            data-settings-view="profile"
          >
            Profile
          </Button>
          <Button
            variant="ghost"
            className={`${settingsTab} ${activeTab === "devices" ? "active bg-[#E0BB95]/12 text-[#E0BB95] shadow-sm" : ""}`}
            data-settings-view="devices"
          >
            Devices
          </Button>
          <Button variant="ghost" className={`${settingsTab} ${activeTab === "vaults" ? "active bg-[#E0BB95]/12 text-[#E0BB95] shadow-sm" : ""}`} data-settings-view="vaults">Vaults</Button>
          <Button variant="ghost" className={`${settingsTab} ${activeTab === "preferences" ? "active bg-[#E0BB95]/12 text-[#E0BB95] shadow-sm" : ""}`} data-settings-view="preferences">Preferences</Button>
          <Button
            id="close-settings"
            variant="secondary"
            className="settings-close absolute right-3 top-3 !size-9 !min-h-9 !justify-center !p-0"
            aria-label="Close settings"
            title="Close settings"
          >
            <X size={18} />
          </Button>
        </aside>
        <section className="overflow-auto p-8 max-[560px]:p-5 [&>h2]:text-2xl [&>h2]:font-bold" id="settings-profile" hidden={activeTab !== "profile"}>
          <h2>Profile</h2>
          <p className={muted}>Your account and personal preferences.</p>
          <div className="grid gap-1 rounded-xl border border-white/8 bg-white/3 p-4">
            <span className="text-xs text-slate-500">Username</span>
            <strong id="profile-username" />
          </div>
          <div className="mt-3 grid gap-1 rounded-xl border border-white/8 bg-white/3 p-4"><span className="text-xs text-slate-500">Device ID</span><code id="profile-device" className="break-all text-xs" /></div>
          <div className="mt-3 grid gap-1 rounded-xl border border-white/8 bg-white/3 p-4"><span className="text-xs text-slate-500">Account secret</span><span id="profile-secret-status" className="text-sm" /></div>
        </section>
        <section className="overflow-auto p-8 max-[560px]:p-5 [&>h2]:text-2xl [&>h2]:font-bold" id="settings-preferences" hidden={activeTab !== "preferences"}>
          <h2>Preferences</h2><p className={muted}>Choose how this browser handles your session and copied values.</p>
          <div className="mt-6 grid gap-5 text-sm"><label className="grid gap-2">Lock after inactivity<select id="preference-lock-minutes" className="rounded-xl border border-white/10 bg-[#11162b] p-3 text-white"><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option></select></label><label className="grid gap-2">Clear copied values after<select id="preference-clipboard-seconds" className="rounded-xl border border-white/10 bg-[#11162b] p-3 text-white"><option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option></select></label></div>
        </section>
        <section className="overflow-auto p-8 max-[560px]:p-5 [&>h2]:text-2xl [&>h2]:font-bold" id="settings-vaults" hidden={activeTab !== "vaults"}><h2>Vaults</h2><p className={muted}>Choose a vault or create another encrypted vault.</p><div className="mt-6 grid gap-2">{vaults.map((vault) => <Button key={vault.vaultId} variant={vault.selected ? "secondary" : "ghost"} className="justify-start" onClick={() => (window as any).__vaultsActions.selectVault(vault.vaultId)}><VaultIcon size={17} />{vault.name}{vault.selected ? " · Current" : ""}</Button>)}</div><Button id="settings-create-vault" className="mt-5" onClick={() => (window as any).__vaultsActions.openCreateVaultDialog()}>Create vault</Button></section>
        <section className="overflow-auto p-8 max-[560px]:p-5 [&_h2]:text-2xl [&_h2]:font-bold" id="settings-devices" hidden={activeTab !== "devices"}>
          <div id="devices-list-page">
            <div className="flex items-start justify-between gap-4 max-[560px]:flex-wrap">
              <div>
                <h2>Devices</h2>
                <p className={muted}>Devices registered to this account.</p>
              </div>
              <Button id="show-device-registration">Register new</Button>
            </div>
            <div id="device-status" className={`inline-status ${inlineStatus}`} role="status" />
            <DeviceList />
            <Button id="reload-devices" variant="secondary">
              Refresh
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
    </dialog>
  );
}

export function App() {
  useEffect(() => {
    const client = "/app/mvp-client.mjs";
    import(/* @vite-ignore */ client).catch(() => {
      if (import.meta.env.DEV) return;
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
      <Authentication />
      <Vault />
      <Settings />
      <ToastRegion />
      <dialog id="web-create-vault-dialog" className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#11162b] p-6 text-slate-100 shadow-2xl backdrop:bg-slate-950/70"><form id="web-create-vault-form"><h2 className="text-xl font-bold">Create vault</h2><p className="mt-2 text-sm text-slate-400">A separate encrypted space for your items.</p><label className="mt-5 grid gap-2 text-sm">Vault name<Input id="web-vault-name" autoFocus maxLength={80} required /></label><div className="mt-6 flex justify-end gap-2"><Button id="web-create-vault-cancel" type="button" variant="secondary">Cancel</Button><Button id="web-create-vault-submit" type="submit">Create vault</Button></div></form></dialog>
      <dialog id="conflict-dialog" className="m-auto max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100vw-2rem))] overflow-auto rounded-2xl border border-amber-300/20 bg-[#11162b] p-6 text-slate-100 shadow-2xl backdrop:bg-slate-950/70 backdrop:backdrop-blur-sm max-[560px]:p-4">
        <h2 className="text-xl font-bold">Resolve sync conflict</h2>
        <p id="conflict-detail" className="mt-2 text-sm leading-6 text-slate-400">This item changed on another device while you were editing it. Choose which version to keep.</p>
        <div id="merge-fields" className="mt-5 hidden max-h-[50dvh] overflow-auto rounded-xl border border-white/10" />
        <div className="mt-6 grid gap-2"><Button id="conflict-merge">Merge field by field…</Button><Button id="conflict-apply-merge" className="hidden">Use merged version</Button><Button id="conflict-keep" variant="secondary">Keep my changes and retry</Button><Button id="conflict-server" variant="secondary">Discard mine and use server</Button><Button id="conflict-cancel" variant="ghost">Cancel and keep editing</Button></div>
      </dialog>
      <dialog id="confirm-dialog" className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#11162b] p-6 text-slate-100 shadow-2xl backdrop:bg-slate-950/70"><h2 id="confirm-title" className="text-xl font-bold"/><p id="confirm-detail" className="mt-2 text-sm leading-6 text-slate-400"/><div className="mt-6 flex justify-end gap-2"><Button id="confirm-cancel" variant="secondary">Cancel</Button><Button id="confirm-accept">Continue</Button></div></dialog>
    </AppErrorBoundary>
  );
}
