import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Input, cn } from "@127vaults/ui";
import { QRCodeSVG } from "qrcode.react";
import { createDragSession } from "./drag-session.mjs";
import { choicesForConflict } from "./conflict-choice.mjs";
import { ITEM_TYPES, TYPE_GROUPS, RELATED_TYPES, SECTION_TYPES, CUSTOM_SECTION, addRelatedSection, addSectionField, completeRelatedFields, itemType, ordinaryFields, primaryFields, removeSection, renameSection, replaceItemType, sections, setItemType, visibleFields, type ItemType, type SectionType } from "./item-types";
import {
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
  LoaderCircle,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Plus,
  Router,
  Search,
  Settings,
  Terminal,
  Trash2,
  Vault,
  Wifi,
  X,
} from "lucide-react";

type Summary = { itemId: string; title: string; website: string; vaultId?: string };
type CustomField = { id: string; label: string; type: string; value: string };
type Item = Summary & {
  username: string;
  password: string;
  customFields: CustomField[];
};
type VaultSummary = { vaultId: string; name: string; code: string; retired?: boolean; retirementChoice?: "archive" | "move" | null };
type CollectionSummary = { id: string; name: string; vault_ids: string[] };
type VaultSettings = { collections: CollectionSummary[]; defaultView: { kind: string; id?: string } | null; removalPreference: string | null; pending: boolean; conflict: boolean };
type RemovalPlan = { pending: boolean; choice?: "archive" | "move" | "restore"; sourceVaultId?: string; destinationVaultId?: string | null; stage?: "copying" | "finalizing"; itemMappings?: { source_item_id: string; destination_item_id: string }[] };
type RemovalResult = { receipt: { choice?: string; itemCount?: number; restored?: boolean }; vaults: VaultSummary[]; settings: VaultSettings };
type UnlockResult = { online: boolean; offlineReason: string | null; vaultId: string; vaults: VaultSummary[]; items: Summary[]; settings: VaultSettings; viewKind: string; collectionId: string | null; secretRemembered: boolean };
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
type Conflict = { draft: Item; message: string; operationId?: string; kind?: string; server?: Item; choices?: Record<string, "local" | "server"> };
type EngineConflict = { operationId: string; itemId: string; vaultId: string; kind: string; localFields?: string[]; remoteFields?: string[] };
const dragSession = createDragSession();
const TYPE_ICONS = { login: Globe2, bank: Landmark, card: CreditCard, wifi: Wifi, router: Router, ssh: Terminal, password: KeyRound };
const TYPE_DESCRIPTIONS: Record<ItemType, string> = {
  login: "Website or app sign-in",
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
  const [unlocked, setUnlocked] = useState(false),
    [online, setOnline] = useState(false),
    [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false),
    [registrationUsername, setRegistrationUsername] = useState("");
  const [vaultId, setVaultId] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("Locked");
  const [viewMode, setViewMode] = useState<"single" | "all" | "collection">("single");
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
    [username, setUsername] = useState("");
  const [accountSecret, setAccountSecret] = useState(""),
    [masterPassword, setMasterPassword] = useState("");
  const [rememberedSecret, setRememberedSecret] = useState(false);
  const [showSecretEntry, setShowSecretEntry] = useState(false);
  const [offlineReason, setOfflineReason] = useState<string | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<{ mode: string; plan: string | null; expiresAt: string | null; enforcement: string } | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [notices, setNotices] = useState<Notice[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [resolvingOperationId, setResolvingOperationId] = useState<string | null>(null);
  const [footerMenu, setFooterMenu] = useState(false);
  const [compactNavOpen, setCompactNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"profile" | "devices" | "vaults" | "preferences">("profile");
  const [devices, setDevices] = useState<{ deviceId: string; protectionClass?: string; credentialState?: string; status?: string }[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState("");
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [lastLocalChange, setLastLocalChange] = useState<Date | null>(null);
  const activeVaults = vaults.filter((vault) => !vault.retired);
  const archivedVaults = vaults.filter((vault) => vault.retired && vault.retirementChoice === "archive");
  const notify = (kind: Notice["kind"], title: string, detail?: string) => {
    const id = Date.now() + Math.random();
    setNotices((current) => [...current, { id, kind, title, detail }]);
    window.setTimeout(
      () =>
        setNotices((current) => current.filter((notice) => notice.id !== id)),
      kind === "error" ? 8000 : 4500,
    );
  };
  const friendlyError = (error: unknown) => {
    const message = String(error).replace(/^Error:\s*/, "");
    if (message.includes("sync unavailable while offline"))
      return "This vault was unlocked offline. Lock and unlock again while the server is available to resume sync.";
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
  const loadDevices = async () => {
    setDeviceError("");
    try {
      const result = await invoke<{ devices: typeof devices; currentDeviceId: string }>("device_list");
      setDevices(result.devices ?? []);
      setCurrentDeviceId(result.currentDeviceId);
    } catch (error) { setDeviceError(friendlyError(error)); }
  };
  const revokeDevice = async (deviceId: string) => {
    if (!window.confirm(`Revoke device ${deviceId.slice(0, 8)}? It will need enrollment before signing in again.`)) return;
    try { await invoke("device_revoke", { deviceId }); await loadDevices(); notify("success", "Device revoked"); }
    catch (error) { notify("error", "Could not revoke device", friendlyError(error)); }
  };

  const lock = async (reason = "Locked") => {
    await invoke("lock").catch(() => undefined);
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
  };
  useEffect(() => {
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
    const hydrated = await Promise.all(customFields.map(async (field) => field.type === "password" ? { ...field, value: await invoke<string>("item_secret", { vaultId: vault, itemId: summary.itemId, field: field.id }) } : field));
    return { ...item, password, customFields: hydrated };
  };
  const openItem = async (summary: Summary, vault = vaultId) => {
    try {
      const ownerVault = summary.vaultId ?? vault;
      setSelected(await loadItem(summary, ownerVault));
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
    if (!conflict?.draft.itemId) return;
    try {
      const result = await synchronize();
      const summary = result?.items.find((item) => item.itemId === conflict.draft.itemId);
      const engineConflict = result?.conflicts.find((row) => row.itemId === conflict.draft.itemId);
      const operationId = engineConflict?.operationId;
      if (engineConflict?.kind === "delete-edit-divergence") {
        setConflict({ ...conflict, kind: engineConflict.kind, operationId, message: "This item was deleted on another device. The queued edit is preserved until you discard it." });
        return;
      }
      if (!summary) throw Error("The server item no longer exists.");
      if (!operationId) {
        setConflict(null);
        await openItem(summary);
        notify("success", "Changes merged", "The changes touched different fields and were saved together.");
        return;
      }
      const server = await loadItem(summary);
      setConflict({ ...conflict, operationId, server, choices: choicesForConflict(engineConflict ?? {}) });
    } catch (error) {
      notify("error", "Could not prepare the merge", friendlyError(error));
    }
  };
  const applyMerge = () => {
    if (!conflict?.server || !conflict.choices) return;
    const pick = <K extends keyof Item>(key: K) => conflict.choices?.[key] === "server" ? conflict.server![key] : conflict.draft[key];
    const merged = { itemId: conflict.draft.itemId, title: pick("title"), website: pick("website"), username: pick("username"), password: pick("password"), customFields: pick("customFields") };
    setSelected(merged);
    setEditOriginal(conflict.server);
    setResolvingOperationId(conflict.operationId ?? null);
    setEditing(true);
    setConflict(null);
    void save(merged, conflict.operationId ?? null);
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
      setVaultId(result.vaultId);
      setItemVaultId(result.vaultId);
      setViewMode(result.viewKind === "all" ? "all" : result.viewKind === "collection" ? "collection" : "single");
      setSelectedCollectionId(result.collectionId);
      setCollections(result.settings.collections);
      setSettingsConflict(result.settings.conflict);
      setDefaultView(result.settings.defaultView);
      setRemovalPreference(result.settings.removalPreference);
      setVaults(result.vaults);
      setRemovalPlan(await invoke<RemovalPlan>("vault_removal_status").catch(() => null));
      setItems(result.items);
      setOnline(result.online);
      setLicenseStatus(result.online ? await invoke<{ mode: string; plan: string | null; expiresAt: string | null; enforcement: string }>("license_status").catch(() => null) : null);
      setOfflineReason(result.offlineReason);
      setUnlocked(true);
      dragSession.unlock();
      setAccountSecret("");
      setRememberedSecret(result.secretRemembered);
      setShowSecretEntry(false);
      setMasterPassword("");
      setStatus(
        result.online
          ? "Unlocked · verified online replica"
          : "Unlocked offline · changes will sync when the server is available",
      );
      setLastSynced(result.online ? new Date() : null);
      notify(
        result.online ? "success" : "info",
        wasUnlocked ? (result.online ? "Connection restored" : "Still offline") : "Vault unlocked",
        result.online ? "The server replica is up to date." : "Working from the encrypted offline replica.",
      );
      if (result.items[0]) await openItem(result.items[0], result.vaultId);
      return result.online;
    } catch (e) {
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
      setBusy(false);
    }
  };
  const selectVault = async (nextVaultId: string) => {
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
  const selectAllVaults = async () => {
    try {
      const allItems = await listAllItems();
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
    setRemovalDialog({ sourceId, choice: removalPreference === "move" && destinationId && itemCount <= 50 ? "move" : "archive", destinationId });
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
    if (choice === "move" && removalItemCount !== null && removalItemCount > 50 && !removalPlan?.pending) {
      notify("error", "Move limit exceeded", "Move supports at most 50 source items. Archive this vault or move items in smaller batches first."); return;
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
  const save = async (draft = selected, resolutionId = resolvingOperationId) => {
    if (!draft) return;
    const destination = draft.itemId ? itemVaultId : viewMode === "single" ? vaultId : itemVaultId;
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
      setStatus("Saving encrypted item…");
      const response = await invoke<{
        result: { queued?: boolean };
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
      setEditing(false);
      setEditOriginal(null);
      setResolvingOperationId(null);
      if (response.result.queued) setOnline(false);
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
        response.items.find((item) => item.itemId === draft.itemId) ||
        response.items.find((item) => item.title === draft.title);
      if (saved) await openItem(saved, destination);
    } catch (e) {
      const message = String(e);
      if (message.includes("409")) {
        setConflict({
          draft: structuredClone(draft),
          message:
            "This item changed on another device while you were editing it.",
        });
      } else {
        const detail = friendlyError(e);
        setStatus(detail);
        notify("error", "Item was not saved", detail);
      }
    }
  };
  const synchronize = async () => {
    try {
      const result = await invoke<{ accepted: number; items: Summary[]; vaults: VaultSummary[]; selectedVaultId: string | null; conflicts: EngineConflict[]; vaultSettings?: VaultSettings }>(
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
        setItems(viewMode === "single" ? result.items : await listVisibleItems(result.vaults.filter((row) => !row.retired)));
      }
      setLastSynced(new Date());
      setStatus(
        result.conflicts.length
          ? `Sync needs review · ${result.conflicts.length} pending conflict(s)`
          : `Sync complete · ${result.accepted} pending operation(s) accepted`,
      );
      const pendingConflict = result.conflicts.find((row) => viewMode !== "single" || row.vaultId === vaultId);
      if (pendingConflict && !conflict) {
        setVaultId(pendingConflict.vaultId);
        setItemVaultId(pendingConflict.vaultId);
        const draft = await invoke<Item>("conflict_draft", { vaultId: pendingConflict.vaultId, itemId: pendingConflict.itemId, operationId: pendingConflict.operationId });
        setConflict({ draft, operationId: pendingConflict.operationId, kind: pendingConflict.kind, message: pendingConflict.kind === "delete-edit-divergence" ? "This item was deleted on another device. The queued edit is preserved until you discard it." : "Your queued edit meets a change from another device." });
      }
      notify(result.conflicts.length ? "info" : "success", result.conflicts.length ? "Sync needs review" : "Sync complete", result.conflicts.length ? "Review the queued edit before saving." : `${result.accepted} pending change${result.accepted === 1 ? "" : "s"} accepted.`);
      return result;
    } catch (e) {
      setOnline(false);
      const detail = friendlyError(e);
      setStatus(detail);
      notify("error", "Sync failed", detail);
      throw e;
    }
  };
  const useServerVersion = async (itemId: string, operationId: string) => {
    try {
      const result = await invoke<{ items: Summary[] }>("discard_conflict", { vaultId, itemId, operationId });
      setItems(viewMode === "single" ? result.items : await listVisibleItems());
      setOnline(true);
      setLastSynced(new Date());
      setEditing(false);
      setEditOriginal(null);
      const summary = result.items.find((item) => item.itemId === itemId);
      if (summary) await openItem(summary);
      else setSelected(null);
      notify(
        "success",
        "Server version restored",
        "The selected local edit was discarded.",
      );
    } catch (error) {
      notify(
        "error",
        "Could not load the server version",
        friendlyError(error),
      );
    }
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
    event.dataTransfer.setData(
      "application/x-127vaults-field",
      JSON.stringify({ kind }),
    );
    setStatus(`Dragging ${kind}`);
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
    if (!selected || type === itemType(selected.customFields)) return;
    const hasValues = !!(selected.website || selected.username || selected.password || primaryFields(selected.customFields).some((field) => field.value) || sections(selected.customFields).length);
    if (hasValues && !window.confirm("Change the main type? Its current type fields and related details will be removed. Save a copy first if you need them.")) return;
    setSelected({ ...selected, website: "", username: "", password: "", customFields: replaceItemType(selected.customFields, type) });
    setExpandedRelatedId(null);
  };
  const knownFieldEditor = (field: CustomField) => <label key={field.id} className="grid gap-2 text-sm text-slate-400">
    {field.label}
    <div className="grid grid-cols-[1fr_auto] gap-2">
      <Input type={field.type === "password" && !revealed.has(field.id) ? "password" : "text"} value={field.value} onChange={(e) => updateCustom(field.id, { value: e.target.value })} />
      {field.type === "password" && <Button variant="secondary" onClick={() => toggleReveal(field.id)}>{revealed.has(field.id) ? <EyeOff size={16} /> : <Eye size={16} />}<span>{revealed.has(field.id) ? "Hide" : "Reveal"}</span></Button>}
    </div>
  </label>;
  const beginEditing = () => {
    if (!selected) return;
    setEditOriginal(structuredClone(selected));
    setSelected({ ...selected, customFields: completeRelatedFields(selected.customFields) });
    setExpandedRelatedId(null);
    setEditing(true);
  };
  const cancelEditing = () => {
    setSelected(editOriginal);
    setEditOriginal(null);
    setEditing(false);
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
      setEditing(true);
    }
    if (id === "edit-item" && selected) beginEditing();
    if (id === "sync") void synchronize();
    if (id === "lock") void lock();
  };

  if (!unlocked && registrationOpen)
    return (
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#18203d,#04071d_58%)] p-8">
        <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#11162b] p-8 shadow-2xl">
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
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#18203d,#04071d_58%)] p-8">
        <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#11162b] p-8 shadow-2xl">
          <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-[#9D1F32]">
            <LockKeyhole />
          </div>
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
              disabled={!desktopInfo?.registrationUrl || enrolling}
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
    <div className="desktop-shell grid h-screen grid-cols-[15rem_minmax(18rem,22rem)_1fr] grid-rows-[1fr_2rem] overflow-hidden bg-[#04071d]">
      <aside className={cn("desktop-sidebar row-span-2 flex flex-col border-r border-white/7 bg-[#0a0e21] p-3", compactNavOpen && "menu-open")}>
        <div className="desktop-brand mb-7 flex items-center gap-3 px-2 py-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#9D1F32] text-xs font-black">
            127
          </span>
          <strong>127Vaults</strong>
        </div>
        <Button variant="ghost" className="desktop-menu-toggle" aria-expanded={compactNavOpen} aria-label="Toggle navigation" onClick={() => setCompactNavOpen((open) => !open)}><Menu size={18} /><span>Vaults</span></Button>
        <nav className="desktop-nav-content flex min-h-0 flex-1 flex-col overflow-auto" aria-label="Vaults and collections" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) setCompactNavOpen(false); }}>
        <Button variant="ghost" className={cn("justify-start", viewMode === "all" && "bg-white/7")} onClick={() => void selectAllVaults()}>
          <LayoutList size={17} />
          <span>All items</span>
          <span className="ml-auto">{items.length}</span>
        </Button>
        <p className="mb-2 mt-7 px-3 text-[10px] font-bold tracking-[.16em] text-slate-600">
          VAULTS
        </p>
        {activeVaults.map((vault) => <div className="desktop-nav-row" key={vault.vaultId}><Button variant="ghost" className={cn("min-w-0 flex-1 justify-start", viewMode === "single" && vault.vaultId === vaultId && "bg-white/10")} onClick={() => void selectVault(vault.vaultId)}>
          <Vault size={17} />
          <span className="truncate">{vault.name}</span>
        </Button><details className="desktop-row-menu"><summary aria-label={`Actions for ${vault.name}`} title={`Actions for ${vault.name}`}><MoreHorizontal size={17} /></summary><div><button onClick={() => { setVaultActionId(vault.vaultId); setVaultNameDraft(vault.name); setVaultDialog("rename"); }}>Rename vault</button><button onClick={() => openRemoval(vault.vaultId)}>Remove vault…</button></div></details></div>)}
        <Button variant="ghost" className="justify-start" onClick={() => { if (!online) { setSettingsTab("profile"); setSettingsOpen(true); return; } setVaultNameDraft(""); setVaultDialog("create"); }}>
          <Plus size={17} />
          <span>Add vault</span>
        </Button>
        <p className="mb-2 mt-6 px-3 text-[10px] font-bold tracking-[.16em] text-slate-600">COLLECTIONS</p>
        {collections.map((collection) => <div className="desktop-nav-row" key={collection.id}><Button variant="ghost" className={cn("min-w-0 flex-1 justify-start", viewMode === "collection" && selectedCollectionId === collection.id && "bg-white/10")} onClick={() => void selectCollection(collection.id)}>
          <LayoutList size={17} /><span className="truncate">{collection.name}</span>
        </Button><details className="desktop-row-menu"><summary aria-label={`Actions for ${collection.name}`} title={`Actions for ${collection.name}`}><MoreHorizontal size={17} /></summary><div><button onClick={() => { setSelectedCollectionId(collection.id); setCollectionNameDraft(collection.name); setCollectionVaultDraft(collection.vault_ids); setCollectionDialog("edit"); }}>Edit collection</button><button onClick={() => void removeCollection(collection.id)}>Remove collection</button></div></details></div>)}
        <Button variant="ghost" className="justify-start text-xs" onClick={() => { setCollectionNameDraft(""); setCollectionVaultDraft([]); setCollectionDialog("create"); }}>Add collection</Button>
        {settingsConflict && <Button variant="ghost" className="justify-start text-xs text-amber-300" onClick={() => void invoke<{local: unknown; server: unknown}>("vault_settings_review").then(setSettingsReview).catch((error) => notify("error", "Could not review settings", friendlyError(error)))}>Review vault settings conflict</Button>}
        {removalPlan?.pending && <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/8 p-3 text-xs text-amber-100" role="status"><strong>Vault operation needs attention</strong><p className="mt-1">{removalPlan.choice === "move" ? "Move" : removalPlan.choice === "restore" ? "Restore" : "Archive"} · {removalPlan.stage === "copying" ? "copying items" : "finalizing request"} · {removalPlan.itemMappings?.length ?? 0} mapped item(s)</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={!online || removalBusy} onClick={resumeRemoval}>Resume</Button>{removalPlan.choice === "move" && removalPlan.stage === "copying" && <Button size="sm" variant="ghost" disabled={removalBusy} onClick={() => void abortMove()}>Keep copies and clear plan</Button>}</div></div>}
        <div className="mt-auto grid gap-1">
          {licenseStatus && <p className="px-3 py-2 text-xs text-slate-400" role="status">License: {licenseStatus.mode}{licenseStatus.plan ? ` · ${licenseStatus.plan}` : ""}{licenseStatus.enforcement === "disabled" ? " · experimental" : ""}</p>}
          <Button variant="ghost" className="justify-start" onClick={() => setSettingsOpen(true)}><Settings size={17} /><span>Settings</span></Button>
          <Button
            variant="ghost"
            className="justify-start"
            onClick={synchronize}
          >
            Sync now
          </Button>
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() => void lock()}
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
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <h1 className="text-xl font-bold">{viewMode === "all" ? "All items" : viewMode === "collection" ? collections.find((row) => row.id === selectedCollectionId)?.name ?? "Collection" : vaults.find((vault) => vault.vaultId === vaultId)?.name ?? "Items"}</h1>
          <Button
            size="icon"
            title={activeVaults.length ? "New item" : "Create or restore a vault before adding items"}
            disabled={!activeVaults.length}
            onClick={() => {
              setSelected({
                itemId: "",
                title: "",
                website: "",
                username: "",
                password: "",
                customFields: setItemType([], "login"),
              });
              setEditOriginal(null);
              setItemVaultId(viewMode === "single" ? vaultId : "");
              setEditing(true);
            }}
          >
            <Plus size={18} />
          </Button>
        </div>
        {!activeVaults.length && <p className="px-5 pb-4 text-sm text-slate-400">No active vaults. Create one or restore an archived vault in Settings.</p>}
        <div className="overflow-auto px-3">
          {filtered.map((item) => (
            <button
              key={item.itemId}
              onClick={() => void openItem(item)}
              className={cn(
                "mb-1 grid w-full grid-cols-[2.5rem_1fr] gap-3 rounded-xl p-3 text-left hover:bg-white/7",
                selected?.itemId === item.itemId && "bg-white/10",
              )}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-[#E0BB95]/12 text-[#E0BB95]">
                <KeyRound size={18} />
              </span>
              <span>
                <strong className="block truncate text-sm">{item.title}</strong>
                <small className="text-slate-500">{item.website}{viewMode !== "single" && item.vaultId ? ` · ${vaults.find((vault) => vault.vaultId === item.vaultId)?.code ?? item.vaultId}` : ""}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
      <main className={cn("desktop-detail overflow-auto p-7", selected && "detail-selected")}>
        {selected && <div className="desktop-back-row"><Button variant="ghost" onClick={() => { setSelected(null); setEditing(false); }}>← Items</Button></div>}
        {selected ? (
          <div className="mx-auto max-w-3xl">
            {editing ? (
              <>
                <div className="desktop-edit-header mb-7 flex items-start justify-between gap-4">
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
                    <Button onClick={() => void save()}>Save</Button>
                  </div>
                </div>
                {!selected.itemId && viewMode !== "single" && <label className="mb-6 block text-sm text-slate-300">Destination vault
                  <select className="mt-2 w-full rounded-xl border border-white/15 bg-[#11162b] p-3" value={itemVaultId} onChange={(event) => setItemVaultId(event.target.value)}>
                    <option value="">Choose a vault</option>
                    {activeVaults.filter((vault) => viewMode !== "collection" || collections.find((row) => row.id === selectedCollectionId)?.vault_ids.includes(vault.vaultId)).map((vault) => <option key={vault.vaultId} value={vault.vaultId}>{vault.name} · {vault.code}</option>)}
                  </select>
                </label>}
                <section>
                  <h3 className="mb-3 text-xs font-bold tracking-[.1em] text-slate-500">
                    BASICS
                  </h3>
                  <div className="grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-start">
                      <label className="grid gap-2 text-sm text-slate-400">
                        Title
                        <Input
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
                        value={selected.website}
                        onChange={(e) =>
                          setSelected({ ...selected, website: e.target.value })
                        }
                      />
                    </label>}
                  </div>
                </section>
                <section className="mt-8">
                  <h3 className="mb-3 text-xs font-bold tracking-[.1em] text-slate-500">
                    {ITEM_TYPES[itemType(selected.customFields)].label.toUpperCase()}
                  </h3>
                  <div className="grid gap-4">
                    {ITEM_TYPES[itemType(selected.customFields)].username && <label className="grid gap-2 text-sm text-slate-400">
                      Username
                      <Input
                        value={selected.username}
                        onChange={(e) =>
                          setSelected({ ...selected, username: e.target.value })
                        }
                      />
                    </label>}
                    {ITEM_TYPES[itemType(selected.customFields)].password && <label className="grid gap-2 text-sm text-slate-400">
                      Password
                      <div className="grid grid-cols-[1fr_auto] gap-2">
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
                        <Button
                          variant="secondary"
                          onClick={() => toggleReveal("password")}
                        >
                          {revealed.has("password") ? (
                            <EyeOff size={16} />
                          ) : (
                            <Eye size={16} />
                          )}
                          <span>
                            {revealed.has("password") ? "Hide" : "Reveal"}
                          </span>
                        </Button>
                      </div>
                    </label>}
                    {primaryFields(selected.customFields).map(knownFieldEditor)}
                  </div>
                </section>
                <section className="mt-8 border-t border-white/10 pt-7">
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
                        <label className="grid gap-2 text-xs text-slate-400">Kind<select className="rounded-xl border border-white/10 bg-[#11162b] px-3 text-sm" value={field.type} onChange={(event) => updateCustom(field.id, { type: event.target.value })}><option value="text">Text</option><option value="password">Secret</option><option value="url">URL</option><option value="number">Number</option></select></label>
                        <div className="sm:col-span-2">{knownFieldEditor(field)}</div>
                        <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setSelected({ ...selected, customFields: selected.customFields.filter((row) => row.id !== field.id) })}><Trash2 size={14} />Remove field</Button>
                      </div>) : section.fields.map(knownFieldEditor)}
                      {section.type === "custom" && <Button variant="secondary" className="justify-self-start" onClick={() => { if (selected.customFields.length >= 50) { notify("error", "Item is full", "Remove an unused field before adding another."); return; } setSelected({ ...selected, customFields: addSectionField(selected.customFields, section.id) }); }}><Plus size={15} />Add field</Button>}
                    </div>}
                  </div>)}</div>
                  <RelatedPicker type={itemType(selected.customFields)} onSelect={addRelated} />
                </section>
                <section className="mt-8">
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
                        <select
                          className="rounded-xl border border-white/10 bg-[#11162b] px-3 text-sm"
                          value={field.type}
                          onChange={(e) =>
                            updateCustom(field.id, { type: e.target.value })
                          }
                        >
                          {[
                            "text",
                            "password",
                            "url",
                            "date",
                            "email",
                            "number",
                            "note",
                          ].map((type) => (
                            <option key={type}>{type}</option>
                          ))}
                        </select>
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
                <div className="mb-7 flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-bold tracking-[.16em] text-slate-500">
                      {ITEM_TYPES[itemType(selected.customFields)].label.toUpperCase()}
                    </p>
                    <h2 className="mt-1 text-3xl font-bold">
                      {selected.title || "Untitled"}
                    </h2>
                    {selected.website && (
                      <button
                        className="mt-1 block text-sm text-[#E0BB95] hover:underline"
                        onClick={() => void openUrl(selected.website)}
                      >
                        {selected.website}
                      </button>
                    )}
                  </div>
                  <Button variant="secondary" onClick={beginEditing}>
                    Edit
                  </Button>
                </div>
                <section>
                  <h3 className="mb-3 text-xs font-bold tracking-[.1em] text-slate-500">
                    {ITEM_TYPES[itemType(selected.customFields)].label.toUpperCase()}
                  </h3>
                  <div className="overflow-hidden rounded-2xl border border-white/8 bg-white/3">
                    {[
                      ...(ITEM_TYPES[itemType(selected.customFields)].username ? [{
                        key: "username",
                        label: "Username",
                        value: selected.username,
                        secret: false,
                      }] : []),
                      ...(ITEM_TYPES[itemType(selected.customFields)].password ? [{
                        key: "password",
                        label: "Password",
                        value: selected.password,
                        secret: true,
                      }] : []),
                      ...[...primaryFields(selected.customFields), ...ordinaryFields(selected.customFields)].map((field) => ({
                        key: field.id,
                        label: field.label,
                        value: field.value,
                        secret: field.type === "password",
                      })),
                    ].map((field, index) => (
                      <div
                        key={field.key}
                        className={cn(
                          "desktop-field-row grid min-h-16 grid-cols-[7rem_1fr_auto] items-center gap-4 px-4",
                          index > 0 && "border-t border-white/7",
                        )}
                      >
                        <span className="text-xs text-slate-500">
                          {field.label}
                        </span>
                        <strong
                          className={cn(
                            "min-w-0 truncate text-sm",
                            field.secret && "font-mono",
                          )}
                        >
                          {field.secret && !revealed.has(field.key)
                            ? "••••••••••••"
                            : field.value || "—"}
                        </strong>
                        <div className="flex gap-1">
                          {field.secret && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => toggleReveal(field.key)}
                            >
                              {revealed.has(field.key) ? (
                                <EyeOff size={15} />
                              ) : (
                                <Eye size={15} />
                              )}
                              <span>
                                {revealed.has(field.key) ? "Hide" : "Reveal"}
                              </span>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void copyValue(field.value)}
                          >
                            <Copy size={15} />
                            <span>Copy</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            draggable
                            onDragStart={(event) =>
                              dragValue(event, field.label, field.value)
                            }
                            onDragEnd={() => dragSession.end()}
                            title={`Drag ${field.label}`}
                          >
                            <GripVertical size={15} />
                            <span>Drag</span>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {sections(selected.customFields).map((section) => <section key={section.id} className="mt-6 overflow-hidden rounded-2xl border border-white/8 bg-white/3">
                    <h3 className="border-b border-white/8 px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#E0BB95]">{section.label}</h3>
                    {section.fields.map((field) => <div key={field.id} className="desktop-field-row grid min-h-16 grid-cols-[7rem_1fr_auto] items-center gap-4 border-b border-white/7 px-4 last:border-0">
                      <span className="text-xs text-slate-500">{field.label}</span>
                      <strong className="min-w-0 truncate text-sm">{field.type === "password" && !revealed.has(field.id) ? "••••••••••••" : field.value || "—"}</strong>
                      <div className="flex gap-1">
                        {field.type === "password" && <Button size="sm" variant="ghost" onClick={() => toggleReveal(field.id)}>{revealed.has(field.id) ? <EyeOff size={15} /> : <Eye size={15} />}<span>{revealed.has(field.id) ? "Hide" : "Reveal"}</span></Button>}
                        <Button size="sm" variant="ghost" onClick={() => void copyValue(field.value)}><Copy size={15} /><span>Copy</span></Button>
                        <Button size="sm" variant="ghost" draggable onDragStart={(event) => dragValue(event, field.label, field.value)} onDragEnd={() => dragSession.end()}><GripVertical size={15} /><span>Drag</span></Button>
                      </div>
                    </div>)}
                  </section>)}
                  {itemType(selected.customFields) === "wifi" && selected.customFields.find((field) => field.id === "ssid")?.value && <div className="mt-6 inline-grid gap-3 rounded-xl bg-white p-4 text-slate-900">
                    <QRCodeSVG size={180} value={`WIFI:T:${selected.customFields.find((field) => field.id === "wifi_security")?.value || "WPA"};S:${selected.customFields.find((field) => field.id === "ssid")?.value.replace(/([\\;,:\"])/g, "\\$1")};P:${selected.password.replace(/([\\;,:\"])/g, "\\$1")};;`} />
                    <span className="text-center text-xs font-semibold">Scan to join Wi-Fi</span>
                  </div>}
                </section>
              </>
            )}
          </div>
        ) : (
          <p className="text-slate-500">Select an item.</p>
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
            online ? "bg-emerald-400" : "bg-amber-400",
          )}
        ></span>
        <strong>{online ? "Online" : "Offline"}</strong>
        <span className="ml-auto">
          Local change{" "}
          {lastLocalChange
            ? lastLocalChange.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—"}{" "}
          · Server sync{" "}
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
              Sync now
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
      {settingsOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="desktop-settings-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <section className="desktop-settings relative grid w-full max-w-3xl grid-cols-[12rem_minmax(0,1fr)] overflow-hidden rounded-2xl border border-white/10 bg-[#080c1f] shadow-2xl">
          <Button variant="ghost" className="desktop-settings-close absolute right-3 top-3 z-10 !size-9 !min-h-9 !justify-center !p-0" aria-label="Close settings" title="Close settings" onClick={() => setSettingsOpen(false)}><X size={18} /></Button>
          <aside className="desktop-settings-nav flex flex-col border-r border-white/10 p-4"><p className="text-[10px] font-bold tracking-[.16em] text-slate-500">SETTINGS</p><h2 id="desktop-settings-title" className="mb-5 mt-2 text-xl font-bold">Settings</h2>{(["profile", "devices", "vaults", "preferences"] as const).map((tab) => <Button key={tab} role="tab" aria-selected={settingsTab === tab} variant="ghost" className={cn("justify-start", settingsTab === tab && "bg-[#E0BB95]/12 text-[#E0BB95]")} onClick={() => { setSettingsTab(tab); if (tab === "devices") void loadDevices(); }}>{tab[0].toUpperCase() + tab.slice(1)}</Button>)}</aside>
          <div className="desktop-settings-body overflow-auto p-8 pr-12 text-sm">
            {settingsTab === "profile" && <div className="grid gap-5"><div><h3 className="text-2xl font-bold">Profile</h3><p className="mt-1 text-slate-400">Your account on this device.</p></div><p><span className="text-slate-400">Username</span><br /><strong>{username || "This device"}</strong></p><p><span className="text-slate-400">Device ID</span><br /><code className="break-all text-xs">{desktopInfo?.deviceId ?? "Unavailable"}</code></p><p><span className="text-slate-400">Connection</span><br />{online ? "Online" : "Offline"}</p>{!online && offlineReason && <p className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-200">Online unlock failed: {offlineReason}. Check the configured server and trusted certificate.</p>}<p><span className="text-slate-400">Account secret</span><br />{rememberedSecret ? "Remembered securely on this device for 30 days" : "Required at next unlock"}</p>{online ? <Button variant="secondary" className="w-fit" onClick={() => void synchronize()}>Sync now</Button> : <div className="grid gap-2 rounded-xl border border-white/10 p-4"><strong>Reconnect to create vaults and manage devices</strong><p className="text-xs text-slate-400">Enter your master password to verify a live session.</p>{(!rememberedSecret || showSecretEntry) && <Input aria-label="Account secret for reconnect" type="password" autoComplete="off" placeholder="Account secret" value={accountSecret} onChange={(event) => setAccountSecret(event.target.value)} />}{errors.accountSecret && <p className="text-xs text-red-300">{errors.accountSecret}</p>}<Input aria-label="Master password for reconnect" type="password" autoComplete="current-password" placeholder="Master password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} />{errors.masterPassword && <p className="text-xs text-red-300">{errors.masterPassword}</p>}<Button className="w-fit" disabled={busy} onClick={() => void unlock().then((connected) => { if (connected) setSettingsOpen(false); })}>Reconnect</Button></div>}</div>}
            {settingsTab === "devices" && <div><h3 className="text-2xl font-bold">Devices</h3><p className="mt-1 text-slate-400">Devices registered to this account.</p>{deviceError && <p className="mt-5 text-amber-300">{deviceError}</p>}<div className="mt-5 grid gap-2">{devices.map((device) => <div key={device.deviceId} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/3 p-3"><div><strong>{device.deviceId === currentDeviceId ? "This desktop" : `Device ${device.deviceId.slice(0, 8)}`}</strong><p className="mt-1 text-xs text-slate-400">{device.protectionClass ?? "Unknown"} protection · credential {device.credentialState ?? "unknown"} · {device.status ?? "unknown"}</p></div>{device.deviceId !== currentDeviceId && device.status === "active" && <Button variant="ghost" className="text-red-300" onClick={() => void revokeDevice(device.deviceId)}>Revoke</Button>}</div>)}</div><Button variant="secondary" className="mt-5" onClick={() => void loadDevices()}>Refresh devices</Button></div>}
            {settingsTab === "vaults" && <div className="grid gap-5">
              <div><h3 className="text-2xl font-bold">Vaults</h3><p className="mt-1 text-slate-400">Manage your encrypted vaults.</p></div>
              {removalPlan?.pending && <div className="rounded-xl border border-amber-300/30 bg-amber-300/8 p-4 text-sm"><strong>Pending {removalPlan.choice} operation</strong><p className="mt-1 text-slate-300">{removalPlan.stage === "copying" ? "Destination copies are being prepared." : "The final server request is ready to retry."} {removalPlan.itemMappings?.length ?? 0} mapped item(s).</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={!online || removalBusy} onClick={resumeRemoval}>Resume</Button>{removalPlan.choice === "move" && removalPlan.stage === "copying" && <Button size="sm" variant="ghost" disabled={removalBusy} onClick={() => void abortMove()}>Keep copies and clear plan</Button>}</div></div>}
              <div className="grid gap-2">{activeVaults.map((vault) => <div key={vault.vaultId} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3"><span>{vault.name}</span><span className="text-xs text-slate-500">{vault.code}</span><Button size="sm" variant="ghost" disabled={!online || removalBusy} onClick={() => openRemoval(vault.vaultId)}>Remove…</Button></div>)}</div>
              {archivedVaults.length > 0 && <div className="grid gap-2"><h4 className="text-sm font-semibold">Archived vaults</h4>{archivedVaults.map((vault) => <div key={vault.vaultId} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3"><span>{vault.name}</span><span className="text-xs text-slate-500">{vault.code}</span><Button size="sm" variant="secondary" disabled={!online || removalBusy || !!removalPlan?.pending} onClick={() => void restoreVault(vault.vaultId)}>Restore</Button></div>)}</div>}
              <Button variant="secondary" className="w-fit" onClick={() => { if (!online) { setSettingsTab("profile"); return; } setSettingsOpen(false); setVaultNameDraft(""); setVaultDialog("create"); }}>{online ? "Create vault" : "Reconnect to create vault"}</Button>
              {!online && <p className="text-xs text-amber-300">Vault creation and removal require an online session.</p>}
            </div>}
            {settingsTab === "preferences" && <div className="grid gap-5"><div><h3 className="text-2xl font-bold">Preferences</h3><p className="mt-1 text-slate-400">Choose what opens first and how vault removal is handled.</p></div><label className="grid gap-2">Default view<select className="desktop-settings-select" value={defaultView ? `${defaultView.kind}:${defaultView.id ?? ""}` : "all:"} onChange={(event) => { const [kind, selector] = event.target.value.split(":"); void saveDefaultView(kind, selector || null); }}><option value="all:">All items</option>{activeVaults.map((vault) => <option key={vault.vaultId} value={`vault:${vault.vaultId}`}>Vault: {vault.name}</option>)}{collections.map((collection) => <option key={collection.id} value={`collection:${collection.id}`}>Collection: {collection.name}</option>)}</select></label><label className="grid gap-2">When removing a vault<select className="desktop-settings-select" value={removalPreference ?? "ask"} onChange={(event) => void invoke<VaultSettings>("vault_removal_preference", { choice: event.target.value === "ask" ? null : event.target.value }).then((result) => { setRemovalPreference(result.removalPreference); setSettingsConflict(result.conflict); }).catch((error) => notify("error", "Could not save preference", friendlyError(error)))}><option value="ask">Ask me each time</option><option value="move">Move items</option><option value="archive">Archive items</option></select></label></div>}
          </div>
        </section>
      </div>}
      {settingsReview && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6" role="dialog" aria-modal="true" aria-labelledby="settings-review-title">
        <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#11162b] p-6 text-slate-100">
          <h2 id="settings-review-title" className="text-lg font-semibold">Review vault settings conflict</h2>
          <p className="mt-2 text-sm text-slate-400">Compare vault names, collections, default view, and removal preference. Choose which complete settings version to keep.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><div><h3 className="mb-2 font-medium">This device</h3><pre className="max-h-64 overflow-auto rounded bg-black/30 p-3 text-xs">{JSON.stringify(settingsReview.local, null, 2)}</pre></div><div><h3 className="mb-2 font-medium">Server</h3><pre className="max-h-64 overflow-auto rounded bg-black/30 p-3 text-xs">{JSON.stringify(settingsReview.server, null, 2)}</pre></div></div>
          <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setSettingsReview(null)}>Cancel</Button>{(["local", "server"] as const).map((keep) => <Button key={keep} onClick={() => void invoke<VaultSettings>("vault_settings_resolve", { keep }).then((result) => { setCollections(result.collections); setDefaultView(result.defaultView); setSettingsConflict(result.conflict); setSettingsReview(null); notify("success", "Vault settings resolved"); }).catch((error) => notify("error", "Could not resolve settings", friendlyError(error)))}>Keep {keep}</Button>)}</div>
        </div>
      </div>}
      {collectionDialog && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6" role="dialog" aria-modal="true" aria-labelledby="collection-dialog-title">
        <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#11162b] p-7 shadow-2xl">
          <h2 id="collection-dialog-title" className="text-xl font-bold">{collectionDialog === "create" ? "Create collection" : "Edit collection"}</h2>
          <label className="mt-5 block text-sm text-slate-300">Collection name
            <Input autoFocus className="mt-2" maxLength={80} value={collectionNameDraft} onChange={(event) => setCollectionNameDraft(event.target.value)} />
          </label>
          <p className="mt-5 text-sm text-slate-300">Included vaults</p>
          <div className="mt-2 grid gap-2">{activeVaults.map((vault) => <label key={vault.vaultId} className="flex items-center gap-3 rounded-lg border border-white/10 p-2 text-sm">
            <input type="checkbox" checked={collectionVaultDraft.includes(vault.vaultId)} onChange={(event) => setCollectionVaultDraft((current) => event.target.checked ? [...current, vault.vaultId] : current.filter((id) => id !== vault.vaultId))} />
            {vault.name} <small className="ml-auto text-slate-500">{vault.code}</small>
          </label>)}</div>
          <div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={() => setCollectionDialog(null)}>Cancel</Button>
            <Button disabled={!collectionNameDraft.trim() || !collectionVaultDraft.length} onClick={() => void saveCollection()}>Save collection</Button></div>
        </section>
      </div>}
      {vaultDialog && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6" role="dialog" aria-modal="true" aria-labelledby="vault-dialog-title">
        <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#11162b] p-7 shadow-2xl">
          <h2 id="vault-dialog-title" className="text-xl font-bold">{vaultDialog === "create" ? "Create vault" : "Rename vault"}</h2>
          <label className="mt-5 block text-sm text-slate-300">Vault name
            <Input autoFocus className="mt-2" maxLength={80} value={vaultNameDraft} onChange={(event) => setVaultNameDraft(event.target.value)} />
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setVaultDialog(null)}>Cancel</Button>
            <Button disabled={!vaultNameDraft.trim()} onClick={() => void (vaultDialog === "create" ? addVault() : renameVault())}>{vaultDialog === "create" ? "Create" : "Save name"}</Button>
          </div>
        </section>
      </div>}
      {removalDialog && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6" role="dialog" aria-modal="true" aria-labelledby="removal-dialog-title">
        <section className="w-full max-w-lg rounded-2xl border border-amber-300/20 bg-[#11162b] p-7 shadow-2xl">
          <h2 id="removal-dialog-title" className="text-xl font-bold">Remove {vaults.find((row) => row.vaultId === removalDialog.sourceId)?.name ?? "vault"}</h2>
          <p className="mt-2 text-sm text-slate-300">{removalItemCount === null ? "Items" : `${removalItemCount} item(s)`} will remain encrypted and recoverable in the source vault. Choose what should happen to the active view.</p>
          <fieldset className="mt-5 grid gap-3"><legend className="mb-2 text-sm font-semibold">Removal choice</legend>
            <label className="flex gap-3 rounded-xl border border-white/10 p-3 text-sm"><input type="radio" name="removal-choice" checked={removalDialog.choice === "archive"} onChange={() => setRemovalDialog({ ...removalDialog, choice: "archive" })} /><span><strong>Archive</strong><span className="mt-1 block text-slate-400">Keep items in this vault, hidden from normal views. You can restore it later.</span></span></label>
            <label className="flex gap-3 rounded-xl border border-white/10 p-3 text-sm"><input type="radio" name="removal-choice" checked={removalDialog.choice === "move"} disabled={activeVaults.length < 2 || (removalItemCount !== null && removalItemCount > 50)} onChange={() => setRemovalDialog({ ...removalDialog, choice: "move" })} /><span><strong>Move items</strong><span className="mt-1 block text-slate-400">Re-encrypt every item under another vault key, verify the copies, then retire this vault.</span></span></label>
          </fieldset>
          {removalItemCount !== null && removalItemCount > 50 && <p className="mt-3 text-xs text-amber-300">Move supports at most 50 items. Archive this vault or move items in smaller batches first.</p>}
          {removalDialog.choice === "move" && <label className="mt-4 grid gap-2 text-sm">Destination vault<select className="desktop-settings-select" value={removalDialog.destinationId} onChange={(event) => setRemovalDialog({ ...removalDialog, destinationId: event.target.value })}>{activeVaults.filter((row) => row.vaultId !== removalDialog.sourceId).map((row) => <option key={row.vaultId} value={row.vaultId}>{row.name} · {row.code}</option>)}</select></label>}
          <p className="mt-4 text-xs text-slate-400">The operation requires a connection and no unresolved local edits. If interrupted, it can be resumed from Settings.</p>
          <div className="mt-6 flex justify-end gap-2"><Button variant="ghost" disabled={removalBusy} onClick={() => setRemovalDialog(null)}>Cancel</Button><Button disabled={removalBusy || (removalDialog.choice === "move" && (!removalDialog.destinationId || (removalItemCount !== null && removalItemCount > 50)))} onClick={() => void removeVault(removalDialog.sourceId, removalDialog.choice, removalDialog.destinationId)}>{removalBusy ? "Working…" : removalDialog.choice === "move" ? "Move and retire" : "Archive vault"}</Button></div>
        </section>
      </div>}
      {conflict && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="conflict-title"
        >
          <section className="max-h-[90dvh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-amber-300/20 bg-[#11162b] p-7 shadow-2xl max-[620px]:p-4">
            <AlertTriangle className="text-amber-300" />
            <h2 id="conflict-title" className="mt-4 text-xl font-bold">
              Resolve sync conflict
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {conflict.message} Compare each field and select the value to save.
            </p>
            {conflict.server && conflict.choices && (
              <div className="mt-5 overflow-hidden rounded-xl border border-white/10">
                <div className="desktop-conflict-row grid grid-cols-[9rem_1fr_1fr] gap-3 border-b border-white/10 bg-white/5 p-3 text-xs font-bold uppercase tracking-wider text-slate-400"><span>Field</span><span>Mine</span><span>Theirs</span></div>
                {(["title", "website", "username", "password", "customFields"] as const).map((field) => {
                  const display = (value: Item[typeof field]) => field === "password" ? "••••••••" : field === "customFields" ? `${(value as CustomField[]).length} field(s)` : String(value || "—");
                  return <div key={field} className="desktop-conflict-row grid grid-cols-[9rem_1fr_1fr] gap-3 border-b border-white/7 p-3 last:border-0"><b className="self-center text-xs capitalize text-slate-400">{field === "customFields" ? "Custom fields" : field}</b>{(["local", "server"] as const).map((source) => <button key={source} role="radio" aria-checked={conflict.choices?.[field] === source} className={cn("flex min-h-14 items-center gap-3 rounded-lg border p-3 text-left text-sm", conflict.choices?.[field] === source ? "border-[#E0BB95]/60 bg-[#E0BB95]/10" : "border-white/10")} onClick={() => setConflict({ ...conflict, choices: { ...conflict.choices!, [field]: source } })}><span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded border", conflict.choices?.[field] === source ? "border-[#E0BB95] bg-[#E0BB95] text-[#11162b]" : "border-slate-500")}>{conflict.choices?.[field] === source && <Check size={14} />}</span><span className="min-w-0 truncate">{display(source === "local" ? conflict.draft[field] : conflict.server![field])}</span></button>)}</div>;
                })}
              </div>
            )}
            <div className="mt-6 grid gap-2">
              {conflict.kind !== "delete-edit-divergence" && (conflict.server ? <Button onClick={applyMerge}>Save selected fields</Button> : <Button onClick={() => void prepareMerge()}>Compare and select fields…</Button>)}
              {conflict.kind !== "delete-edit-divergence" && (
              <Button
                onClick={() => {
                  if (conflict.server) {
                    const draft = conflict.draft;
                    const operationId = conflict.operationId ?? null;
                    setConflict(null);
                    void save(draft, operationId);
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
                onClick={() => {
                  const itemId = conflict.draft.itemId;
                  if (itemId && conflict.operationId) {
                    setConflict(null);
                    void useServerVersion(itemId, conflict.operationId);
                  } else {
                    void prepareMerge();
                  }
                }}
              >
                Use theirs · discard mine
              </Button>
              <Button variant="ghost" onClick={() => { setConflict(null); if (conflict.kind === "delete-edit-divergence") setEditing(false); }}>
                {conflict.kind === "delete-edit-divergence" ? "Close" : "Cancel and keep editing"}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
