import { ReadonlyItem } from "./readonly-item";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import { createSessionRevocation } from "./session-revocation.mjs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FieldTypePicker, PasskeyDetails, KeyboardHelp, AuthenticatorEditor, AuthenticatorCode, PasswordHealth, TOTP_ID, isFavorite, setFavorite, setAuthenticator, parseTotp, Button, IconButton, Input, cn, SecretGenerator, type GeneratorOptions } from "@127vaults/ui";
import { QRCodeSVG } from "qrcode.react";
import { createDragSession } from "./drag-session.mjs";
import { browseColumnValue, browseGroups, type BrowseMode } from "./item-browser";
import { choicesForConflict } from "./conflict-choice.mjs";
import { ITEM_TYPES, TYPE_GROUPS, RELATED_TYPES, SECTION_TYPES, CUSTOM_SECTION, addRelatedSection, addSectionField, completeRelatedFields, itemType, ordinaryFields, primaryFields, removeSection, renameSection, replaceItemType, sections, setItemType, visibleFields, type ItemType, type SectionType } from "./item-types";
import {
  PanelsTopLeft,
  ExternalLink,
  Star,
  ShieldCheck,
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  Globe2,
  GripVertical,
  KeyRound,
  Landmark,
  LayoutList,
  LayoutGrid,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Router,
  RefreshCw,
  Search,
  Settings,
  Terminal,
  Trash2,
  Vault,
  Wifi,
  X,
} from "lucide-react";

type Summary = { code: string; itemId: string; title: string; website: string; vaultId?: string; itemType?: string; createdAt?: number; updatedAt?: number; favorite?: boolean };
type CustomField = { id: string; label: string; type: string; value: string };
type Item = Omit<Summary, "code"> & {
  deleted?: boolean;
  username: string;
  password: string;
  customFields: CustomField[];
};
type VaultSummary = { vaultId: string; name: string; code: string; retired?: boolean; retirementChoice?: "archive" | "move" | null };
type CollectionSummary = { id: string; name: string; vault_ids: string[] };
type VaultSettings = { collections: CollectionSummary[]; defaultView: { kind: string; id?: string } | null; removalPreference: string | null; pending: boolean; conflict: boolean };
type RemovalPlan = { pending: boolean; choice?: "archive" | "move" | "restore"; sourceVaultId?: string; destinationVaultId?: string | null; stage?: "copying" | "finalizing"; itemMappings?: { source_item_id: string; destination_item_id: string }[] };
type RemovalResult = { receipt: { choice?: string; itemCount?: number; restored?: boolean }; vaults: VaultSummary[]; settings: VaultSettings };
type UnlockResult = { sessionEpoch: number; online: boolean; offlineReason: string | null; vaultId: string; vaults: VaultSummary[]; items: Summary[]; settings: VaultSettings; viewKind: string; collectionId: string | null; secretRemembered: boolean };
type DesktopInfo = {
  configured: boolean;
  configurationPath: string;
  registrationUrl: string | null;
  cachedUsername: string | null;
  hasCachedSecret: boolean;
  deviceId: string | null;
};
type EnrollmentStatus = {
  state?: "starting" | "approval" | "complete" | "error";
  code?: string;
  approvalUrl?: string;
  message?: string;
};
type Notice = {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  detail?: string;
};
type Conflict = { vaultId?: string; draft: Item; message: string; operationId?: string; kind?: string; server?: Item; choices?: Record<string, "local" | "server"> };
type EngineConflict = { operationId: string; itemId: string; vaultId: string; kind: string; localFields?: string[]; remoteFields?: string[] };
type SyncReviewItem = { operationId: string; itemId: string; vaultId: string; title: string; fields: string[]; conflict: EngineConflict | null; error: string | null };
type SyncReview = { items: SyncReviewItem[]; settingsPending: boolean; settingsConflict: boolean; unverifiedAcknowledgements?: number };
const dragSession = createDragSession();
const generateSecret = (options: GeneratorOptions) => invoke<string>("generate_secret", { options });
function DesktopSecretGenerator(props: Parameters<typeof SecretGenerator>[0]) {
  return <SecretGenerator {...props} autoGenerate triggerIcon={<RefreshCw size={16} aria-hidden="true" />} />;
}
const TYPE_ICONS = { login: Globe2, bank: Landmark, card: CreditCard, wifi: Wifi, router: Router, ssh: Terminal, password: KeyRound, passkey: KeyRound };
const TYPE_DESCRIPTIONS: Record<ItemType, string> = {
  login: "Website or app sign-in",
  passkey: "Passwordless website sign-in",
  bank: "Account and online banking",
  card: "Debit or credit card",
  wifi: "Wireless network access",
  router: "Network device and admin access",
  ssh: "Server or device access",
  password: "A standalone secret or code",
};

function TypePicker({ value, onSelect }: { value: ItemType; onSelect: (type: ItemType) => void }) {
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

function RelatedPicker({ type, onSelect }: { type: ItemType; onSelect: (type: SectionType, label: string) => void }) {
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

export function App() {
  const sessionRevocation = useRef(createSessionRevocation());
  const [unlocked, setUnlocked] = useState(false),
    [online, setOnline] = useState(false),
    [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importVaultId, setImportVaultId] = useState("");
  const [importFormat, setImportFormat] = useState("bitwarden");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importAvailableVaults, setImportAvailableVaults] = useState<{ id: string; name: string; account: string; records: number }[]>([]);
  const [importSelectedVaults, setImportSelectedVaults] = useState<string[] | null>(null);
  const [importSkipped, setImportSkipped] = useState<{ items: number; attachments: number } | null>(null);
  const [importCount, setImportCount] = useState<number | null>(null);
  const [importSourceVaults, setImportSourceVaults] = useState<{ name: string; records: number }[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importGeneration = useRef(0);

  const [pendingChanges, setPendingChanges] = useState<number | null>(null);
  const [syncConflicts, setSyncConflicts] = useState(0);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "error">("idle");
  const [syncFailure, setSyncFailure] = useState<string | null>(null);
  const [syncReview, setSyncReview] = useState<SyncReview | null>(null);
  const [syncReviewOpen, setSyncReviewOpen] = useState(false);
  const syncInFlight = useRef(false);
  const syncReviewGeneration = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const dirtyRef = useRef(false);
  const [enrolling, setEnrolling] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false),
    [registrationUsername, setRegistrationUsername] = useState("");
  const [vaultId, setVaultId] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("Locked");
  const [viewMode, setViewMode] = useState<"single" | "all" | "collection">("single");
  const [itemLayout, setItemLayout] = useState<"list" | "grid">(() => {
    try { return localStorage.getItem("127vaults:desktop-item-layout") === "grid" ? "grid" : "list"; }
    catch { return "list"; }
  });
  const [browseMode, setBrowseMode] = useState<BrowseMode>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | ItemType>("all");
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1440px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1440px)");
    const updateWidth = () => setWide(media.matches);
    media.addEventListener("change", updateWidth);
    return () => media.removeEventListener("change", updateWidth);
  }, []);
  const changeItemLayout = (next: "list" | "grid") => {
    setItemLayout(next);
    try { localStorage.setItem("127vaults:desktop-item-layout", next); } catch { /* Storage may be disabled. */ }
  };
  const [itemVaultId, setItemVaultId] = useState("");
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [settingsConflict, setSettingsConflict] = useState(false);
  const [settingsReview, setSettingsReview] = useState<{local: unknown; server: unknown} | null>(null);
  const [defaultView, setDefaultView] = useState<VaultSettings["defaultView"]>(null);
  const [removalPreference, setRemovalPreference] = useState<string | null>(null);
  const [collectionDialog, setCollectionDialog] = useState<"create" | "edit" | null>(null);
  const [collectionNameDraft, setCollectionNameDraft] = useState("");
  const [collectionVaultDraft, setCollectionVaultDraft] = useState<string[]>([]);
  const [vaultDialog, setVaultDialog] = useState<"create" | "rename" | null>(null);
  const [vaultActionId, setVaultActionId] = useState<string | null>(null);
  const [vaultNameDraft, setVaultNameDraft] = useState("");
  const [removalDialog, setRemovalDialog] = useState<{ sourceId: string; choice: "archive" | "move"; destinationId: string } | null>(null);
  const [removalPlan, setRemovalPlan] = useState<RemovalPlan | null>(null);
  const [removalBusy, setRemovalBusy] = useState(false);
  const [removalItemCount, setRemovalItemCount] = useState<number | null>(null);
  const [items, setItems] = useState<Summary[]>([]),
    [selected, setSelected] = useState<Item | null>(null);
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [editOriginal, setEditOriginal] = useState<Item | null>(null);
  const [expandedRelatedId, setExpandedRelatedId] = useState<string | null>(null);
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null),
    [trustUrl, setTrustUrl] = useState(""),
    [trustCaPath, setTrustCaPath] = useState(""),
    [trustServerId, setTrustServerId] = useState(""),
    [trustFingerprint, setTrustFingerprint] = useState(""),
    [trustBusy, setTrustBusy] = useState(false),
    [username, setUsername] = useState("");
  const [accountSecret, setAccountSecret] = useState(""),
    [masterPassword, setMasterPassword] = useState("");
  const [rememberedSecret, setRememberedSecret] = useState(false);
  const [showSecretEntry, setShowSecretEntry] = useState(false);
  const [tailnetPeers, setTailnetPeers] = useState<{name:string;address:string}[]>([]);
  const [offlineReason, setOfflineReason] = useState<string | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<{ mode: string; plan: string | null; expiresAt: string | null; enforcement: string } | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [notices, setNotices] = useState<Notice[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  useEffect(() => { setConflictError(null); setConflictBusy(false); }, [conflict?.operationId]);
  const [resolvingOperationId, setResolvingOperationId] = useState<string | null>(null);
  const [footerMenu, setFooterMenu] = useState(false);
  const [compactSidebar, setCompactSidebar] = useState(() => window.matchMedia("(max-width: 850px)").matches);
  useEffect(() => { const query = window.matchMedia("(max-width: 850px)"); const update = () => setCompactSidebar(query.matches); query.addEventListener("change", update); return () => query.removeEventListener("change", update); }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => { try { return localStorage.getItem("127vaults:sidebar-collapsed") === "true"; } catch { return false; } });
  const [itemTabs, setItemTabs] = useState<Summary[]>([]);
  const openRequest = useRef(0);
  const pinItem = () => {
    if (!selected?.itemId) return;
    const tab = { itemId: selected.itemId, title: selected.title, website: selected.website, vaultId: itemVaultId, code: "" };
    setItemTabs(current => current.some(row => row.itemId === tab.itemId && row.vaultId === tab.vaultId) ? current : [...current, tab]);
  };
  const popOutItem = async () => {
    if (!selected?.itemId) return;
    const label = `item-${itemVaultId}-${selected.itemId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    try {
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) { await existing.setFocus(); return; }
      const child = new WebviewWindow(label, { url: `index.html?detail=${encodeURIComponent(selected.itemId)}&vault=${encodeURIComponent(itemVaultId)}`, title: "127Vaults · Item details", dragDropEnabled: false, width: 620, height: 760, minWidth: 380, minHeight: 400 });
      void child.once("tauri://error", event => notify("error", "Could not open item window", String(event.payload)));
    } catch (error) { notify("error", "Could not open item window", String(error)); }
  };
  const [compactNavOpen, setCompactNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const settingsBodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    settingsDialogRef.current?.showModal();
    return () => { previousFocus?.focus(); };
  }, [settingsOpen]);
  const [nativePasskeys, setNativePasskeys] = useState<{ available?: boolean; disabled?: boolean; windows?: boolean; installed?: boolean; packaged?: boolean; registered?: boolean; enabled?: boolean } | null>(null);
  const [nativePasskeysBusy, setNativePasskeysBusy] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"profile" | "devices" | "vaults" | "preferences">("profile");
  useEffect(() => { settingsBodyRef.current?.scrollTo({ top: 0 }); }, [settingsTab]);
  const [devices, setDevices] = useState<{ deviceId: string; protectionClass?: string; credentialState?: string; status?: string }[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState("");
  const [devicesLoading, setDevicesLoading] = useState(false);
  const devicesRequestRef = useRef(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [lastLocalChange, setLastLocalChange] = useState<Date | null>(null);
  const activeVaults = vaults.filter((vault) => !vault.retired);
  const archivedVaults = vaults.filter((vault) => vault.retired && vault.retirementChoice === "archive");
  const notify = (kind: Notice["kind"], title: string, detail?: string) => {
    const id = Date.now() + Math.random();
    setNotices((current) => [...current.filter(notice => notice.title !== title || notice.detail !== detail), { id, kind, title, detail }]);
    window.setTimeout(
      () =>
        setNotices((current) => current.filter((notice) => notice.id !== id)),
      kind === "error" ? 8000 : 4500,
    );
  };
  const friendlyError = (error: unknown) => {
    const message = String(error).replace(/^Error:\s*/, "");
    if (message.includes("sync unavailable while offline"))
      return offlineReason?.includes("checkpoint verification key changed")
        ? "Sync is paused because this server has a different checkpoint verification key. Your encrypted replica and pending changes are preserved. Restore the original server identity before reconnecting."
        : `Sync is paused because online unlock did not complete. Reconnect from Profile with your master password.${offlineReason ? ` Online unlock failed: ${offlineReason}` : ""}`;
    if (
      message.includes("SERVER_TIMEOUT") ||
      message.toLowerCase().includes("timed out")
    )
      return "The server took too long to respond. Check your connection and try again.";
    if (
      message.includes("SERVER_UNREACHABLE") ||
      message.toLowerCase().includes("connect")
    )
      return "The server could not be reached. Your local vault is unchanged.";
    return message;
  };
  const updateNativePasskeys = async (action: string) => {
    setNativePasskeysBusy(true);
    try {
      const value = await invoke<NonNullable<typeof nativePasskeys>>("native_passkey_provider", { action });
      setNativePasskeys(value);
      notify("success", action === "register" ? "Native passkeys registered" : action === "unregister" ? "Native passkeys removed" : "Native passkey status refreshed", action === "register" ? "Enable 127Vaults in Windows Settings → Accounts → Passkeys → Advanced options." : undefined);
    } catch (error) { notify("error", "Native passkeys", friendlyError(error)); }
    finally { setNativePasskeysBusy(false); }
  };
  const loadDevices = async () => {
    if (devicesRequestRef.current) return;
    devicesRequestRef.current = true;
    setDevicesLoading(true);
    setDeviceError("");
    try {
      const result = await invoke<{ devices: typeof devices; currentDeviceId: string }>("device_list");
      setDevices(result.devices ?? []);
      setCurrentDeviceId(result.currentDeviceId);
    } catch (error) { setDeviceError(friendlyError(error)); }
    finally { devicesRequestRef.current = false; setDevicesLoading(false); }
  };
  const revokeDevice = async (deviceId: string) => {
    if (!window.confirm(`Revoke device ${deviceId.slice(0, 8)}? It will need enrollment before signing in again.`)) return;
    try { await invoke("device_revoke", { deviceId }); await loadDevices(); notify("success", "Device revoked"); }
    catch (error) { notify("error", "Could not revoke device", friendlyError(error)); }
  };

  const runImport = async (confirm: boolean) => {
    if (!importFile || !importVaultId || importBusy) return;
    if (importFile.size > 32 * 1024 * 1024) { setStatus("Choose an export smaller than 32 MiB."); return; }
    const generation = ++importGeneration.current;
    setImportBusy(true); setImportError(null);
    let bytes: number[] = [];
    try {
      bytes = Array.from(new Uint8Array(await importFile.arrayBuffer()));
      if (generation !== importGeneration.current) return;
      const inspect = importFormat === "1password" && importSelectedVaults === null;
      const result = await invoke<{ records?: number; imported?: number; sourceVaults?: { name: string; records: number }[]; availableVaults?: typeof importAvailableVaults; skippedItems?: number; skippedAttachments?: number }>("import_passwords", { vaultId: importVaultId, bytes, format: importFormat, confirm, selectedVaults: importFormat === "1password" ? importSelectedVaults : null, inspect });
      if (generation !== importGeneration.current) return;
      setImportSkipped({ items: result.skippedItems ?? 0, attachments: result.skippedAttachments ?? 0 });
      if (inspect) {
        const choices = result.availableVaults ?? [];
        setImportAvailableVaults(choices); setImportSelectedVaults(choices.filter(vault => vault.records > 0).map(vault => vault.id));
        return;
      }
      if (confirm) {
        setImportFile(null); setImportAvailableVaults([]); setImportSelectedVaults(null); setImportSkipped(null); setImportCount(null); setImportSourceVaults([]); setImportOpen(false);
        const refreshedVaults = await invoke<VaultSummary[]>("vault_list");
        if (generation !== importGeneration.current) return;
        const refreshed = viewMode === "single" ? await invoke<Summary[]>("item_list", { vaultId }) : await listVisibleItems(refreshedVaults.filter(vault => !vault.retired));
        if (generation === importGeneration.current) { setVaults(refreshedVaults); setItems(refreshed); setStatus(`Imported ${result.imported} items. ${result.skippedItems ?? 0} unsupported items and ${result.skippedAttachments ?? 0} attachment files excluded from the export.`); }
      } else { setImportCount(result.records ?? 0); setImportSourceVaults(result.sourceVaults ?? []); }
    } catch (error) { if (generation === importGeneration.current) { setImportError(String(error)); if (confirm) { setImportFile(null); setImportAvailableVaults([]); setImportSelectedVaults(null); setImportSkipped(null); setImportCount(null); setImportSourceVaults([]); } } }
    finally { bytes.fill(0); if (generation === importGeneration.current) setImportBusy(false); }
  };

  const lock = async (reason = "Locked") => {
    sessionRevocation.current.lock();
    syncReviewGeneration.current += 1;
    setSaving(false);
    window.dispatchEvent(new Event("vaults:clear-generator"));
    openRequest.current++;
    setItemTabs([]);
    setBusy(true);
    void emit("vaults-locked").catch(() => {});
    setHealthOpen(false);
    importGeneration.current++; setImportOpen(false); setImportFile(null); setImportAvailableVaults([]); setImportSelectedVaults(null); setImportSkipped(null); setImportCount(null); setImportSourceVaults([]); setImportBusy(false);
    setPendingChanges(null);
    setSyncConflicts(0);
    setFavoritesOnly(false);
    setSyncState("idle");
    setSyncFailure(null);
    setSyncReview(null);
    setSyncReviewOpen(false);
    setLastSynced(null);
    setLastLocalChange(null);
    setUnlocked(false);
    setLicenseStatus(null);
    setVaults([]);
    setVaultId("");
    setItemVaultId("");
    setViewMode("single");
    setCollections([]);
    setSelectedCollectionId(null);
    setRemovalDialog(null);
    setRemovalPlan(null);
    setSettingsConflict(false);
    setDefaultView(null);
    setItems([]);
    setSelected(null);
    setEditOriginal(null);
    setRevealed(new Set());
    setAccountSecret("");
    setMasterPassword("");
    dragSession.lock();
    setStatus(reason);
    try { await invoke("lock"); }
    catch { setStatus("Local lock needs attention. Close the app before leaving this device."); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let dispose: (() => void) | undefined, stopped = false;
    void listen<{ epoch: number; reason?: string }>("vaults-connector-locked", event => {
      if (sessionRevocation.current.revoke(event.payload.epoch)) void lock(event.payload.reason ? `Client locked: ${event.payload.reason}` : "Client locked. Unlock to continue.");
    }).then(unlisten => { if (stopped) unlisten(); else dispose = unlisten; });
    return () => { stopped = true; dispose?.(); };
  }, []);
  useEffect(() => {
    if (!unlocked) return;
    let last = 0;
    const activity = (event: Event) => {
      if (!event.isTrusted || Date.now() - last < 60000) return;
      last = Date.now();
      void invoke("session_activity").catch(() => {});
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    return () => { window.removeEventListener("pointerdown", activity); window.removeEventListener("keydown", activity); };
  }, [unlocked]);
  useEffect(() => {
    void invoke<typeof nativePasskeys>("native_passkey_provider", { action: "status" }).then(setNativePasskeys).catch(() => undefined);
    void invoke<DesktopInfo>("desktop_info")
      .then((info) => { setDesktopInfo(info); setRememberedSecret(info.hasCachedSecret); if (info.cachedUsername) setUsername(info.cachedUsername); })
      .catch((e) => setStatus(String(e)));
    // Focus and visibility changes are not lock signals. Users routinely switch
    // apps while retrieving an account secret or completing login.
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "r")
        return;
      event.preventDefault();
      event.stopPropagation();
      if (unlocked && selected && !editing) {
        setRevealed((current) => {
          const next = new Set(current);
          next.has("password") ? next.delete("password") : next.add("password");
          return next;
        });
        setStatus("Password visibility toggled");
      }
    };
    window.addEventListener("keydown", shortcut, { capture: true });
    return () =>
      window.removeEventListener("keydown", shortcut, { capture: true });
  }, [editing, selected, unlocked]);
  const loadItem = async (summary: Summary, vault = vaultId) => {
    const item = await invoke<Item>("item_get", { vaultId: vault, itemId: summary.itemId });
    const customFields = item.customFields ?? [];
    const password = await invoke<string>("item_secret", { vaultId: vault, itemId: summary.itemId, field: "password" });
    const hydrated = await Promise.all(customFields.map(async (field) => field.type === "password" && field.id !== "__127vaults_passkey_key" ? { ...field, value: await invoke<string>("item_secret", { vaultId: vault, itemId: summary.itemId, field: field.id }) } : field));
    return { ...item, password, customFields: hydrated };
  };
  const openItem = async (summary: Summary, vault = vaultId) => {
    if (!confirmDiscard()) return;
    try {
      const ownerVault = summary.vaultId ?? vault;
      const request = ++openRequest.current;
      const item = await loadItem(summary, ownerVault);
      if (request !== openRequest.current) return;
      setSelected(item);
      setVaultId(ownerVault);
      setItemVaultId(ownerVault);
      setRevealed(new Set());
      setEditing(false);
      setEditOriginal(null);
    } catch (e) {
      setStatus(String(e));
    }
  };
  const prepareMerge = async () => {
    if (conflictBusy) return;
    if (!conflict?.draft.itemId || !conflict.operationId) {
      setConflictError("This review no longer identifies a queued edit. Close it and reopen Review sync to select the current pending change.");
      return;
    }
    const generation = syncReviewGeneration.current;
    setConflictBusy(true);
    setConflictError(null);
    try {
      const result = await invoke<{ deleted: boolean; queuedCreate?: boolean; server: Item | null; conflict: EngineConflict }>("conflict_compare", { vaultId: conflict.vaultId ?? vaultId, itemId: conflict.draft.itemId, operationId: conflict.operationId });
      if (generation !== syncReviewGeneration.current) return;
      if (result.deleted) {
        setConflict({ ...conflict, server: undefined, choices: undefined, kind: result.queuedCreate ? "unsynced-create" : "delete-edit-divergence", message: result.queuedCreate ? "This new item has not reached the server. There is no server copy to compare. Your encrypted local creation remains queued; close this dialog to keep it, or explicitly discard the queued creation." : "This edited item is absent from the verified server state. There is no server copy to compare. Close this dialog to keep your queued edit, or explicitly discard that edit." });
      } else if (result.server) {
        setConflict({ ...conflict, server: result.server, choices: choicesForConflict(result.conflict) });
      }
    } catch (error) {
      if (generation === syncReviewGeneration.current) setConflictError("Could not load the verified server version: " + friendlyError(error) + ". Your queued edit has not been discarded. Retry comparison or reconnect.");
    } finally { if (generation === syncReviewGeneration.current) setConflictBusy(false); }
  };
  const applyMerge = () => {
    if (!conflict?.server || !conflict.choices) return;
    const pick = <K extends keyof Item>(key: K) => conflict.choices?.[key] === "server" ? conflict.server![key] : conflict.draft[key];
    const merged = { itemId: conflict.draft.itemId, title: pick("title"), website: pick("website"), username: pick("username"), password: pick("password"), customFields: pick("customFields") };
    setSelected(merged);
    setEditOriginal(conflict.server);
    setResolvingOperationId(conflict.operationId ?? null);
    setItemVaultId(conflict.vaultId ?? vaultId);
    beginDraft();
    setConflict(null);
    void save(merged, conflict.operationId ?? null, conflict.vaultId);
  };
  const unlock = async () => {
    if (busy) return false;
    const wasUnlocked = unlocked;
    const nextErrors: Record<string, string> = {};
    if (!username.trim()) nextErrors.username = "Enter your username.";
    if ((!rememberedSecret || showSecretEntry || accountSecret.length > 0) && !/^[0-9a-fA-F]{64}$/.test(accountSecret))
      nextErrors.accountSecret = "Enter the 64-character account secret.";
    if ([...masterPassword].length < 20)
      nextErrors.masterPassword =
        "Master password must be at least 20 characters.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return false;
    const unlockTicket = sessionRevocation.current.beginUnlock();
    setBusy(true);
    setStatus("Verifying credentials and opening the encrypted replica…");
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    try {
      const result = await invoke<UnlockResult>("unlock", {
        username,
        accountSecret,
        masterPassword,
      });
      if (!sessionRevocation.current.acceptUnlock(unlockTicket, result.sessionEpoch)) { await lock("Client locked. Unlock to continue."); return false; }
      setVaultId(result.vaultId);
      setItemVaultId(result.vaultId);
      setViewMode(result.viewKind === "all" ? "all" : result.viewKind === "collection" ? "collection" : "single");
      setSelectedCollectionId(result.collectionId);
      setCollections(result.settings.collections);
      setSettingsConflict(result.settings.conflict);
      setDefaultView(result.settings.defaultView);
      setRemovalPreference(result.settings.removalPreference);
      setVaults(result.vaults);
      setItems(result.items);
      setOnline(result.online);
      setOfflineReason(result.offlineReason);
      setLastSynced(result.online ? new Date() : null);
      setUnlocked(true);
      dragSession.unlock();
      setAccountSecret("");
      setRememberedSecret(result.secretRemembered);
      setShowSecretEntry(false);
      setMasterPassword("");
      setStatus(
        result.online
          ? "Unlocked · verified online replica"
          : result.offlineReason?.includes("checkpoint verification key changed")
            ? "Unlocked offline · server checkpoint key changed; sync paused"
            : `Unlocked offline · online unlock failed: ${result.offlineReason || "reason unavailable"}`,
      );
      setLastSynced(result.online ? new Date() : null);
      notify(
        result.online ? "success" : "info",
        wasUnlocked ? (result.online ? "Connection restored" : "Still offline") : "Vault unlocked",
        result.online ? "The server replica is up to date." : result.offlineReason?.includes("checkpoint verification key changed")
          ? "The server is reachable but its checkpoint key differs from this replica. Local data and pending changes were preserved. Restore the original server identity before reconnecting."
          : `Working from the encrypted offline replica. Online unlock failed: ${result.offlineReason || "reason unavailable"}`,
      );
      if (result.items[0]) await openItem(result.items[0], result.vaultId);
      return result.online;
    } catch (e) {
      if (wasUnlocked) await lock("Unlock failed; vault locked.");
      const message = String(e);
      const detail =
        message.includes("401") &&
        message.includes("offline unlock is not provisioned")
          ? "This device was rejected by the server and has no offline replica yet. Register this device, then complete one online unlock to enable offline access."
          : friendlyError(e);
      setStatus(detail);
      if (message.includes("account secret is required on this device")) { setRememberedSecret(false); setShowSecretEntry(true); }
      notify("error", "Could not unlock the vault", detail);
      return false;
    } finally {
      sessionRevocation.current.failUnlock(unlockTicket);
      setBusy(false);
    }
  };
  const selectVault = async (nextVaultId: string) => {
    if (!confirmDiscard()) return;
    setFavoritesOnly(false);
    if (nextVaultId === vaultId && viewMode === "single") return;
    try {
      const nextItems = await invoke<Summary[]>("item_list", { vaultId: nextVaultId });
      setVaultId(nextVaultId);
      setItemVaultId(nextVaultId);
      setViewMode("single");
      setSelectedCollectionId(null);
      setItems(nextItems);
      setSelected(null);
      setEditOriginal(null);
      setConflict(null);
      setRevealed(new Set());
      setEditing(false);
      dragSession.lock();
      dragSession.unlock();
      if (nextItems[0]) await openItem(nextItems[0], nextVaultId);
    } catch (error) {
      notify("error", "Could not open vault", friendlyError(error));
    }
  };
  const listAllItems = async (sourceVaults = activeVaults) => {
    const lists = await Promise.all(sourceVaults.map(async (vault) =>
      (await invoke<Summary[]>("item_list", { vaultId: vault.vaultId })).map((item) => ({ ...item, vaultId: vault.vaultId }))));
    return lists.flat();
  };
  const listVisibleItems = async (sourceVaults = activeVaults) => {
    if (viewMode === "collection" && selectedCollectionId) {
      const result = await invoke<{ items: Summary[] }>("collection_items", { collectionId: selectedCollectionId });
      return result.items;
    }
    return listAllItems(sourceVaults);
  };
  const selectAllVaults = async (favorites = false) => {
    if (!confirmDiscard()) return;
    try {
      const allItems = await listAllItems();
      setFavoritesOnly(favorites);
      setViewMode("all");
      setSelectedCollectionId(null);
      setItems(allItems);
      setSelected(null);
      setItemVaultId("");
      setEditing(false);
      setRevealed(new Set());
    } catch (error) {
      notify("error", "Could not list vaults", friendlyError(error));
    }
  };
  const selectCollection = async (collectionId: string) => {
    if (!confirmDiscard()) return;
    setFavoritesOnly(false);
    try {
      const result = await invoke<{ items: Summary[]; unavailableVaultIds: string[] }>("collection_items", { collectionId });
      setViewMode("collection");
      setSelectedCollectionId(collectionId);
      setItems(result.items);
      setSelected(null);
      setItemVaultId("");
      setEditing(false);
      if (result.unavailableVaultIds.length) notify("info", "Some vaults are unavailable", result.unavailableVaultIds.join(", "));
    } catch (error) { notify("error", "Could not open collection", friendlyError(error)); }
  };
  const saveCollection = async () => {
    try {
      const result = await invoke<VaultSettings>("collection_save", { collectionId: collectionDialog === "edit" ? selectedCollectionId : null, name: collectionNameDraft, vaultIds: collectionVaultDraft });
      setCollections(result.collections);
      setSettingsConflict(result.conflict);
      setDefaultView(result.defaultView);
      setCollectionDialog(null);
      setCollectionNameDraft("");
      notify("success", "Collection saved");
    } catch (error) { notify("error", "Could not save collection", friendlyError(error)); }
  };
  const removeCollection = async (collectionId = selectedCollectionId) => {
    if (!collectionId) return;
    try {
      const result = await invoke<VaultSettings>("collection_remove", { collectionId });
      setCollections(result.collections);
      setDefaultView(result.defaultView);
      setSettingsConflict(result.conflict);
      setSelectedCollectionId(null);
      await selectAllVaults();
    } catch (error) { notify("error", "Could not remove collection", friendlyError(error)); }
  };
  const saveDefaultView = async (kind: string, selector: string | null) => {
    try {
      const result = await invoke<VaultSettings>("vault_default_view", { kind, selector });
      setDefaultView(result.defaultView);
      setSettingsConflict(result.conflict);
      notify("success", "Default view saved");
    } catch (error) { notify("error", "Could not save default view", friendlyError(error)); }
  };
  const resolveVaultSettings = async (keep: "local" | "server") => {
    if (!confirmDiscard()) return;
    let resolved = false;
    try {
      const result = await invoke<VaultSettings>("vault_settings_resolve", { keep });
      resolved = true;
      setCollections(result.collections);
      setDefaultView(result.defaultView);
      setRemovalPreference(result.removalPreference);
      setSettingsConflict(result.conflict);
      setSettingsReview(null);
      const nextVaults = await invoke<VaultSummary[]>("vault_list");
      setVaults(nextVaults);
      const active = nextVaults.filter(vault => !vault.retired);
      if (viewMode === "collection" && selectedCollectionId && !result.collections.some(collection => collection.id === selectedCollectionId)) {
        setItems(await listAllItems(active));
        setViewMode("all");
        setSelectedCollectionId(null);
        setSelected(null);
        setEditing(false);
        setItemVaultId("");
        setRevealed(new Set());
      } else if (viewMode === "collection" && selectedCollectionId) {
        const collection = await invoke<{ items: Summary[] }>("collection_items", { collectionId: selectedCollectionId });
        setItems(collection.items);
      } else if (viewMode === "all") {
        setItems(await listAllItems(active));
      }
      await refreshSyncStatus();
      notify("success", "Vault settings resolved");
    } catch (error) {
      if (!resolved) {
        // Resolution may discover a newer server comparison or denied access.
        // Reopen review explicitly rather than retaining an outdated choice.
        setSettingsReview(null);
        await refreshSyncStatus().catch(() => {});
      }
      notify("error", resolved ? "Settings saved; refresh needed" : "Could not resolve settings", resolved ? "Sync again to refresh the vault view." : friendlyError(error));
    }
  };
  const addVault = async () => {
    try {
      const result = await invoke<{ created: VaultSummary; vaults: VaultSummary[] }>("vault_create", { name: vaultNameDraft });
      setVaults(result.vaults);
      await selectVault(result.created.vaultId);
      setVaultDialog(null);
      setVaultNameDraft("");
      notify("success", "Vault created", result.created.code);
    } catch (error) {
      notify("error", "Could not create vault", friendlyError(error));
    }
  };
  const renameVault = async () => {
    try {
      const result = await invoke<{ vaults: VaultSummary[] }>("vault_rename", { vaultId: vaultActionId ?? vaultId, name: vaultNameDraft });
      setVaults(result.vaults);
      setVaultDialog(null);
      setVaultNameDraft("");
      notify("success", "Vault renamed");
    } catch (error) {
      notify("error", "Could not rename vault", friendlyError(error));
    }
  };
  const openRemoval = async (sourceId: string) => {
    if (!online) { notify("error", "Reconnect to remove a vault", "Vault removal requires an online session."); return; }
    if (removalPlan?.pending) { notify("info", "Finish the pending vault operation first"); return; }
    let itemCount: number;
    try {
      const rows = await invoke<Summary[]>("item_list", { vaultId: sourceId });
      itemCount = rows.length;
      setRemovalItemCount(itemCount);
    } catch (error) { notify("error", "Could not inspect vault", friendlyError(error)); return; }
    const destinationId = activeVaults.find((row) => row.vaultId !== sourceId)?.vaultId ?? "";
    setSettingsOpen(false);
    setRemovalDialog({ sourceId, choice: removalPreference === "move" && destinationId && itemCount <= 100 ? "move" : "archive", destinationId });
  };
  const applyRemovalResult = async (result: RemovalResult, preferredId?: string) => {
    setVaults(result.vaults);
    setCollections(result.settings.collections);
    setDefaultView(result.settings.defaultView);
    setRemovalPreference(result.settings.removalPreference);
    setSettingsConflict(result.settings.conflict);
    const active = result.vaults.filter((row) => !row.retired);
    const nextId = active.find((row) => row.vaultId === preferredId)?.vaultId ?? active[0]?.vaultId ?? "";
    setVaultId(nextId);
    setItemVaultId(nextId);
    setViewMode(nextId ? "single" : "all");
    setSelectedCollectionId(null);
    setSelected(null);
    setEditOriginal(null);
    setEditing(false);
    setRevealed(new Set());
    try {
      setItems(nextId ? await invoke<Summary[]>("item_list", { vaultId: nextId }) : []);
    } catch (error) {
      setItems([]);
      notify("info", "Vault list needs a refresh", friendlyError(error));
    }
    setRemovalDialog(null);
    setRemovalPlan(null);
  };
  const removeVault = async (sourceId: string, choice: "archive" | "move", destinationId = "") => {
    if (removalBusy) return;
    if (choice === "move" && removalItemCount !== null && removalItemCount > 100 && !removalPlan?.pending) {
      notify("error", "Move limit exceeded", "Move supports at most 100 source items. Archive this vault or move items in smaller batches first."); return;
    }
    if (choice === "move" && (!destinationId || destinationId === sourceId)) {
      notify("error", "Choose a different destination vault"); return;
    }
    setRemovalBusy(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const result = choice === "move"
        ? await invoke<RemovalResult>("vault_move", { vaultId: sourceId, destinationVaultId: destinationId })
        : await invoke<RemovalResult>("vault_archive", { vaultId: sourceId });
      await applyRemovalResult(result, choice === "move" ? destinationId : undefined);
      notify("success", choice === "move" ? "Vault items moved" : "Vault archived", `${result.receipt.itemCount ?? 0} item(s) · source remains recoverable`);
    } catch (error) {
      setRemovalPlan(await invoke<RemovalPlan>("vault_removal_status").catch(() => null));
      notify("error", "Vault removal stopped", friendlyError(error));
    } finally { setRemovalBusy(false); }
  };
  const restoreVault = async (sourceId: string) => {
    if (removalBusy) return;
    setRemovalBusy(true);
    try {
      const result = await invoke<RemovalResult>("vault_restore", { vaultId: sourceId });
      await applyRemovalResult(result, sourceId);
      notify("success", "Archived vault restored");
    } catch (error) {
      setRemovalPlan(await invoke<RemovalPlan>("vault_removal_status").catch(() => null));
      notify("error", "Could not restore vault", friendlyError(error));
    } finally { setRemovalBusy(false); }
  };
  const resumeRemoval = () => {
    if (!removalPlan?.pending || !removalPlan.sourceVaultId) return;
    if (removalPlan.choice === "restore") { void restoreVault(removalPlan.sourceVaultId); return; }
    if (removalPlan.choice === "move" && removalPlan.destinationVaultId) {
      void removeVault(removalPlan.sourceVaultId, "move", removalPlan.destinationVaultId); return;
    }
    if (removalPlan.choice === "archive") void removeVault(removalPlan.sourceVaultId, "archive");
  };
  const abortMove = async () => {
    if (!window.confirm("Keep any destination copies and clear this unfinished move plan? Review the listed copies before trying another move.")) return;
    try {
      await invoke("vault_abort_move");
      setRemovalPlan(null);
      notify("info", "Move plan cleared", "Destination copies may remain for review.");
    } catch (error) { notify("error", "Could not clear move plan", friendlyError(error)); }
  };
  const save = async (draft = selected, resolutionId = resolvingOperationId, ownerVaultId?: string) => {
    if (!draft || saving) return;
    const destination = ownerVaultId ?? (draft.itemId ? itemVaultId : viewMode === "single" ? vaultId : itemVaultId);
    if (!destination) {
      notify("error", "Choose a vault", "Select the destination vault before saving this item.");
      return;
    }
    const nextErrors: Record<string, string> = {};
    if (!draft.title.trim()) nextErrors.title = "Title is required.";
    visibleFields(draft.customFields).forEach((field) => {
      if (!field.label.trim())
        nextErrors[`custom-${field.id}`] = "Field name is required.";
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      notify(
        "error",
        "Check the highlighted fields",
        "Complete the required information, then save again.",
      );
      return;
    }
    try {
      const authenticator = draft.customFields.find(f => f.id === TOTP_ID)?.value;
      if (authenticator) parseTotp(authenticator);
      setSaving(true);
      setStatus("Saving encrypted item…");
      const response = await invoke<{
        result: { queued?: boolean; itemId?: string };
        items: Summary[];
      }>("item_save", {
        vaultId: destination,
        itemId: draft.itemId || null,
        title: draft.title,
        website: draft.website,
        username: draft.username,
        password: draft.password,
        customFields: draft.customFields,
        resolvingOperationId: resolutionId,
      });
      setItems(viewMode === "single" ? response.items : await listVisibleItems());
      dirtyRef.current = false;
      setEditing(false);
      setEditOriginal(null);
      setResolvingOperationId(null);
      await refreshSyncStatus();
      if (response.result.queued) setOnline(false);
      else { setSyncState("idle"); setSyncFailure(null); }
      setLastLocalChange(new Date());
      setStatus(
        response.result.queued
          ? "Encrypted change queued offline"
          : "Encrypted change saved",
      );
      notify(
        "success",
        response.result.queued ? "Saved on this device" : "Item saved",
        response.result.queued
          ? "It will sync when the server is available."
          : "Your encrypted item is up to date.",
      );
      const saved =
        response.items.find((item) => item.itemId === (response.result.itemId || draft.itemId));
      if (saved) await openItem(saved, destination);
    } catch (e) {
      await refreshSyncStatus();
      const message = String(e);
      if (message.includes("409")) {
        setConflict({
          vaultId: destination,
          draft: structuredClone(draft),
          message:
            "This item changed on another device while you were editing it.",
        });
      } else {
        const detail = friendlyError(e);
        setStatus(detail);
        const verificationFailed = message.includes("local replica was preserved");
        if (verificationFailed) { setSyncState("error"); setSyncFailure(detail); }
        notify("error", verificationFailed ? "Server verification failed" : "Item was not saved", detail);
      }
    } finally { setSaving(false); }
  };
  const deleteItem = async (draft = selected, destination = itemVaultId, operationId: string | null = null) => {
    if (!draft?.itemId || !destination || saving || busy) return;
    if (!window.confirm(`Permanently delete “${draft.title || "Untitled item"}”? This also removes its passwords and passkeys. Offline deletion will sync when connected.`)) return;
    const generation = syncReviewGeneration.current;
    setSaving(true);
    try {
      const response = await invoke<{ result: { queued?: boolean }; items: Summary[] }>("item_delete", {
        vaultId: destination, itemId: draft.itemId, resolvingOperationId: operationId,
      });
      if (generation !== syncReviewGeneration.current) return;
      const nextItems = viewMode === "single" ? response.items : await listVisibleItems();
      if (generation !== syncReviewGeneration.current) return;
      setItems(nextItems);
      setItemTabs(current => current.filter(row => row.itemId !== draft.itemId || row.vaultId !== destination));
      setSelected(null); setEditing(false); setEditOriginal(null); setConflict(null);
      await emit("vaults-item-deleted", { vaultId: destination, itemId: draft.itemId }).catch(() => {});
      dirtyRef.current = false;
      await refreshSyncStatus();
      if (generation !== syncReviewGeneration.current) return;
      setLastLocalChange(new Date());
      notify("success", response.result.queued ? "Deletion saved on this device" : "Item deleted",
        response.result.queued ? "It will sync when connected." : "The item has been removed.");
    } catch (error) {
      if (generation !== syncReviewGeneration.current) return;
      await refreshSyncStatus();
      notify("error", "Deletion needs attention", `${friendlyError(error)} Review pending changes before retrying.`);
    } finally { if (generation === syncReviewGeneration.current) setSaving(false); }
  };
  const synchronize = async () => {
    if (syncInFlight.current) return;
    if (!confirmDiscard()) return;
    if (!online) {
      setSettingsTab("profile");
      setSettingsOpen(true);
      setStatus(`Reconnect with your master password to resume sync.${offlineReason ? ` Online unlock failed: ${offlineReason}` : ""}`);
      return;
    }
    try {
      const selectionAtSync = selected;
      const selectionGeneration = openRequest.current;
      syncInFlight.current = true;
      setSyncState("syncing");
      setSyncFailure(null);
      const result = await invoke<{ accepted: number; pending: number; items: Summary[]; vaults: VaultSummary[]; selectedVaultId: string | null; conflicts: EngineConflict[]; vaultSettings?: VaultSettings }>(
        "sync",
        { vaultId },
      );
      setOnline(true);
      setVaults(result.vaults);
      if (result.vaultSettings?.collections) {
        setCollections(result.vaultSettings.collections);
        setDefaultView(result.vaultSettings.defaultView);
        setRemovalPreference(result.vaultSettings.removalPreference);
        setSettingsConflict(result.vaultSettings.conflict);
      }
      const currentRetired = !result.vaults.some((row) => row.vaultId === vaultId && !row.retired);
      if (currentRetired) {
        const fallback = result.selectedVaultId ?? "";
        setVaultId(fallback);
        setItemVaultId(fallback);
        setViewMode(fallback ? "single" : "all");
        setSelected(null);
        setEditing(false);
        setItems(result.items);
      } else {
        const visible = viewMode === "single" ? result.items : await listVisibleItems(result.vaults.filter((row) => !row.retired));
        setItems(visible);
        if (selected?.itemId && !visible.some(row => row.itemId === selected.itemId && (row.vaultId ?? vaultId) === itemVaultId)) {
          await emit("vaults-item-deleted", { vaultId: itemVaultId, itemId: selected.itemId }).catch(() => {});
          setItemTabs(current => current.filter(row => row.itemId !== selected.itemId || row.vaultId !== itemVaultId));
          setSelected(null); setEditing(false); setEditOriginal(null);
        } else if (selectionAtSync?.itemId && !editing) {
          const summary = visible.find(row => row.itemId === selectionAtSync.itemId && (row.vaultId ?? vaultId) === itemVaultId);
          if (summary) {
            const fresh = await loadItem(summary, itemVaultId);
            if (selectionGeneration === openRequest.current) {
              setSelected(fresh);
              setRevealed(new Set());
              setItemTabs(current => current.map(row => row.itemId === summary.itemId && row.vaultId === itemVaultId ? { ...row, ...summary } : row));
            }
          }
        }
      }
      setSyncState("idle");
      await refreshSyncStatus();
      setStatus(
        result.conflicts.length
          ? `Sync needs review · ${result.conflicts.length} pending conflict(s)`
          : `Sync complete · ${result.accepted} pending operation(s) accepted`,
      );
      const pendingConflict = result.conflicts.find((row) => viewMode !== "single" || row.vaultId === vaultId);
      if (pendingConflict && !conflict) {
        // Opening review must not rebind the item still displayed underneath it.
        const draft = await invoke<Item>("conflict_draft", { vaultId: pendingConflict.vaultId, itemId: pendingConflict.itemId, operationId: pendingConflict.operationId });
        setConflict({ vaultId: pendingConflict.vaultId, draft, operationId: pendingConflict.operationId, kind: pendingConflict.kind, message: draft.deleted ? "Your queued deletion meets a server change. Keep the server item, or explicitly delete its current version." : pendingConflict.kind === "delete-edit-divergence" ? "This item was deleted on another device. The queued edit is preserved until you discard it." : "Your queued edit meets a change from another device." });
      }
      const needsReview = result.conflicts.length || result.pending || result.vaultSettings?.pending || result.vaultSettings?.conflict;
      notify(needsReview ? "info" : "success", needsReview ? "Sync needs review" : "Sync complete", needsReview ? "Some changes are still waiting. Open Review sync for affected items and fields." : `${result.accepted} pending change${result.accepted === 1 ? "" : "s"} accepted.`);
      return result;
    } catch (e) {
      const detail = friendlyError(e);
      setStatus(detail);
      setSyncState("error");
      setSyncFailure(detail.includes("409") ? "The server rejected a conflicting request. Review the queued items below; the exact cause is not yet confirmed." : detail);
      await refreshSyncStatus();
      notify("error", "Sync needs attention", detail.includes("409") ? "The server rejected a conflicting request. Open Review sync to inspect queued items and fields." : detail);
      throw e;
    } finally { syncInFlight.current = false; }
  };
  const useServerVersion = async (itemId: string, operationId: string, ownerVaultId = vaultId) => {
    if (conflictBusy) return;
    setConflictBusy(true);
    setConflictError(null);
    try {
      const result = await invoke<{ items: Summary[] }>("discard_conflict", { vaultId: ownerVaultId, itemId, operationId });
      setItems(viewMode === "single" ? result.items : await listVisibleItems());
      setOnline(true);
      setEditing(false);
      setEditOriginal(null);
      setSyncState("idle");
      setSyncFailure(null);
      await refreshSyncStatus();
      const summary = result.items.find((item) => item.itemId === itemId);
      if (summary) await openItem(summary, ownerVaultId);
      else setSelected(null);
      setConflict(null);
      notify(
        "success",
        "Server version restored",
        "The selected local edit was discarded.",
      );
    } catch (error) {
      setConflictError(`Could not use the server version: ${friendlyError(error)}. The queued edit is retained if server verification failed.`);
    } finally { setConflictBusy(false); }
  };
  const copyValue = async (value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setStatus("Copied to clipboard · clears in 30 seconds");
    setTimeout(
      () => navigator.clipboard.writeText("").catch(() => undefined),
      30000,
    );
  };
  const toggleReveal = (key: string) =>
    setRevealed((current) => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const dragValue = (event: React.DragEvent, kind: string, value: string) => {
    const payload = dragSession.begin(kind, value);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", payload);
    // A plain text payload is accepted by native input fields.
  };
  const updateCustom = (id: string, patch: Partial<CustomField>) =>
    selected &&
    setSelected({
      ...selected,
      customFields: selected.customFields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    });
  const addRelated = (type: SectionType, label: string) => {
    if (!selected) return;
    const existing = sections(selected.customFields).filter((section) => section.type === type).length;
    const name = existing ? `${label} ${existing + 1}` : label;
    let fields = addRelatedSection(selected.customFields, type, name);
    const added = sections(fields).at(-1);
    if (added && type === "custom") fields = addSectionField(fields, added.id);
    if (fields.length > 50) { notify("error", "Item is full", "This item supports up to 50 stored fields. Remove an unused detail before adding another."); return; }
    setSelected({ ...selected, customFields: fields });
    setExpandedRelatedId(added?.id ?? null);
  };
  const changePrimaryType = (type: ItemType) => {
    if (!selected || selected.customFields.some(field => field.id === "__127vaults_passkey") || type === itemType(selected.customFields)) return;
    const hasValues = !!(selected.website || selected.username || selected.password || primaryFields(selected.customFields).some((field) => field.value) || sections(selected.customFields).length);
    if (hasValues && !window.confirm("Change the main type? Its current type fields and related details will be removed. Save a copy first if you need them.")) return;
    setSelected({ ...selected, website: "", username: "", password: "", customFields: replaceItemType(selected.customFields, type) });
    setExpandedRelatedId(null);
  };
  const knownFieldEditor = (field: CustomField) => <label key={field.id} className="grid gap-2 text-sm text-slate-400">
    {field.label}
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
      <Input type={field.type === "password" && !revealed.has(field.id) ? "password" : "text"} value={field.value} onChange={(e) => updateCustom(field.id, { value: e.target.value })} />
      {field.type === "password" && <div className="flex gap-2"><IconButton label={`${revealed.has(field.id) ? "Hide" : "Reveal"} ${field.label || "secret"}`} variant="secondary" aria-pressed={revealed.has(field.id)} onClick={() => toggleReveal(field.id)}>{revealed.has(field.id) ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</IconButton><DesktopSecretGenerator generate={generateSecret} label={field.label || "secret"} initialMode={/pin/i.test(field.label) ? "pin" : "password"} onUse={(value) => updateCustom(field.id, { value })} /></div>}
    </div>
  </label>;
  const beginDraft = () => {
    // A late read must not replace an editor the user has started meanwhile.
    openRequest.current++;
    setEditing(true);
  };
  const beginEditing = () => {
    if (saving || !selected) return;
    const draft = { ...selected, customFields: completeRelatedFields(selected.customFields) };
    setEditOriginal(structuredClone(draft));
    setSelected(draft);
    setExpandedRelatedId(null);
    beginDraft();
  };
  const beginNewItem = () => {
    if (saving || !activeVaults.length || !confirmDiscard()) return;
    setSelected({ itemId: "", title: "", website: "", username: "", password: "", customFields: setItemType([], "login") });
    setEditOriginal(null);
    setItemVaultId(viewMode === "single" ? vaultId : "");
    setRevealed(new Set());
    beginDraft();
  };
  const cancelEditing = () => {
    if (!confirmDiscard()) return;
    setSelected(editOriginal);
    setEditOriginal(null);
    setEditing(false);
  };
  useEffect(() => { if (editing) document.querySelector<HTMLInputElement>("[data-editor-title]")?.focus(); }, [editing]);
  const dirty = editing && !!selected && JSON.stringify(selected) !== JSON.stringify(editOriginal ?? { itemId: "", title: "", website: "", username: "", password: "", customFields: setItemType([], "login") });
  dirtyRef.current = dirty;
  const confirmDiscard = () => {
    if (!dirtyRef.current) return true;
    if (!window.confirm("Discard your unsaved changes?")) return false;
    dirtyRef.current = false;
    setEditing(false);
    setSelected(editOriginal);
    return true;
  };
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    let disposed = false, removeClose: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested(event => {
      if (dirtyRef.current && !window.confirm("Discard your unsaved changes and close 127Vaults?")) event.preventDefault();
      else { event.preventDefault(); dirtyRef.current = false; void emit("vaults-locked").catch(() => {}).then(() => invoke("lock")).catch(() => {}).finally(() => getCurrentWindow().destroy()); }
    }).then(unlisten => { if (disposed) unlisten(); else removeClose = unlisten; }).catch(() => {});
    return () => { disposed = true; removeClose?.(); window.removeEventListener("beforeunload", beforeUnload); };
  }, []);
  const refreshSyncStatus = async () => {
    const generation = syncReviewGeneration.current;
    try {
      const result = await invoke<{ pending: number; conflicts: number; lastVerifiedSyncAt: number | null; online?: boolean; offlineReason?: string | null }>("replica_status");
      if (generation !== syncReviewGeneration.current) return;
      setPendingChanges(result.pending);
      setSyncConflicts(result.conflicts);
      if (typeof result.online === "boolean") { setOnline(result.online); setOfflineReason(result.offlineReason ?? null); }
      if (result.lastVerifiedSyncAt) setLastSynced(new Date(result.lastVerifiedSyncAt * 1000));
      else setLastSynced(null);
      try {
        const review = await invoke<SyncReview>("sync_review");
        if (generation === syncReviewGeneration.current) setSyncReview(review);
      }
      catch { if (generation === syncReviewGeneration.current) setSyncReview(null); }
    }
    catch { if (generation === syncReviewGeneration.current) setPendingChanges(null); }
  };
  const reviewQueuedItem = async (row: SyncReviewItem) => {
    if (!row.conflict || !confirmDiscard()) return;
    const generation = syncReviewGeneration.current;
    try {
      const draft = await invoke<Item>("conflict_draft", { vaultId: row.vaultId, itemId: row.itemId, operationId: row.operationId });
      if (generation !== syncReviewGeneration.current) return;
      setSyncReviewOpen(false);
      setConflict({ vaultId: row.vaultId, draft, operationId: row.operationId, kind: row.conflict.kind,
        message: draft.deleted ? "Your queued deletion meets a server change. Keep the server item, or explicitly delete its current version." : row.conflict.kind === "delete-edit-divergence" ? "This item was deleted on another device. Your queued edit is still saved locally." : `Review queued changes to ${row.title || "Untitled item"}. Changed fields: ${row.fields.join(", ") || "not determined"}.` });
    } catch (error) { notify("error", "Could not review item", friendlyError(error)); }
  };
  useEffect(() => { if (unlocked) void refreshSyncStatus(); }, [unlocked]);
  // Ancillary status must not delay presenting the verified, unlocked vault.
  useEffect(() => {
    if (!unlocked) return;
    let disposed = false;
    void invoke<RemovalPlan>("vault_removal_status").then((plan) => {
      if (!disposed) setRemovalPlan(plan);
    }).catch(() => { /* Explicit vault actions report their own errors. */ });
    let licenseBusy = false;
    const refreshLicenseStatus = async () => {
      if (disposed || licenseBusy) return;
      licenseBusy = true;
      try {
        const license = await invoke<NonNullable<typeof licenseStatus>>("license_status");
        if (!disposed) {
          setLicenseStatus(license);
          if (!["active", "read-only"].includes(license.mode)) await lock("A valid license or trial is required. Ask your operator for a replacement license.");
        }
      } catch (error) {
        if (disposed) return;
        // A focus-triggered status request may fail while the local license is still valid.
        // The protected entitlement, including expiry and revocation, decides access.
        try {
          const cached = await invoke<NonNullable<typeof licenseStatus>>("license_access_status");
          if (!disposed) setLicenseStatus(cached);
        } catch {
          // Retry a transient local credential/cache read before revoking the session.
          await new Promise(resolve => window.setTimeout(resolve, 300));
          if (disposed) return;
          try {
            const cached = await invoke<NonNullable<typeof licenseStatus>>("license_access_status");
            if (!disposed) setLicenseStatus(cached);
          } catch (cachedError) { if (!disposed) await lock(String(cachedError)); }
        }
      }
      finally { licenseBusy = false; }
    };
    void refreshLicenseStatus();
    const timer = window.setInterval(() => { if (!document.hidden) void refreshLicenseStatus(); }, 30000);
    window.addEventListener("focus", refreshLicenseStatus);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", refreshLicenseStatus); };
  }, [unlocked, online]);
  // Connector saves use this same encrypted replica. Refresh external writes
  // without replacing an editor draft, and deliver queued writes when online.
  useEffect(() => {
    if (!unlocked || editing || saving) return;
    let disposed = false, busy = false;
    const refreshExternalItems = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const replica = await invoke<{ pending: number }>("replica_status");
        if (disposed || dirtyRef.current) return;
        if (online && replica.pending > 0) {
          try { await invoke("sync", { vaultId }); } catch { /* Show local writes even when delivery fails. */ }
        }
        const next = viewMode === "single" ? await invoke<Summary[]>("item_list", { vaultId }) : await listVisibleItems();
        if (!disposed && !dirtyRef.current) { setItems(next); await refreshSyncStatus(); }
      } catch { /* Explicit Sync reports failures; local items remain intact. */ }
      finally { busy = false; }
    };
    const timer = window.setInterval(() => void refreshExternalItems(), 5000);
    window.addEventListener("focus", refreshExternalItems);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", refreshExternalItems); };
  }, [unlocked, editing, saving, online, vaultId, viewMode, selectedCollectionId, vaults]);
  const loadHealthItems = useCallback(async () => {
    const summaries = await listAllItems();
    const result: Item[] = [];
    for (const summary of summaries) { const item = await loadItem(summary, summary.vaultId); result.push({ ...item, vaultId: summary.vaultId }); }
    return result;
  }, [vaults]);
  const duplicateItem = () => {
    if (saving || !selected || selected.customFields.some(field => field.id === "__127vaults_passkey") || !confirmDiscard()) return;
    setSelected({ ...structuredClone(selected), itemId: "", title: `${selected.title} (copy)`, customFields: setFavorite(selected.customFields, false) });
    setEditOriginal(null); setItemVaultId(vaultId); setRevealed(new Set()); beginDraft();
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!unlocked || healthOpen || settingsOpen || conflict || vaultDialog || collectionDialog || removalDialog || document.querySelector("[role=dialog]")) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && ["k", "f", "n", "s"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if (["k", "f"].includes(event.key.toLowerCase())) searchRef.current?.focus();
        if (event.key.toLowerCase() === "n") beginNewItem();
        if (event.key.toLowerCase() === "s" && editing) document.querySelector<HTMLButtonElement>("[data-save-item]")?.click();
      }
      if (event.key === "Escape" && editing) { event.preventDefault(); cancelEditing(); }
      const target = event.target as HTMLElement;
      if (event.key === "ArrowDown" && target === searchRef.current) { event.preventDefault(); document.querySelector<HTMLButtonElement>("[data-desktop-item]")?.focus(); }
      if (target.matches("[data-desktop-item]") && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const rows = [...document.querySelectorAll<HTMLButtonElement>("[data-desktop-item]")];
        const index = rows.indexOf(target as HTMLButtonElement);
        rows[event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
      }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });
  const configureTrust = async () => {
    if (trustBusy) return;
    setTrustBusy(true);
    setStatus("Checking the private server and CA fingerprint…");
    try {
      await invoke<string>("configure_server_trust", {
        url: trustUrl.trim(), caPath: trustCaPath.trim(), serverId: trustServerId.trim(),
        expectedFingerprint: trustFingerprint.trim(),
      });
      const info = await invoke<DesktopInfo>("desktop_info");
      setDesktopInfo(info);
      setStatus("Server trust saved. Continue with owner setup or device enrollment.");
    } catch (error) { setStatus(friendlyError(error)); }
    finally { setTrustBusy(false); }
  };
  const enrollDesktop = async () => {
    if (enrolling) return;
    const enrolledUsername = registrationUsername.trim();
    if (!enrolledUsername) {
      setStatus("Enter the username of your existing account.");
      return;
    }
    setEnrolling(true);
    setStatus("Starting desktop registration…");
    try {
      await invoke("begin_device_enrollment", { username: enrolledUsername });
      let browserOpened = false;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const progress = await invoke<EnrollmentStatus>(
          "device_enrollment_status",
        );
        if (progress.state === "approval") {
          setStatus(
            `Approve code ${progress.code} in Trusted devices in your browser.`,
          );
          if (!browserOpened && progress.approvalUrl) {
            browserOpened = true;
            await openUrl(progress.approvalUrl);
          }
        } else if (progress.state === "complete") {
          setUsername(enrolledUsername);
          setRegistrationSuccess(true);
          setStatus("Registration complete");
          break;
        } else if (progress.state === "error")
          throw Error(progress.message || "Desktop registration failed");
      }
    } catch (e) {
      setStatus(String(e));
    } finally {
      setEnrolling(false);
    }
  };
  const filtered = useMemo(
    () =>
      items
        .filter((x) =>
          `${x.title} ${x.website}`.toLowerCase().includes(query.toLowerCase()),
        )
        .sort(
          (a, b) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }) ||
            a.website.localeCompare(b.website, undefined, { sensitivity: "base", numeric: true }),
        ),
    [items, query],
  );
  const visibleItems = filtered.filter(item => (!favoritesOnly || item.favorite) && (!(itemLayout === "grid" && wide && typeFilter !== "all") || item.itemType === typeFilter));
  const omniActions = useMemo(() => {
    if (!query.trim()) return [];
    const actions = [
      {
        id: "create-item",
        label: "Create item",
        detail: "Add a new login",
        terms: "create new add item login",
      },
      {
        id: "edit-item",
        label: "Edit selected item",
        detail: selected ? selected.title : "Select an item first",
        terms: "edit modify selected item",
      },
      {
        id: "sync",
        label: "Sync now",
        detail: "Exchange changes with the server",
        terms: "sync refresh server",
      },
      {
        id: "lock",
        label: "Lock vault",
        detail: "Close this secure session",
        terms: "lock logout secure",
      },
    ];
    const needle = query.toLowerCase();
    return actions.filter((action) =>
      `${action.label} ${action.detail} ${action.terms}`
        .toLowerCase()
        .includes(needle),
    );
  }, [query, selected]);
  const runOmniAction = (id: string) => {
    setQuery("");
    if (id === "create-item") {
      setItemVaultId(viewMode === "single" ? vaultId : "");
      setSelected({
        itemId: "",
        title: "",
        website: "",
        username: "",
        password: "",
        customFields: [],
      });
      setEditOriginal(null);
      beginDraft();
    }
    if (id === "edit-item" && selected) beginEditing();
    if (id === "sync") void synchronize();
    if (id === "lock" && confirmDiscard()) void lock();
  };

  if (!unlocked && registrationOpen)
    return (
      <main className="ui-access-shell grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#18203d,#04071d_58%)] p-8">
        <section className="ui-access-card w-full max-w-lg rounded-3xl border border-white/10 bg-[#11162b] p-8 shadow-2xl">
          <div className="mb-6 flex items-center justify-center gap-3"><img src="/wordmark-red.svg" alt="127 Vaults" width="200" height="63" /></div>
          {registrationSuccess ? (
            <div className="grid min-h-[28rem] place-content-center text-center">
              <div className="mx-auto grid size-20 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
                <Check size={42} />
              </div>
              <h1 className="mt-6 text-3xl font-bold">Desktop registered</h1>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-400">
                This computer is now a trusted device. Continue to unlock it
                online once and provision encrypted offline access.
              </p>
              <Button
                className="mt-8 w-full"
                onClick={() => {
                  setRegistrationSuccess(false);
                  setRegistrationOpen(false);
                  setStatus("Ready for your first online unlock.");
                }}
              >
                Continue to unlock
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="ghost"
                className="mb-4 !px-1 text-[#E0BB95]"
                disabled={enrolling}
                onClick={() => setRegistrationOpen(false)}
              >
                ← Back to unlock
              </Button>
              <div className="mb-6">
                <p className="text-xs font-bold tracking-[.16em] text-slate-500">
                  REGISTER
                </p>
                <h1 className="mt-1 text-2xl font-bold">Set up this desktop</h1>
                <p className="mt-2 text-sm text-slate-400">
                  Choose whether you already have a 127Vaults account.
                </p>
              </div>
              <div className="grid gap-5">
                {!desktopInfo?.registrationUrl && <section className="rounded-2xl border border-amber-300/20 bg-amber-300/5 p-5">
                  <h2 className="font-bold">Connect to your private server</h2>
                  <p className="mb-3 mt-1 text-sm text-slate-400">Get the exact HTTPS address, installation ID, public CA certificate file, and SHA-256 CA fingerprint from your server operator. The certificate must match before trust is saved.</p>
                  <Button variant="secondary" className="mb-3" onClick={() => void invoke<{name:string;address:string}[]>("tailscale_peers").then(peers => { setTailnetPeers(peers); setStatus(peers.length ? "Choose your server, then verify its installation ID and CA." : "No online Tailscale peers found."); }).catch(error => setStatus(friendlyError(error)))}>Find Tailscale servers</Button>
                  {tailnetPeers.length > 0 && <select aria-label="Tailscale server" className="mb-3 w-full rounded-xl bg-slate-900 p-3" value={trustUrl} onChange={event => setTrustUrl(event.target.value)}><option value="">Choose your server</option>{tailnetPeers.map(peer => <option key={peer.address} value={`https://${peer.address}:12780`}>{peer.name}</option>)}</select>}
                  <div className="grid gap-2">
                    <Input aria-label="Private server URL" placeholder="https://192.168.1.10:12780" value={trustUrl} onChange={event => setTrustUrl(event.target.value)} />
                    <Input aria-label="Installation ID" placeholder="Installation ID" value={trustServerId} onChange={event => setTrustServerId(event.target.value)} />
                    <Input aria-label="Public CA certificate path" placeholder="Path to ca.crt" value={trustCaPath} onChange={event => setTrustCaPath(event.target.value)} />
                    <Input aria-label="Expected CA SHA-256 fingerprint" placeholder="64-character SHA-256 fingerprint" value={trustFingerprint} onChange={event => setTrustFingerprint(event.target.value)} />
                  </div>
                  <Button className="mt-3 w-full" disabled={trustBusy || !trustUrl || !trustServerId || !trustCaPath || !trustFingerprint} onClick={() => void configureTrust()}>{trustBusy ? "Checking server…" : "Verify and save server trust"}</Button>
                </section>}
                <section className="rounded-2xl border border-white/8 bg-white/3 p-5">
                  <h2 className="font-bold">I already have an account</h2>
                  <p className="mb-4 mt-1 text-sm text-slate-400">
                    Enroll this computer as a trusted device. You’ll approve a
                    one-time code after signing in on the web.
                  </p>
                  <Input
                    aria-label="Registered username"
                    autoComplete="username"
                    value={registrationUsername}
                    onChange={(e) => setRegistrationUsername(e.target.value)}
                    placeholder="Registered username"
                  />
                  <Button
                    className="mt-3 w-full"
                    disabled={enrolling || !desktopInfo?.registrationUrl}
                    onClick={() => void enrollDesktop()}
                  >
                    {enrolling
                      ? "Waiting for web approval…"
                      : "Register this desktop"}
                  </Button>
                </section>
                <section className="rounded-2xl border border-white/8 bg-white/3 p-5">
                  <h2 className="font-bold">This is my first device</h2>
                  <p className="mb-4 mt-1 text-sm text-slate-400">
                    Create the first owner account using the server’s secure
                    setup ceremony.
                  </p>
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={!desktopInfo?.registrationUrl || enrolling}
                    onClick={() =>
                      desktopInfo?.registrationUrl &&
                      void openUrl(desktopInfo.registrationUrl).catch((e) =>
                        setStatus(
                          `Setup page could not be opened: ${String(e)}`,
                        ),
                      )
                    }
                  >
                    Create first owner account
                  </Button>
                  <p className="mt-3 text-xs text-slate-500">
                    Account creation currently completes in the server-hosted
                    setup screen; return here afterward to enroll this desktop.
                  </p>
                </section>
              </div>
              <p
                className="mt-5 min-h-5 text-xs text-slate-400"
                role="status"
                aria-live="polite"
              >
                {status}
              </p>
            </>
          )}
        </section>
      </main>
    );

  if (!unlocked)
    return (
      <main className="ui-access-shell grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#18203d,#04071d_58%)] p-8">
        <section className="ui-access-card w-full max-w-md rounded-3xl border border-white/10 bg-[#11162b] p-8 shadow-2xl">
          <div className="mx-auto mb-5 flex items-center justify-center gap-3"><img src="/wordmark-red.svg" alt="127 Vaults" width="200" height="63" /></div>
          <h1 className="text-center text-2xl font-bold">Unlock 127Vaults</h1>
          <p className="mt-2 text-center text-sm text-slate-400">
            Open your encrypted vault on this device.
          </p>
          <div className="mt-6 grid gap-3">
            <Input
              aria-label="Username"
              aria-invalid={!!errors.username}
              className={
                errors.username ? "border-red-400 ring-4 ring-red-400/10" : ""
              }
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
            />
            {errors.username && (
              <p className="-mt-2 text-xs text-red-300">{errors.username}</p>
            )}
            {(!rememberedSecret || showSecretEntry) && <Input
              aria-label="Account secret"
              aria-invalid={!!errors.accountSecret}
              className={
                errors.accountSecret
                  ? "border-red-400 ring-4 ring-red-400/10"
                  : ""
              }
              type="password"
              autoComplete="off"
              value={accountSecret}
              onChange={(e) => setAccountSecret(e.target.value)}
              placeholder="Account secret"
            />}
            {errors.accountSecret && (
              <p className="-mt-2 text-xs text-red-300">
                {errors.accountSecret}
              </p>
            )}
            {rememberedSecret && !showSecretEntry && <button className="w-fit text-left text-xs text-[#E0BB95]" onClick={() => setShowSecretEntry(true)}>Enter account secret</button>}
            {rememberedSecret && showSecretEntry && <button className="w-fit text-left text-xs text-[#E0BB95]" onClick={() => { setShowSecretEntry(false); setAccountSecret(""); }}>Use saved account secret</button>}
            <Input
              aria-label="Master password"
              aria-invalid={!!errors.masterPassword}
              className={
                errors.masterPassword
                  ? "border-red-400 ring-4 ring-red-400/10"
                  : ""
              }
              type="password"
              autoComplete="current-password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder="Master password"
            />
            {errors.masterPassword && (
              <p className="-mt-2 text-xs text-red-300">
                {errors.masterPassword}
              </p>
            )}
            <Button disabled={busy || enrolling} onClick={unlock}>
              {busy && <LoaderCircle className="animate-spin" size={17} />}
              {busy ? "Unlocking…" : "Unlock encrypted replica"}
            </Button>
          </div>
          {busy && (
            <div className="mt-4" role="status" aria-live="polite">
              <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-white/8">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-[#E0BB95]" />
              </div>
              <p className="text-xs text-slate-400">{status}</p>
            </div>
          )}
          {!busy && status && (
            <p
              className="mt-4 text-xs text-slate-400"
              role="status"
              aria-live="polite"
            >
              {status}
            </p>
          )}
          <div className="mt-5 border-t border-white/8 pt-4 text-center">
            <Button
              variant="ghost"
              className="text-[#E0BB95]"
              disabled={enrolling}
              onClick={() => {
                setRegistrationUsername(username);
                setRegistrationOpen(true);
              }}
            >
              Register or create an account
            </Button>
            {!desktopInfo?.registrationUrl && (
              <p className="mt-2 text-xs text-slate-500">
                Connect this desktop app to your 127Vaults server first.
              </p>
            )}
            <details className="mt-3 text-left text-xs text-slate-500">
              <summary className="cursor-pointer">Connection details</summary>
              <p className="mt-2 break-all">
                Configuration is managed automatically at{" "}
                {desktopInfo?.configurationPath ||
                  "the OS application-data location"}
                .
              </p>
            </details>
          </div>
        </section>
      </main>
    );
  return (
    <div className={cn("desktop-shell grid h-screen grid-cols-[15rem_minmax(18rem,22rem)_1fr] grid-rows-[1fr_2rem] overflow-hidden bg-[#04071d]", sidebarCollapsed && "sidebar-collapsed", itemLayout === "grid" && "desktop-grid", viewMode !== "single" && "desktop-multi-vault")}>
      <aside className={cn("desktop-sidebar row-span-2 flex flex-col border-r border-white/7 bg-[#0a0e21] p-3", compactNavOpen && "menu-open")}>
        <div className="desktop-brand mb-7 flex items-center gap-3 px-2 py-3">
          <button type="button" className="sidebar-brand-toggle flex min-w-0 items-center gap-3" aria-label={compactSidebar ? "Toggle navigation" : sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={compactSidebar ? compactNavOpen : !sidebarCollapsed} onClick={() => { if (compactSidebar) { setCompactNavOpen(open => !open); return; } const next = !sidebarCollapsed; setSidebarCollapsed(next); try { localStorage.setItem("127vaults:sidebar-collapsed", String(next)); } catch {} }}>{sidebarCollapsed && !compactSidebar && <img src="/brand-mark.svg" alt="127 Vaults" className="size-9 shrink-0" />}<strong><img src="/wordmark-red.svg" alt="127 Vaults" width="127" height="40" /></strong></button>
          {licenseStatus && licenseStatus.mode !== "active" && <button type="button" className="desktop-license-warning text-amber-300" aria-label="License issue" title={licenseStatus.mode === "read-only"
            ? "License expired: vault and invitation writes are blocked during the 30-day read-only period. Install a renewed license on the server."
            : licenseStatus.mode === "revoked"
              ? "License revoked: vault access is blocked. Ask the server operator for a replacement license."
              : licenseStatus.mode === "locked"
                ? "License locked: vault access is blocked. Check expiry and the server clock."
                : "A valid license is required. Ask the operator for a signed license."}><AlertTriangle size={17} aria-hidden="true" /></button>}

        </div>
        <nav ref={node => { node?.querySelectorAll("button").forEach(button => { const label = button.textContent?.trim(); if (label && !button.getAttribute("aria-label")) { button.setAttribute("aria-label", label); button.title = label; } }); }} className="desktop-nav-content flex min-h-0 flex-1 flex-col overflow-auto" aria-label="Vaults and collections" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) setCompactNavOpen(false); }}>
        <div className="desktop-nav-row"><Button variant="ghost" className={cn("min-w-0 flex-1 justify-start", viewMode === "all" && !favoritesOnly && "bg-white/7")} onClick={() => void selectAllVaults()}>
          <LayoutList size={17} />
          <span>All items</span>
          <span className="ml-auto">{items.length}</span>
        </Button></div>
        <Button variant="ghost" className={cn("justify-start", favoritesOnly && "bg-white/7")} onClick={() => void selectAllVaults(true)}><Star size={17} /><span>Favorites</span></Button>
        <Button variant="ghost" className="justify-start" onClick={() => setHealthOpen(true)}><ShieldCheck size={17} /><span>Password health</span></Button>
        <div className="desktop-nav-heading mb-2 mt-6 flex items-center justify-between gap-2 px-3"><p className="text-[10px] font-bold tracking-[.16em] text-slate-600">VAULTS</p><IconButton label="Add vault" className="!size-9 !min-h-9" onClick={() => { if (!online) { setSettingsTab("profile"); setSettingsOpen(true); return; } setVaultNameDraft(""); setVaultDialog("create"); }}><Plus size={16} aria-hidden="true" /></IconButton></div>
        {activeVaults.map((vault) => <div className="desktop-nav-row" key={vault.vaultId}><Button variant="ghost" className={cn("min-w-0 flex-1 justify-start", viewMode === "single" && vault.vaultId === vaultId && "bg-white/10")} onClick={() => void selectVault(vault.vaultId)}>
          <Vault size={17} />
          <span className="truncate">{vault.name}</span>
        </Button><details className="desktop-row-menu"><summary aria-label={`Actions for ${vault.name}`} title={`Actions for ${vault.name}`}><MoreHorizontal size={17} /></summary><div><button onClick={() => { setVaultActionId(vault.vaultId); setVaultNameDraft(vault.name); setVaultDialog("rename"); }}>Rename vault</button><button onClick={() => openRemoval(vault.vaultId)}>Remove vault…</button></div></details></div>)}
        <p className="mb-2 mt-6 px-3 text-[10px] font-bold tracking-[.16em] text-slate-600">COLLECTIONS</p>
        {collections.map((collection) => <div className="desktop-nav-row" key={collection.id}><Button variant="ghost" className={cn("min-w-0 flex-1 justify-start", viewMode === "collection" && selectedCollectionId === collection.id && "bg-white/10")} onClick={() => void selectCollection(collection.id)}>
          <LayoutList size={17} /><span className="truncate">{collection.name}</span>
        </Button><details className="desktop-row-menu"><summary aria-label={`Actions for ${collection.name}`} title={`Actions for ${collection.name}`}><MoreHorizontal size={17} /></summary><div><button onClick={() => { setSelectedCollectionId(collection.id); setCollectionNameDraft(collection.name); setCollectionVaultDraft(collection.vault_ids); setCollectionDialog("edit"); }}>Edit collection</button><button onClick={() => void removeCollection(collection.id)}>Remove collection</button></div></details></div>)}
        <Button variant="ghost" className="justify-start text-xs" onClick={() => { setCollectionNameDraft(""); setCollectionVaultDraft([]); setCollectionDialog("create"); }}><Plus size={17} /><span>Add collection</span></Button>
        {settingsConflict && <Button variant="ghost" className="justify-start text-xs text-amber-300" onClick={() => void invoke<{local: unknown; server: unknown}>("vault_settings_review").then(setSettingsReview).catch((error) => notify("error", "Could not review settings", friendlyError(error)))}>Review vault settings conflict</Button>}
        {removalPlan?.pending && <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/8 p-3 text-xs text-amber-100" role="status"><strong>Vault operation needs attention</strong><p className="mt-1">{removalPlan.choice === "move" ? "Move" : removalPlan.choice === "restore" ? "Restore" : "Archive"} · {removalPlan.stage === "copying" ? "copying items" : "finalizing request"} · {removalPlan.itemMappings?.length ?? 0} mapped item(s)</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={!online || removalBusy} onClick={resumeRemoval}>Resume</Button>{removalPlan.choice === "move" && removalPlan.stage === "copying" && <Button size="sm" variant="ghost" disabled={removalBusy} onClick={() => void abortMove()}>Keep copies and clear plan</Button>}</div></div>}
        <div className="mt-auto grid gap-1">
          <Button variant="ghost" className="justify-start" onClick={() => setSettingsOpen(true)}><Settings size={17} /><span>Settings</span></Button>
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() => void synchronize().catch(() => {})}
          >
            <RefreshCw size={17} /><span>{online ? "Sync now" : "Reconnect"}</span>
          </Button>
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() => { if (confirmDiscard()) void lock(); }}
          >
            <LockKeyhole size={17} />
            <span>Lock</span>
          </Button>
        </div>
        </nav>
      </aside>
      <section className="desktop-list overflow-hidden border-r border-white/7 bg-[#080c1d]">
        <header className="border-b border-white/7 p-4">
          <div className="relative">
            <Search
              className="absolute left-3 top-3 text-slate-500"
              size={17}
            />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
              placeholder="Search items or run an action…"
              aria-label="Search items and actions"
            />
          </div>
          {!!omniActions.length && (
            <div className="absolute z-30 mt-2 w-[calc(100%-2rem)] rounded-xl border border-white/10 bg-[#11162b] p-1 shadow-2xl">
              {omniActions.map((action) => (
                <button
                  key={action.id}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/8"
                  onClick={() => runOmniAction(action.id)}
                >
                  <Search size={15} className="text-[#E0BB95]" />
                  <span>
                    <b className="block text-sm">{action.label}</b>
                    <small className="text-slate-500">{action.detail}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </header>
        <div className="desktop-list-heading flex items-center justify-between gap-3 px-5 pb-3 pt-5">
          <h1 className="text-xl font-bold">{favoritesOnly ? "Favorites" : viewMode === "all" ? "All items" : viewMode === "collection" ? collections.find((row) => row.id === selectedCollectionId)?.name ?? "Collection" : vaults.find((vault) => vault.vaultId === vaultId)?.name ?? "Items"}</h1>
          <div className="desktop-list-actions ml-auto flex items-center gap-2">
          <div className="desktop-layout-toggle rounded-xl border border-white/10 bg-white/4 p-1" role="group" aria-label="Item layout">
            <button type="button" className={cn("rounded-lg p-2", itemLayout === "list" ? "bg-[#E0BB95]/15 text-[#E0BB95]" : "text-slate-400 hover:text-white")} aria-label="List view" aria-pressed={itemLayout === "list"} onClick={() => changeItemLayout("list")}><LayoutList size={17} /></button>
            <button type="button" className={cn("rounded-lg p-2", itemLayout === "grid" ? "bg-[#E0BB95]/15 text-[#E0BB95]" : "text-slate-400 hover:text-white")} aria-label="Grid view" aria-pressed={itemLayout === "grid"} onClick={() => changeItemLayout("grid")}><LayoutGrid size={17} /></button>
          </div>
          <Button
            title={activeVaults.length ? "New item" : "Create or restore a vault before adding items"}
            disabled={saving || !activeVaults.length}
            onClick={beginNewItem}
          >
            <Plus size={18} />
            <span>New item</span>
          </Button>
          </div>
        </div>
        <div className="desktop-browse-controls" role="group" aria-label="Filter and group items">{([ ["all", "All"], ["updated", "Updated"], ["created", "Created"], ["type", "Item type"] ] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={browseMode === mode} className={browseMode === mode ? "active" : ""} onClick={() => setBrowseMode(mode)}>{label}</button>)}<label className="desktop-type-filter">Type <select aria-label="Filter by item type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | ItemType)}><option value="all">All types</option>{(Object.keys(ITEM_TYPES) as ItemType[]).map((type) => <option key={type} value={type}>{ITEM_TYPES[type].label}</option>)}</select></label></div>
        <div className="desktop-items overflow-auto px-3">
          <div className="desktop-grid-head" aria-hidden="true"><span>Item</span><span>Website</span><span>Type</span><span>Last modified</span><span>Item ID</span>{viewMode !== "single" && <span>Vault</span>}</div>
          {!visibleItems.length && <div className="desktop-empty-state rounded-xl border border-dashed border-white/10 px-4 py-8 text-center"><h2 className="text-base font-semibold">{!activeVaults.length ? "Create your first vault" : favoritesOnly && !query ? "No favorites yet" : !items.length && !query ? "Add your first item" : "No matching items"}</h2><p className="mt-2 text-sm text-slate-400">{!activeVaults.length ? "Start with a vault, or restore an archived one in Settings." : favoritesOnly && !query ? "Star an item to keep it handy here." : !items.length && !query ? "Add a login, card, or another detail you want to keep handy." : "Try a different search or item type."}</p>{!activeVaults.length ? <Button className="mt-5" onClick={() => { if (!online) { setSettingsTab("profile"); setSettingsOpen(true); return; } setVaultNameDraft(""); setVaultDialog("create"); }}><Plus size={16} aria-hidden="true" />{online ? "Create vault" : "Reconnect to create vault"}</Button> : !favoritesOnly && !items.length && !query && <Button className="mt-5" onClick={beginNewItem}><Plus size={16} aria-hidden="true" />Add item</Button>}</div>}
          {browseGroups(visibleItems, itemLayout === "grid" && wide ? browseMode : "all", (item) => item).map((group) => <div className="desktop-item-group" key={group.key}>
          {itemLayout === "grid" && browseMode !== "all" && <div className="desktop-group-heading"><span>{group.label}</span><span>{group.items.length}</span></div>}
          {group.items.map((item) => (
            <button
              key={`${item.vaultId || vaultId}:${item.itemId}`}
              data-desktop-item="true"
              onClick={() => void openItem(item)}
              className={cn(
                "desktop-item-row mb-1 grid w-full grid-cols-[2.5rem_1fr] gap-3 rounded-xl p-3 text-left hover:bg-white/7",
                selected?.itemId === item.itemId && "bg-white/10",
              )}
              aria-current={selected?.itemId === item.itemId ? "true" : undefined}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-[#E0BB95]/12 text-[#E0BB95]">
                <KeyRound size={18} />
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-sm">{item.favorite && <Star size={12} className="mr-1 inline text-[#E0BB95]" aria-label="Favorite" />}{item.title}</strong>
                <small className="text-slate-500">{item.website}{viewMode === "all" && activeVaults.length > 1 && item.vaultId ? ` · ${vaults.find((vault) => vault.vaultId === item.vaultId)?.name ?? ""}` : ""}</small>
              </span>
              <span className="desktop-grid-website min-w-0 truncate text-sm text-slate-400">{item.website || "—"}</span>
              <span className="desktop-grid-type min-w-0 truncate text-xs text-slate-400">{ITEM_TYPES[item.itemType as ItemType]?.label || "Type unavailable"}</span>
              <span className="desktop-grid-modified min-w-0 truncate text-xs text-slate-400">{browseColumnValue("updated", item)}</span>
              <span className="desktop-grid-id min-w-0 truncate font-mono text-xs text-slate-500" title={item.code}>{item.code}</span>
              {viewMode !== "single" && <span className="desktop-grid-vault min-w-0 truncate text-xs text-slate-400">{vaults.find((vault) => vault.vaultId === item.vaultId)?.name || "—"}</span>}
            </button>
          ))}
          </div>)}
        </div>
      </section>
      <main className={cn("desktop-detail overflow-auto p-7", (selected || itemTabs.length > 0) && "detail-selected")}>
        {itemTabs.length > 0 && <div className="item-tabs" role="tablist" aria-label="Open items">{itemTabs.map(tab => <div key={`${tab.vaultId}:${tab.itemId}`} className="item-tab"><button role="tab" aria-selected={selected?.itemId === tab.itemId && itemVaultId === tab.vaultId} onClick={() => void openItem(tab)}>{tab.title || "Untitled"}</button><button aria-label={`Close tab ${tab.title}`} onClick={() => { if (!confirmDiscard()) return; setItemTabs(current => current.filter(row => row !== tab)); if (selected?.itemId === tab.itemId && itemVaultId === tab.vaultId) { setSelected(null); setEditing(false); } }}><X size={14} /></button></div>)}</div>}
        {healthOpen && <PasswordHealth scope="All active vaults" load={loadHealthItems} close={() => setHealthOpen(false)} open={finding => { setHealthOpen(false); void openItem({ itemId: finding.itemId, vaultId: finding.vaultId, title: finding.title, website: "", code: "" }); }} />}
        {selected && editing && <div className="desktop-back-row"><Button variant="ghost" aria-label="Close item details" onClick={() => { if (confirmDiscard()) { setSelected(null); setEditing(false); } }}><X size={17} aria-hidden="true" /> Close</Button></div>}
        {selected ? (
          <div className="mx-auto max-w-3xl">
            {editing ? (
              <>
                <div className="ui-page-header desktop-edit-header mb-7 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold tracking-[.16em] text-slate-500">
                      {selected.itemId ? "EDIT ITEM" : "NEW ITEM"}
                    </p>
                    <h2 className="mt-1 text-3xl font-bold">
                      {selected.itemId ? "Edit item" : "Create item"}
                    </h2>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={cancelEditing}>
                      Cancel
                    </Button>
                    <Button data-save-item disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
                  </div>
                </div>
                {!selected.itemId && viewMode !== "single" && <label className="mb-6 block text-sm text-slate-300">Destination vault
                  <select className="mt-2 w-full rounded-xl border border-white/15 bg-[#11162b] p-3" value={itemVaultId} onChange={(event) => setItemVaultId(event.target.value)}>
                    <option value="">Choose a vault</option>
                    {activeVaults.filter((vault) => viewMode !== "collection" || collections.find((row) => row.id === selectedCollectionId)?.vault_ids.includes(vault.vaultId)).map((vault) => <option key={vault.vaultId} value={vault.vaultId}>{vault.name} · {vault.code}</option>)}
                  </select>
                </label>}
                <label className="mb-4 flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={isFavorite(selected.customFields)} onChange={e => setSelected({ ...selected, customFields: setFavorite(selected.customFields, e.target.checked) })} />Favorite</label>
                <section>
                  <h3 className="mb-3 text-xs font-bold tracking-[.1em] text-slate-500">
                    BASICS
                  </h3>
                  <div className="grid gap-4">
                    <div className="desktop-title-fields grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-start">
                      <label className="grid gap-2 text-sm text-slate-400">
                        Title
                        <Input
                          data-editor-title
                          value={selected.title}
                          aria-invalid={!!errors.title}
                          className={errors.title ? "border-red-400 ring-4 ring-red-400/10" : ""}
                          onChange={(e) => setSelected({ ...selected, title: e.target.value })}
                        />
                        {errors.title && <span className="text-xs text-red-300">{errors.title}</span>}
                      </label>
                      <div className="grid gap-2 text-sm text-slate-400"><span>Type</span><TypePicker value={itemType(selected.customFields)} onSelect={changePrimaryType} /></div>
                    </div>
                    {ITEM_TYPES[itemType(selected.customFields)].website && <label className="grid gap-2 text-sm text-slate-400">
                      Website
                      <Input
                        readOnly={selected.customFields.some(field => field.id === "__127vaults_passkey")}
                        value={selected.website}
                        onChange={(e) =>
                          setSelected({ ...selected, website: e.target.value })
                        }
                      />
                    </label>}
                  </div>
                </section>
                <section className="ui-page-section mt-8">
                  <h3 className="mb-3 text-xs font-bold tracking-[.1em] text-slate-500">
                    {ITEM_TYPES[itemType(selected.customFields)].label.toUpperCase()}
                  </h3>
                  <div className="grid gap-4">
                    {ITEM_TYPES[itemType(selected.customFields)].username && <label className="grid gap-2 text-sm text-slate-400">
                      Username
                      <Input
                        readOnly={itemType(selected.customFields) === "passkey"}
                        value={selected.username}
                        onChange={(e) =>
                          setSelected({ ...selected, username: e.target.value })
                        }
                      />
                    </label>}
                    {ITEM_TYPES[itemType(selected.customFields)].password && <label className="grid gap-2 text-sm text-slate-400">
                      Password
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <Input
                          type={revealed.has("password") ? "text" : "password"}
                          value={selected.password}
                          onChange={(e) =>
                            setSelected({
                              ...selected,
                              password: e.target.value,
                            })
                          }
                        />
                        <div className="flex gap-2"><IconButton
                          label={revealed.has("password") ? "Hide password" : "Reveal password"}
                          aria-pressed={revealed.has("password")}
                          variant="secondary"
                          onClick={() => toggleReveal("password")}
                        >
                          {revealed.has("password") ? (
                            <EyeOff size={16} />
                          ) : (
                            <Eye size={16} />
                          )}
                        </IconButton>
                        <DesktopSecretGenerator generate={generateSecret} onUse={(password) => setSelected((current) => current ? { ...current, password } : current)} />
                        </div>
                      </div>
                    </label>}
                    {primaryFields(selected.customFields).map(knownFieldEditor)}
                  </div>
                </section>
                <PasskeyDetails fields={selected.customFields} onRemove={() => setSelected({ ...selected, customFields: [...setItemType(selected.customFields.filter(f => f.id !== "__127vaults_passkey" && f.id !== "__127vaults_passkey_key"), itemType(selected.customFields) === "passkey" ? "login" : itemType(selected.customFields)), { id: "__127vaults_remove_passkey", label: "Remove passkey", type: "metadata", value: "true" }] })} />
                {(itemType(selected.customFields) !== "passkey" || selected.customFields.some(f => f.id === TOTP_ID && f.value)) && <AuthenticatorEditor value={selected.customFields.find(f => f.id === TOTP_ID)?.value || ""} onChange={value => setSelected({ ...selected, customFields: setAuthenticator(selected.customFields, value) })} />}
                <section className="ui-page-section mt-8 border-t border-white/10 pt-7">
                  <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-xs font-bold tracking-[.1em] text-slate-500">RELATED TO THIS {ITEM_TYPES[itemType(selected.customFields)].label.toUpperCase()}</h3><p className="mt-2 text-sm text-slate-400">Keep cards, logins, and other details together with this item. Name each one so it is easy to find.</p></div><span className="shrink-0 text-xs text-slate-500">{sections(selected.customFields).length} added</span></div>
                  <div className="grid gap-3">{sections(selected.customFields).map((section) => <div key={section.id} className="overflow-hidden rounded-xl border border-white/12 bg-white/3">
                    <div className="flex flex-wrap items-center gap-3 p-4">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#E0BB95]/12 text-[#E0BB95]"><KeyRound size={17} /></span>
                      <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={expandedRelatedId === section.id} onClick={() => setExpandedRelatedId(expandedRelatedId === section.id ? null : section.id)}><strong className="block truncate text-sm text-slate-100">{section.label}</strong><span className="mt-1 block text-xs text-slate-500">{section.type === "custom" ? CUSTOM_SECTION.label : SECTION_TYPES[section.type].label} · {section.fields.filter((field) => field.value).length} field(s) added</span></button>
                      <Button size="sm" variant="ghost" onClick={() => setExpandedRelatedId(expandedRelatedId === section.id ? null : section.id)}>{expandedRelatedId === section.id ? "Done" : "Edit"}</Button>
                      <Button size="sm" variant="ghost" title={`Remove ${section.label}`} onClick={() => { setSelected({ ...selected, customFields: removeSection(selected.customFields, section.id) }); if (expandedRelatedId === section.id) setExpandedRelatedId(null); }}><Trash2 size={15} /><span>Remove</span></Button>
                    </div>
                    {expandedRelatedId === section.id && <div className="grid gap-4 border-t border-white/10 p-4">
                      <label className="grid gap-2 text-sm text-slate-400">Name<Input value={section.label} onChange={(event) => setSelected({ ...selected, customFields: renameSection(selected.customFields, section.id, event.target.value) })} placeholder="e.g. Daily spending card" /></label>
                      {section.type === "custom" ? section.fields.map((field) => <div key={field.id} className="grid gap-2 rounded-lg border border-white/10 p-3 sm:grid-cols-[1fr_8rem]">
                        <label className="grid gap-2 text-xs text-slate-400">Field name<Input value={field.label} aria-invalid={!!errors[`custom-${field.id}`]} onChange={(event) => updateCustom(field.id, { label: event.target.value })} /></label>
                        <label className="grid gap-2 text-xs text-slate-400">Kind<FieldTypePicker value={field.type || "text"} onChange={(type) => updateCustom(field.id, { type })} options={["text", "password", "url", "number"]} /></label>
                        <div className="sm:col-span-2">{knownFieldEditor(field)}</div>
                        <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setSelected({ ...selected, customFields: selected.customFields.filter((row) => row.id !== field.id) })}><Trash2 size={14} />Remove field</Button>
                      </div>) : section.fields.map(knownFieldEditor)}
                      {section.type === "custom" && <Button variant="secondary" className="justify-self-start" onClick={() => { if (selected.customFields.length >= 50) { notify("error", "Item is full", "Remove an unused field before adding another."); return; } setSelected({ ...selected, customFields: addSectionField(selected.customFields, section.id) }); }}><Plus size={15} />Add field</Button>}
                    </div>}
                  </div>)}</div>
                  <RelatedPicker type={itemType(selected.customFields)} onSelect={addRelated} />
                </section>
                <section className="ui-page-section mt-8">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-bold tracking-[.1em] text-slate-500">
                      CUSTOM FIELDS
                    </h3>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setSelected({
                          ...selected,
                          customFields: [
                            ...selected.customFields,
                            {
                              id: crypto.randomUUID(),
                              label: "",
                              type: "text",
                              value: "",
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={16} />
                      <span>Add field</span>
                    </Button>
                  </div>
                  <div className="grid gap-2">
                    {ordinaryFields(selected.customFields).map((field) => (
                      <div
                        key={field.id}
                        className="desktop-custom-field grid grid-cols-[minmax(8rem,1fr)_8rem_minmax(10rem,2fr)_auto] gap-2"
                      >
                        <Input
                          aria-label="Field name"
                          aria-invalid={!!errors[`custom-${field.id}`]}
                          className={
                            errors[`custom-${field.id}`]
                              ? "border-red-400 ring-4 ring-red-400/10"
                              : ""
                          }
                          value={field.label}
                          onChange={(e) =>
                            updateCustom(field.id, { label: e.target.value })
                          }
                        />
                        <FieldTypePicker value={field.type || "text"} onChange={(type) => updateCustom(field.id, { type })} />
                        <div className={field.type === "password" ? "grid grid-cols-[minmax(0,1fr)_auto] gap-2" : "grid"}>
                          <Input
                            type={
                              field.type === "password" && !revealed.has(field.id)
                                ? "password"
                                : "text"
                            }
                            value={field.value}
                            onChange={(e) =>
                              updateCustom(field.id, { value: e.target.value })
                            }
                          />
                          {field.type === "password" && <div className="flex gap-2"><IconButton label={`${revealed.has(field.id) ? "Hide" : "Reveal"} ${field.label || "secret"}`} variant="secondary" aria-pressed={revealed.has(field.id)} onClick={() => toggleReveal(field.id)}>{revealed.has(field.id) ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</IconButton><DesktopSecretGenerator generate={generateSecret} label={field.label || "secret"} onUse={(value) => updateCustom(field.id, { value })} /></div>}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Remove field"
                          onClick={() =>
                            setSelected({
                              ...selected,
                              customFields: selected.customFields.filter(
                                (row) => row.id !== field.id,
                              ),
                            })
                          }
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <>
<ReadonlyItem item={selected} revealed={revealed} toggleReveal={toggleReveal} copyValue={copyValue} dragValue={dragValue} endDrag={() => dragSession.end()} openWebsite={url => void openUrl(url)} actions={<>
                      <IconButton label={isFavorite(selected.customFields) ? "Remove from favorites" : "Add to favorites"} aria-pressed={isFavorite(selected.customFields)} disabled={saving} onClick={() => void save({ ...selected, customFields: setFavorite(selected.customFields, !isFavorite(selected.customFields)) })}><Star size={17} fill={isFavorite(selected.customFields) ? "currentColor" : "none"} /></IconButton>{!selected.customFields.some(f => f.id === "__127vaults_passkey") && <Button variant="ghost" disabled={saving} onClick={duplicateItem}>Duplicate</Button>}<Button variant="secondary" disabled={saving} onClick={beginEditing}>Edit</Button><IconButton label="Delete item" disabled={saving || busy} onClick={() => void deleteItem()}><Trash2 size={17} /></IconButton><IconButton label="Keep in tab" onClick={pinItem}><PanelsTopLeft size={17} aria-hidden="true" /></IconButton><IconButton label="Open in window" onClick={() => void popOutItem()}><ExternalLink size={17} aria-hidden="true" /></IconButton>
                      <Button variant="ghost" aria-label="Close item details" onClick={() => { if (confirmDiscard()) { setSelected(null); setEditing(false); } }}><X size={17} aria-hidden="true" /> Close</Button></>} />
              </>
            )}
          </div>
        ) : (
          <div className="grid h-full place-content-center gap-2 text-center"><KeyRound className="mx-auto mb-2 text-[#E0BB95]" size={28} aria-hidden="true" /><h2 className="text-xl font-semibold">Select an item</h2><p className="text-sm text-slate-400">Choose an item from the list to see its details.</p></div>
        )}
      </main>
      <footer
        className="relative col-span-2 flex items-center gap-2 border-t border-white/7 bg-[#080c1d] px-4 text-[11px] text-slate-500"
        onContextMenu={(event) => {
          event.preventDefault();
          setFooterMenu(true);
        }}
        title="Right-click for sync options"
      >
        <span
          className={cn(
            "size-2 rounded-full",
            syncState === "error" ? "bg-red-400" : syncConflicts || syncReview?.unverifiedAcknowledgements || !online ? "bg-amber-400" : "bg-emerald-400",
          )}
        ></span>
        <strong>{syncState === "syncing" ? "Syncing…" : syncState === "error" ? "Sync failed" : syncReview?.unverifiedAcknowledgements ? "Needs verification" : syncConflicts || syncReview?.items.some(row => row.error) ? "Needs review" : online ? "Online" : "Offline"}</strong><span>{pendingChanges === null ? "Pending changes unknown" : `${pendingChanges} change${pendingChanges === 1 ? "" : "s"} waiting to sync`}</span><Button size="sm" variant="ghost" className="!h-6 !min-h-6 px-2 text-xs" disabled={syncState === "syncing"} onClick={() => void synchronize().catch(() => {})}>{syncState === "error" ? "Retry sync" : "Sync now"}</Button>
        {(syncState === "error" || syncConflicts > 0 || (pendingChanges ?? 0) > 0 || (syncReview?.unverifiedAcknowledgements ?? 0) > 0) && <Button size="sm" variant="ghost" className="!h-6 !min-h-6 px-2 text-xs text-amber-200" onClick={() => { setSyncReviewOpen(true); void refreshSyncStatus(); }}>Review sync</Button>}
        <span className="ml-auto">
          Local change{" "}
          {lastLocalChange
            ? lastLocalChange.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—"}{" "}
          · Last verified server sync{" "}
          {lastSynced
            ? lastSynced.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—"}
        </span>
        {footerMenu && (
          <div
            className="absolute bottom-7 right-3 z-40 w-64 rounded-xl border border-white/10 bg-[#11162b] p-1 text-sm text-slate-100 shadow-2xl"
            onMouseLeave={() => setFooterMenu(false)}
          >
            <button
              className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/8"
              onClick={() => {
                setFooterMenu(false);
                void synchronize();
              }}
            >
              {online ? "Sync now" : "Reconnect"}
            </button>
            <button
              className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/8"
              onClick={() => {
                setFooterMenu(false);
                setConflict({
                  draft: selected ?? {
                    itemId: "",
                    title: "",
                    website: "",
                    username: "",
                    password: "",
                    customFields: [],
                  },
                  message: "Discard local edits and reload the server version?",
                });
              }}
            >
              Use server version…
            </button>
          </div>
        )}
      </footer>
      <div
        className="pointer-events-none fixed right-5 top-5 z-50 grid w-80 gap-2"
        aria-live="polite"
      >
        {notices.map((notice) => (
          <div
            key={notice.id}
            className={`pointer-events-auto rounded-xl border p-4 shadow-2xl ${notice.kind === "error" ? "border-red-400/25 bg-[#2a1118]" : notice.kind === "success" ? "border-emerald-400/25 bg-[#10251f]" : "border-white/10 bg-[#11162b]"}`}
          >
            <div className="flex gap-3">
              {notice.kind === "error" ? (
                <AlertTriangle className="shrink-0 text-red-300" size={18} />
              ) : (
                <Check className="shrink-0 text-emerald-300" size={18} />
              )}
              <div>
                <b className="block text-sm">{notice.title}</b>
                {notice.detail && (
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    {notice.detail}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {importOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <section className="max-h-[90vh] overflow-auto w-full max-w-lg space-y-5 rounded-2xl border border-white/10 bg-[#0a0e21] p-6">
          <h2 id="import-title" className="text-xl font-semibold">Import passwords</h2>
          <p>{importVaultId === "__source_vaults__" ? "Create separate vaults from the source grouping. Existing vaults are kept; duplicate names get an imported suffix. An online connection is required." : "Import all items into the selected existing vault, or choose Source vaults to preserve the source grouping."} Files are read on this device; repeating an import creates duplicates.</p>
          <label className="block">Import into vault<select className="ml-3 rounded bg-slate-800 p-2" aria-label="Import into vault" value={importVaultId} disabled={importBusy} onChange={event => { setImportVaultId(event.target.value); setImportCount(null); setImportSourceVaults([]); setImportError(null); }}>
            <option value="" disabled>Choose a destination</option><option value="__source_vaults__" disabled={!online}>Source vaults</option>{activeVaults.map(vault => <option key={vault.vaultId} value={vault.vaultId}>{vault.name}</option>)}
          </select></label>
          <label className="block">Source<select className="ml-3 rounded bg-slate-800 p-2" value={importFormat} disabled={importBusy} onChange={e => { setImportFormat(e.target.value); setImportCount(null); setImportSourceVaults([]); setImportFile(null); setImportAvailableVaults([]); setImportSelectedVaults(null); setImportSkipped(null); }}>
            <option value="bitwarden">Bitwarden JSON (unencrypted)</option><option value="1password">1Password 1PUX</option><option value="lastpass">LastPass CSV</option><option value="127vaults">127Vaults JSON</option>
          </select></label>
          <input key={importFormat} type="file" accept={importFormat === "1password" ? ".1pux" : importFormat === "lastpass" ? ".csv" : ".json"} disabled={importBusy} onChange={e => { setImportFile(e.target.files?.[0] ?? null); setImportAvailableVaults([]); setImportSelectedVaults(null); setImportSkipped(null); setImportCount(null); setImportSourceVaults([]); }} />
          <p className="text-sm text-slate-400">Login records are supported. Supported credentials and readable notes are imported. Passkeys, attachments and other vendor item types must be migrated separately. Delete plaintext source files when finished.</p>
          {importFormat === "1password" && importSelectedVaults !== null && <fieldset className="grid gap-2 rounded-xl border border-white/10 p-3" disabled={importBusy}><legend className="px-1 font-semibold">Source vaults to import</legend><p className="text-sm text-slate-400">Choose vaults from the account export. Supported type: Logins.</p><div className="max-h-44 overflow-auto">{importAvailableVaults.map(vault => <label key={vault.id} className="flex gap-2 py-1 text-sm"><input type="checkbox" checked={importSelectedVaults.includes(vault.id)} disabled={!vault.records} onChange={event => { setImportSelectedVaults(event.target.checked ? [...importSelectedVaults, vault.id] : importSelectedVaults.filter(id => id !== vault.id)); setImportCount(null); setImportSourceVaults([]); setImportError(null); }} /><span>{vault.name || "Unnamed vault"}{vault.account ? ` · ${vault.account}` : ""} · {vault.records} supported logins</span></label>)}</div></fieldset>}
          {importSkipped && importFormat === "1password" && <p className="text-sm text-amber-200" role="status">Excluded from this export: {importSkipped.items} unsupported items and {importSkipped.attachments} attachment files. Login credentials are imported even when their attachments are excluded. Keep the source export for anything excluded.</p>}
          {importCount !== null && <p>{importCount} items ready to import.</p>}
          {importSourceVaults.length > 0 && <div className="max-h-40 overflow-auto text-sm"><p className="font-semibold">Vaults to create</p><ul>{importSourceVaults.map((vault, index) => <li key={index}>{vault.name} · {vault.records} items</li>)}</ul></div>}
          {importError && <p role="alert" className="text-amber-300">{importError}</p>}
          <div className="flex justify-end gap-3"><Button variant="ghost" disabled={importBusy} onClick={() => { importGeneration.current++; setImportOpen(false); setImportFile(null); setImportAvailableVaults([]); setImportSelectedVaults(null); setImportSkipped(null); setImportCount(null); setImportSourceVaults([]); setImportBusy(false); }}>Close</Button><Button disabled={!importFile || !importVaultId || importBusy || (importFormat === "1password" && importSelectedVaults !== null && importSelectedVaults.length === 0)} onClick={() => void runImport(importCount !== null)}>{importBusy ? "Working…" : importFormat === "1password" && importSelectedVaults === null ? "Read export" : importCount === null ? "Preview" : "Import items"}</Button></div>
        </section>
      </div>}
      {settingsOpen && <dialog ref={settingsDialogRef} className="desktop-settings-dialog" aria-labelledby="desktop-settings-title" onCancel={() => setSettingsOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <section className="desktop-settings">
          <aside className="desktop-settings-nav">
            <h2 id="desktop-settings-title">Settings</h2>
            <nav aria-label="Settings sections">{(["profile", "devices", "vaults", "preferences"] as const).map((tab) => <Button key={tab} aria-current={settingsTab === tab ? "page" : undefined} aria-controls="desktop-settings-panel" variant="ghost" className={cn("desktop-settings-tab", settingsTab === tab && "desktop-settings-tab-active")} onClick={() => { setSettingsTab(tab); if (tab === "devices") void loadDevices(); }}>{tab[0].toUpperCase() + tab.slice(1)}</Button>)}</nav>
          </aside>
          <div className="desktop-settings-main">
            <header className="desktop-settings-header">
              <div><h3 id="desktop-settings-panel-title">{settingsTab[0].toUpperCase() + settingsTab.slice(1)}</h3><p>{settingsTab === "profile" ? "Your account and security on this device." : settingsTab === "devices" ? "Manage devices registered to your account." : settingsTab === "vaults" ? "Manage your encrypted vaults." : "Choose how your vault opens and handles removal."}</p></div>
              <Button autoFocus variant="ghost" className="desktop-settings-close" aria-label="Close settings" title="Close settings" onClick={() => setSettingsOpen(false)}><X size={18} /></Button>
            </header>
            <div ref={settingsBodyRef} id="desktop-settings-panel" role="region" aria-labelledby="desktop-settings-panel-title" className="desktop-settings-body text-sm">
              <div aria-live="polite" className="desktop-settings-notices">{notices.map((notice) => <p key={notice.id} className={cn("rounded-xl border border-white/10 p-3", notice.kind === "error" ? "text-red-300" : "text-emerald-300")}><strong>{notice.title}</strong>{notice.detail && <span className="mt-1 block text-slate-400">{notice.detail}</span>}</p>)}</div>
            {settingsTab === "profile" && <div className="grid gap-5">{nativePasskeys?.windows && !nativePasskeys.disabled && <section className="rounded-xl border border-white/10 p-4"><h3 className="font-bold">Windows passkeys</h3><p className="mt-2 text-sm text-slate-400">{!nativePasskeys.installed || !nativePasskeys.packaged ? "Install the packaged Desktop build to use 127Vaults in the Windows passkey picker." : nativePasskeys.enabled ? "127Vaults is enabled in the Windows passkey picker." : nativePasskeys.registered ? "Registered. Enable 127Vaults in Windows Settings → Accounts → Passkeys → Advanced options." : "Register 127Vaults to save and use passkeys through Windows."} Keep Desktop unlocked while using passkeys. The browser extension handles password filling on Windows.</p><div className="mt-3 flex flex-wrap gap-2"><Button disabled={nativePasskeysBusy || !nativePasskeys.installed || !nativePasskeys.packaged} onClick={() => void updateNativePasskeys(nativePasskeys.registered ? "refresh" : "register")}>{nativePasskeys.registered ? "Refresh saved passkeys" : "Register native passkeys"}</Button><Button variant="secondary" onClick={() => void updateNativePasskeys("settings")}>Windows passkey settings</Button><Button variant="ghost" disabled={nativePasskeysBusy} onClick={() => void updateNativePasskeys("status")}>Check status</Button>{nativePasskeys.registered && <Button variant="ghost" disabled={nativePasskeysBusy} onClick={() => void updateNativePasskeys("unregister")}>Unregister provider</Button>}</div></section>}<p><span className="text-slate-400">Username</span><br /><strong>{username || "This device"}</strong></p><p><span className="text-slate-400">Device ID</span><br /><code className="break-all text-xs">{desktopInfo?.deviceId ?? "Unavailable"}</code></p><p><span className="text-slate-400">Connection</span><br />{online ? "Online" : "Offline"}</p>{!online && offlineReason && <p className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-200">{offlineReason.includes("checkpoint verification key changed") ? "The server checkpoint key differs from this encrypted replica. Your local data and pending changes are preserved. Restore the original server identity before reconnecting." : `Online unlock failed: ${offlineReason}. Check the configured server and trusted certificate.`}</p>}<p><span className="text-slate-400">Account secret</span><br />{rememberedSecret ? "Remembered securely on this device for 30 days" : "Required at next unlock"}</p>{online ? <Button variant="secondary" className="w-fit" onClick={() => void synchronize()}>Sync now</Button> : <div className="grid gap-2 rounded-xl border border-white/10 p-4"><strong>Reconnect to create vaults and manage devices</strong><p className="text-xs text-slate-400">Enter your master password to verify a live session.</p>{(!rememberedSecret || showSecretEntry) && <Input aria-label="Account secret for reconnect" type="password" autoComplete="off" placeholder="Account secret" value={accountSecret} onChange={(event) => setAccountSecret(event.target.value)} />}{errors.accountSecret && <p className="text-xs text-red-300">{errors.accountSecret}</p>}<Input aria-label="Master password for reconnect" type="password" autoComplete="current-password" placeholder="Master password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} />{errors.masterPassword && <p className="text-xs text-red-300">{errors.masterPassword}</p>}<Button className="w-fit" disabled={busy} onClick={() => void unlock().then((connected) => { if (connected) setSettingsOpen(false); })}>Reconnect</Button></div>}</div>}
            {settingsTab === "devices" && <div aria-busy={devicesLoading}>{deviceError && <p role="alert" className="desktop-settings-message">Could not refresh devices. {deviceError}</p>}{devicesLoading && <p role="status" className="mt-5 text-slate-400">Loading devices…</p>}{!devicesLoading && !deviceError && devices.length === 0 && <p className="mt-5 text-slate-400">No devices to display. Refresh to check your registered devices.</p>}<div className="mt-5 grid gap-2">{devices.map((device) => <div key={device.deviceId} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/3 p-3"><div><strong>{device.deviceId === currentDeviceId ? "This desktop" : `Device ${device.deviceId.slice(0, 8)}`}</strong><p className="mt-1 text-xs text-slate-400">{device.protectionClass ?? "Unknown"} protection · credential {device.credentialState ?? "unknown"} · {device.status ?? "unknown"}</p></div>{device.deviceId !== currentDeviceId && device.status === "active" && <Button variant="ghost" className="text-red-300" onClick={() => void revokeDevice(device.deviceId)}>Revoke</Button>}</div>)}</div><Button variant="secondary" className="mt-5" disabled={devicesLoading} onClick={() => void loadDevices()}>{devicesLoading ? "Refreshing…" : "Refresh devices"}</Button></div>}
            {settingsTab === "vaults" && <div className="grid gap-5">
              <section className="rounded-xl border border-white/10 p-4"><h3 className="font-bold">Import passwords</h3><p className="mt-2 text-sm text-slate-400">Bring passwords from another password manager into source vaults or a vault you choose.</p><Button variant="secondary" className="mt-3" disabled={!activeVaults.length && !online} onClick={() => {
                setSettingsOpen(false);
                setImportVaultId(viewMode === "single" && activeVaults.some(vault => vault.vaultId === vaultId) ? vaultId : activeVaults.length === 1 ? activeVaults[0].vaultId : "");
                setImportOpen(true); setImportCount(null); setImportSourceVaults([]); setImportFile(null); setImportAvailableVaults([]); setImportSelectedVaults(null); setImportSkipped(null); setImportError(null);
              }}>Import passwords…</Button></section>

              {removalPlan?.pending && <div className="rounded-xl border border-amber-300/30 bg-amber-300/8 p-4 text-sm"><strong>Pending {removalPlan.choice} operation</strong><p className="mt-1 text-slate-300">{removalPlan.stage === "copying" ? "Destination copies are being prepared." : "The final server request is ready to retry."} {removalPlan.itemMappings?.length ?? 0} mapped item(s).</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={!online || removalBusy} onClick={resumeRemoval}>Resume</Button>{removalPlan.choice === "move" && removalPlan.stage === "copying" && <Button size="sm" variant="ghost" disabled={removalBusy} onClick={() => void abortMove()}>Keep copies and clear plan</Button>}</div></div>}
              <div className="grid gap-2">{activeVaults.map((vault) => <div key={vault.vaultId} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3"><span>{vault.name}</span><span className="text-xs text-slate-500">{vault.code}</span><Button size="sm" variant="ghost" disabled={!online || removalBusy} onClick={() => openRemoval(vault.vaultId)}>Remove…</Button></div>)}</div>
              {archivedVaults.length > 0 && <div className="grid gap-2"><h4 className="text-sm font-semibold">Archived vaults</h4>{archivedVaults.map((vault) => <div key={vault.vaultId} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3"><span>{vault.name}</span><span className="text-xs text-slate-500">{vault.code}</span><Button size="sm" variant="secondary" disabled={!online || removalBusy || !!removalPlan?.pending} onClick={() => void restoreVault(vault.vaultId)}>Restore</Button></div>)}</div>}
              <Button variant="secondary" className="w-fit" onClick={() => { if (!online) { setSettingsTab("profile"); return; } setSettingsOpen(false); setVaultNameDraft(""); setVaultDialog("create"); }}>{online ? "Create vault" : "Reconnect to create vault"}</Button>
              {!online && <p className="text-xs text-amber-300">Vault creation and removal require an online session.</p>}
            </div>}
            {settingsTab === "preferences" && <div className="grid gap-5"><KeyboardHelp /><label className="grid gap-2">Open after unlocking<select className="desktop-settings-select" value={defaultView ? `${defaultView.kind}:${defaultView.id ?? ""}` : "all:"} onChange={(event) => { const [kind, selector] = event.target.value.split(":"); void saveDefaultView(kind, selector || null); }}><option value="all:">All items</option>{activeVaults.map((vault) => <option key={vault.vaultId} value={`vault:${vault.vaultId}`}>Vault: {vault.name}</option>)}{collections.map((collection) => <option key={collection.id} value={`collection:${collection.id}`}>Collection: {collection.name}</option>)}</select></label><label className="grid gap-2">When removing a vault<select className="desktop-settings-select" value={removalPreference ?? "ask"} onChange={(event) => void invoke<VaultSettings>("vault_removal_preference", { choice: event.target.value === "ask" ? null : event.target.value }).then((result) => { setRemovalPreference(result.removalPreference); setSettingsConflict(result.conflict); }).catch((error) => notify("error", "Could not save preference", friendlyError(error)))}><option value="ask">Ask me each time</option><option value="move">Move items</option><option value="archive">Archive items</option></select></label></div>}
            </div>
          </div>
        </section>
      </dialog>}
      {settingsReview && <div className="ui-modal-overlay fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6" role="dialog" aria-modal="true" aria-labelledby="settings-review-title">
        <div className="ui-dialog ui-dialog-wide border border-white/10 bg-[#11162b] text-slate-100">
          <h2 id="settings-review-title" className="text-lg font-semibold">Review vault settings conflict</h2>
          <p className="mt-2 text-sm text-slate-400">Compare vault names, collections, default view, and removal preference. Choose which complete settings version to keep.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><div><h3 className="mb-2 font-medium">This device</h3><pre className="max-h-64 overflow-auto rounded bg-black/30 p-3 text-xs">{JSON.stringify(settingsReview.local, null, 2)}</pre></div><div><h3 className="mb-2 font-medium">Server</h3><pre className="max-h-64 overflow-auto rounded bg-black/30 p-3 text-xs">{JSON.stringify(settingsReview.server, null, 2)}</pre></div></div>
          <div className="ui-dialog-actions"><Button variant="secondary" onClick={() => setSettingsReview(null)}>Cancel</Button>{(["local", "server"] as const).map((keep) => <Button key={keep} onClick={() => void resolveVaultSettings(keep)}>Keep {keep}</Button>)}</div>
        </div>
      </div>}
      {collectionDialog && <div className="ui-modal-overlay fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6" role="dialog" aria-modal="true" aria-labelledby="collection-dialog-title">
        <section className="ui-dialog border border-white/10 bg-[#11162b]">
          <h2 id="collection-dialog-title" className="text-xl font-bold">{collectionDialog === "create" ? "Create collection" : "Edit collection"}</h2>
          <label className="mt-5 block text-sm text-slate-300">Collection name
            <Input autoFocus className="mt-2" maxLength={80} value={collectionNameDraft} onChange={(event) => setCollectionNameDraft(event.target.value)} />
          </label>
          <p className="mt-5 text-sm text-slate-300">Include vaults</p>
          <div className="mt-2 grid gap-2">{activeVaults.map((vault) => <label key={vault.vaultId} className="flex items-center gap-3 rounded-lg border border-white/10 p-2 text-sm">
            <input type="checkbox" checked={collectionVaultDraft.includes(vault.vaultId)} onChange={(event) => setCollectionVaultDraft((current) => event.target.checked ? [...current, vault.vaultId] : current.filter((id) => id !== vault.vaultId))} />
            {vault.name} <small className="ml-auto text-slate-500">{vault.code}</small>
          </label>)}</div>
          <div className="ui-dialog-actions"><Button variant="secondary" onClick={() => setCollectionDialog(null)}>Cancel</Button>
            <Button disabled={!collectionNameDraft.trim() || !collectionVaultDraft.length} onClick={() => void saveCollection()}>Save collection</Button></div>
        </section>
      </div>}
      {vaultDialog && <div className="ui-modal-overlay fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6" role="dialog" aria-modal="true" aria-labelledby="vault-dialog-title">
        <section className="ui-dialog border border-white/10 bg-[#11162b]">
          <h2 id="vault-dialog-title" className="text-xl font-bold">{vaultDialog === "create" ? "Create vault" : "Rename vault"}</h2>
          <p className="mt-2 text-sm text-slate-400">Your vault name is stored in encrypted account settings.</p>
          <label className="mt-5 block text-sm text-slate-300">Vault name
            <Input autoFocus className="mt-2" maxLength={80} value={vaultNameDraft} onChange={(event) => setVaultNameDraft(event.target.value)} />
          </label>
          <div className="ui-dialog-actions">
            <Button variant="secondary" onClick={() => setVaultDialog(null)}>Cancel</Button>
            <Button disabled={!vaultNameDraft.trim()} onClick={() => void (vaultDialog === "create" ? addVault() : renameVault())}>{vaultDialog === "create" ? "Create vault" : "Save name"}</Button>
          </div>
        </section>
      </div>}
      {removalDialog && <div className="ui-modal-overlay fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6" role="dialog" aria-modal="true" aria-labelledby="removal-dialog-title">
        <section className="ui-dialog border border-amber-300/20 bg-[#11162b]">
          <h2 id="removal-dialog-title" className="text-xl font-bold">Remove {vaults.find((row) => row.vaultId === removalDialog.sourceId)?.name ?? "vault"}</h2>
          <p className="mt-2 text-sm text-slate-300">{removalItemCount === null ? "Items" : `${removalItemCount} item(s)`} will remain encrypted and recoverable in the source vault. Choose what should happen to the active view.</p>
          <fieldset className="mt-5 grid gap-3"><legend className="mb-2 text-sm font-semibold">Removal choice</legend>
            <label className="flex gap-3 rounded-xl border border-white/10 p-3 text-sm"><input type="radio" name="removal-choice" checked={removalDialog.choice === "archive"} onChange={() => setRemovalDialog({ ...removalDialog, choice: "archive" })} /><span><strong>Archive</strong><span className="mt-1 block text-slate-400">Keep items in this vault, hidden from normal views. You can restore it later.</span></span></label>
            <label className="flex gap-3 rounded-xl border border-white/10 p-3 text-sm"><input type="radio" name="removal-choice" checked={removalDialog.choice === "move"} disabled={activeVaults.length < 2 || (removalItemCount !== null && removalItemCount > 100)} onChange={() => setRemovalDialog({ ...removalDialog, choice: "move" })} /><span><strong>Move items</strong><span className="mt-1 block text-slate-400">Re-encrypt every item under another vault key, verify the copies, then retire this vault.</span></span></label>
          </fieldset>
          {removalItemCount !== null && removalItemCount > 100 && <p className="mt-3 text-xs text-amber-300">Move supports at most 100 items. Archive this vault or move items in smaller batches first.</p>}
          {removalDialog.choice === "move" && <label className="mt-4 grid gap-2 text-sm">Destination vault<select className="desktop-settings-select" value={removalDialog.destinationId} onChange={(event) => setRemovalDialog({ ...removalDialog, destinationId: event.target.value })}>{activeVaults.filter((row) => row.vaultId !== removalDialog.sourceId).map((row) => <option key={row.vaultId} value={row.vaultId}>{row.name} · {row.code}</option>)}</select></label>}
          <p className="mt-4 text-xs text-slate-400">The operation requires a connection and no unresolved local edits. If interrupted, it can be resumed from Settings.</p>
          <div className="ui-dialog-actions"><Button variant="secondary" disabled={removalBusy} onClick={() => setRemovalDialog(null)}>Cancel</Button><Button disabled={removalBusy || (removalDialog.choice === "move" && (!removalDialog.destinationId || (removalItemCount !== null && removalItemCount > 100)))} onClick={() => void removeVault(removalDialog.sourceId, removalDialog.choice, removalDialog.destinationId)}>{removalBusy ? "Working…" : removalDialog.choice === "move" ? "Move and retire" : "Archive vault"}</Button></div>
        </section>
      </div>}
      {syncReviewOpen && (
        <div className="ui-modal-overlay fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="sync-review-title">
          <section className="ui-dialog ui-dialog-wide max-h-[85vh] overflow-y-auto border border-amber-300/20 bg-[#11162b]">
            <h2 id="sync-review-title" className="text-xl font-bold">Review changes waiting to sync</h2>
            <p className="mt-3 text-sm text-slate-300">{syncFailure || "Queued changes are saved in the encrypted local replica. Review confirmed conflicts before choosing which version to keep."}</p>
            {!!syncReview?.unverifiedAcknowledgements && <p className="mt-3 text-sm text-amber-200" role="status">The server acknowledged {syncReview.unverifiedAcknowledgements} operation{syncReview.unverifiedAcknowledgements === 1 ? "" : "s"}, but verified history has not confirmed {syncReview.unverifiedAcknowledgements === 1 ? "it" : "them"} yet. This device’s encrypted copy is retained. Reconnect to the current verified server before continuing.</p>}
            <p className="mt-2 text-xs text-slate-400">Field values stay hidden here. Taking the server version discards only the selected queued edit; other pending changes remain.</p>
            {!syncReview && <p className="mt-4 text-amber-200">The pending-item details could not be loaded. Retry sync or reconnect; no queued changes were discarded.</p>}
            {syncReview?.items.map(row => <article key={row.operationId} className="mt-4 rounded-lg border border-white/10 p-4">
              <h3 className="font-bold">{row.title || "Untitled item"}</h3>
              <p className="mt-1 text-xs text-slate-400">Vault: {vaults.find(vault => vault.vaultId === row.vaultId)?.name || row.vaultId}</p>
              <p className="mt-2 text-sm">Changed fields: {row.fields.map(field => field === "customFields" ? "Custom fields" : field).join(", ") || "Not determined"}</p>
              {row.conflict ? <><p className="mt-2 text-sm text-amber-200">{row.conflict.kind === "delete-edit-divergence" ? "Deleted on the server; your local edit is preserved." : "A queued edit conflicts with the server version."}</p><Button className="mt-3" onClick={() => void reviewQueuedItem(row)}>Review item and choose version</Button></> : <p className="mt-2 text-xs text-slate-400">{row.error ? `${row.error}. This request has not been classified as an item conflict. Retry or reconnect before choosing a server copy.` : "Waiting to send. Retry sync when connected."}</p>}
            </article>)}
            {(syncReview?.settingsPending || syncReview?.settingsConflict) && <article className="mt-4 rounded-lg border border-white/10 p-4"><h3 className="font-bold">Vault and collection settings</h3><p className="mt-2 text-sm">{syncReview.settingsConflict ? "Settings changed on another device and need review." : "Local settings are waiting to sync."}</p>{syncReview.settingsConflict && <Button className="mt-3" onClick={() => void invoke<{local: unknown; server: unknown}>("vault_settings_review").then(review => { setSyncReviewOpen(false); setSettingsReview(review); }).catch(error => notify("error", "Could not review settings", friendlyError(error)))}>Review settings</Button>}</article>}
            {syncReview && !syncReview.items.length && !syncReview.settingsPending && !syncReview.settingsConflict && <p className="mt-4 text-sm">No queued item or settings changes were found. The failure may concern fetching server updates; retry or reconnect.</p>}
            <div className="ui-dialog-actions"><Button variant="secondary" disabled={syncState === "syncing"} onClick={() => void synchronize().catch(() => {})}>Retry sync</Button><Button variant="ghost" onClick={() => setSyncReviewOpen(false)}>Close</Button></div>
          </section>
        </div>
      )}
      {conflict && (
        <div
          className="ui-modal-overlay fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="conflict-title"
        >
          <section className="ui-dialog ui-dialog-wide border border-amber-300/20 bg-[#11162b]">
            <AlertTriangle className="text-amber-300" />
            <h2 id="conflict-title" className="mt-4 text-xl font-bold">
              Resolve sync conflict
            </h2>
            <p className="mt-2 font-semibold">{conflict.draft.title || "Untitled item"}</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {conflict.message}{conflict.server && " Compare each field and select the value to save."}
            </p>
            {conflictError && <p role="alert" className="mt-4 rounded-lg border border-red-300/30 bg-red-300/10 p-3 text-sm text-red-200">{conflictError}</p>}
            {conflict.server && conflict.choices && (
              <div className="mt-5 overflow-hidden rounded-xl border border-white/10">
                <div className="desktop-conflict-row grid grid-cols-[9rem_1fr_1fr] gap-3 border-b border-white/10 bg-white/5 p-3 text-xs font-bold uppercase tracking-wider text-slate-400"><span>Field</span><span>Mine</span><span>Theirs</span></div>
                {(["title", "website", "username", "password", "customFields"] as const).map((field) => {
                  const display = (value: Item[typeof field]) => field === "password" ? "••••••••" : field === "customFields" ? `${(value as CustomField[]).length} field(s)` : String(value || "—");
                  return <div key={field} className="desktop-conflict-row grid grid-cols-[9rem_1fr_1fr] gap-3 border-b border-white/7 p-3 last:border-0"><b className="self-center text-xs capitalize text-slate-400">{field === "customFields" ? "Custom fields" : field}</b>{(["local", "server"] as const).map((source) => <button key={source} role="radio" aria-checked={conflict.choices?.[field] === source} className={cn("flex min-h-14 items-center gap-3 rounded-lg border p-3 text-left text-sm", conflict.choices?.[field] === source ? "border-[#E0BB95]/60 bg-[#E0BB95]/10" : "border-white/10")} onClick={() => setConflict({ ...conflict, choices: { ...conflict.choices!, [field]: source } })}><span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded border", conflict.choices?.[field] === source ? "border-[#E0BB95] bg-[#E0BB95] text-[#11162b]" : "border-slate-500")}>{conflict.choices?.[field] === source && <Check size={14} />}</span><span className="min-w-0 truncate">{display(source === "local" ? conflict.draft[field] : conflict.server![field])}</span></button>)}</div>;
                })}
              </div>
            )}
            <div className="ui-dialog-actions ui-dialog-actions-stack">
              {conflict.draft.deleted && <Button disabled={saving} onClick={() => void deleteItem(conflict.draft, conflict.vaultId ?? vaultId, conflict.operationId ?? null)}>Delete current server version…</Button>}
              {!conflict.draft.deleted && !["delete-edit-divergence", "unsynced-create"].includes(conflict.kind ?? "") && (conflict.server ? <Button onClick={applyMerge}>Save selected fields</Button> : <Button disabled={conflictBusy} onClick={() => void prepareMerge()}>{conflictBusy ? "Loading server version…" : "Compare and select fields…"}</Button>)}
              {!conflict.draft.deleted && !["delete-edit-divergence", "unsynced-create"].includes(conflict.kind ?? "") && (
              <Button
                onClick={() => {
                  if (conflict.server) {
                    const draft = conflict.draft;
                    const operationId = conflict.operationId ?? null;
                    setConflict(null);
                    void save(draft, operationId, conflict.vaultId);
                  } else {
                    void prepareMerge();
                  }
                }}
              >
                {conflict.server ? "Use mine" : "Prepare my version"}
              </Button>
              )}
              <Button
                variant="secondary"
                disabled={conflictBusy}
                onClick={() => {
                  const itemId = conflict.draft.itemId;
                  if (itemId && conflict.operationId) {
                    if (["delete-edit-divergence", "unsynced-create"].includes(conflict.kind ?? "") && !window.confirm(conflict.kind === "unsynced-create" ? "Discard this queued creation? It has no server copy. This removes the selected queued creation from this device." : "Discard this queued edit? The item is absent on the server. Other queued changes will remain.")) return;
                    void useServerVersion(itemId, conflict.operationId, conflict.vaultId ?? vaultId);
                  } else {
                    void prepareMerge();
                  }
                }}
              >
                {conflict.draft.deleted ? "Keep server version and discard deletion" : conflict.kind === "unsynced-create" ? "Discard queued creation…" : conflict.kind === "delete-edit-divergence" ? "Discard queued edit…" : "Use server version"}
              </Button>
              <Button variant="ghost" onClick={() => { setConflict(null); if (conflict.kind === "delete-edit-divergence") setEditing(false); }}>
                {["delete-edit-divergence", "unsynced-create"].includes(conflict.kind ?? "") ? "Keep queued change and close" : "Cancel and keep editing"}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
