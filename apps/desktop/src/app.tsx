import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Input, cn } from "@127vaults/ui";
import { QRCodeSVG } from "qrcode.react";
import { createDragSession } from "./drag-session.mjs";
import { choicesForConflict } from "./conflict-choice.mjs";
import { ITEM_TYPES, TYPE_GROUPS, addSection, itemType, ordinaryFields, primaryFields, removeSection, sections, setItemType, visibleFields, type ItemType, type SectionType } from "./item-types";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  KeyRound,
  LayoutList,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
  Trash2,
  Vault,
} from "lucide-react";

type Summary = { itemId: string; title: string; website: string };
type CustomField = { id: string; label: string; type: string; value: string };
type Item = Summary & {
  username: string;
  password: string;
  customFields: CustomField[];
};
type VaultSummary = { vaultId: string; name: string; code: string };
type UnlockResult = { online: boolean; vaultId: string; vaults: VaultSummary[]; items: Summary[] };
type DesktopInfo = {
  configured: boolean;
  configurationPath: string;
  registrationUrl: string | null;
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

function TypePicker({ value, onSelect, section = false }: { value?: ItemType; onSelect: (type: ItemType | SectionType) => void; section?: boolean }) {
  return <details className="group relative w-full max-w-sm">
    <summary className="cursor-pointer list-none rounded-xl border border-white/10 bg-[#11162b] px-4 py-3 text-sm text-slate-100 hover:border-[#E0BB95]/50">
      {value ? ITEM_TYPES[value].label : "Add typed section"} <span className="float-right text-slate-400">⌄</span>
    </summary>
    <div className="absolute left-0 top-full z-30 mt-2 w-full min-w-72 rounded-xl border border-white/10 bg-[#11162b] p-2 shadow-2xl">
      {TYPE_GROUPS.map((group) => <div key={group.label} className="mb-2 last:mb-0">
        <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{group.label}</p>
        {group.types.map((type) => <button key={type} type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10" onClick={(event) => { onSelect(type); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{ITEM_TYPES[type].label}</button>)}
      </div>)}
      {section && <div><p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Recovery</p><button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10" onClick={(event) => { onSelect("security"); event.currentTarget.closest("details")?.removeAttribute("open"); }}>Security info</button></div>}
    </div>
  </details>;
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
  const [items, setItems] = useState<Summary[]>([]),
    [selected, setSelected] = useState<Item | null>(null);
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [editOriginal, setEditOriginal] = useState<Item | null>(null);
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null),
    [username, setUsername] = useState("");
  const [accountSecret, setAccountSecret] = useState(""),
    [masterPassword, setMasterPassword] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [notices, setNotices] = useState<Notice[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [resolvingOperationId, setResolvingOperationId] = useState<string | null>(null);
  const [footerMenu, setFooterMenu] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [lastLocalChange, setLastLocalChange] = useState<Date | null>(null);
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

  const lock = async (reason = "Locked") => {
    await invoke("lock").catch(() => undefined);
    setUnlocked(false);
    setVaults([]);
    setVaultId("");
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
      .then(setDesktopInfo)
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
      setSelected(await loadItem(summary, vault));
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
    if (busy) return;
    const nextErrors: Record<string, string> = {};
    if (!username.trim()) nextErrors.username = "Enter your username.";
    if (!/^[0-9a-fA-F]{64}$/.test(accountSecret))
      nextErrors.accountSecret = "Enter the 64-character account secret.";
    if ([...masterPassword].length < 20)
      nextErrors.masterPassword =
        "Master password must be at least 20 characters.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
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
      setVaults(result.vaults);
      setItems(result.items);
      setOnline(result.online);
      setUnlocked(true);
      dragSession.unlock();
      setAccountSecret("");
      setMasterPassword("");
      setStatus(
        result.online
          ? "Unlocked · verified online replica"
          : "Unlocked offline · changes will sync when the server is available",
      );
      setLastSynced(result.online ? new Date() : null);
      notify(
        "success",
        "Vault unlocked",
        result.online
          ? "The server replica is up to date."
          : "Working from the encrypted offline replica.",
      );
      if (result.items[0]) await openItem(result.items[0], result.vaultId);
    } catch (e) {
      const message = String(e);
      const detail =
        message.includes("401") &&
        message.includes("offline unlock is not provisioned")
          ? "This device was rejected by the server and has no offline replica yet. Register this device, then complete one online unlock to enable offline access."
          : friendlyError(e);
      setStatus(detail);
      notify("error", "Could not unlock the vault", detail);
    } finally {
      setBusy(false);
    }
  };
  const selectVault = async (nextVaultId: string) => {
    if (nextVaultId === vaultId) return;
    try {
      const nextItems = await invoke<Summary[]>("item_list", { vaultId: nextVaultId });
      setVaultId(nextVaultId);
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
  const addVault = async () => {
    try {
      const result = await invoke<{ created: VaultSummary; vaults: VaultSummary[] }>("vault_create");
      setVaults(result.vaults);
      await selectVault(result.created.vaultId);
      notify("success", "Private vault created", result.created.code);
    } catch (error) {
      notify("error", "Could not create vault", friendlyError(error));
    }
  };
  const save = async (draft = selected, resolutionId = resolvingOperationId) => {
    if (!draft) return;
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
        vaultId,
        itemId: draft.itemId || null,
        title: draft.title,
        website: draft.website,
        username: draft.username,
        password: draft.password,
        customFields: draft.customFields,
        resolvingOperationId: resolutionId,
      });
      setItems(response.items);
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
      if (saved) await openItem(saved);
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
      const result = await invoke<{ accepted: number; items: Summary[]; conflicts: EngineConflict[] }>(
        "sync",
        { vaultId },
      );
      setOnline(true);
      setItems(result.items);
      setLastSynced(new Date());
      setStatus(
        result.conflicts.length
          ? `Sync needs review · ${result.conflicts.length} pending conflict(s)`
          : `Sync complete · ${result.accepted} pending operation(s) accepted`,
      );
      const pendingConflict = result.conflicts.find((row) => row.vaultId === vaultId);
      if (pendingConflict && !conflict) {
        const draft = await invoke<Item>("conflict_draft", { vaultId, itemId: pendingConflict.itemId, operationId: pendingConflict.operationId });
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
      setItems(result.items);
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
    setEditing(true);
  };
  const cancelEditing = () => {
    setSelected(editOriginal);
    setEditOriginal(null);
    setEditing(false);
    setStatus("Edit cancelled");
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
            <Input
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
            />
            {errors.accountSecret && (
              <p className="-mt-2 text-xs text-red-300">
                {errors.accountSecret}
              </p>
            )}
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
    <div className="grid h-screen grid-cols-[15rem_minmax(18rem,22rem)_1fr] grid-rows-[1fr_2rem] overflow-hidden bg-[#04071d]">
      <aside className="row-span-2 flex flex-col border-r border-white/7 bg-[#0a0e21] p-3">
        <div className="mb-7 flex items-center gap-3 px-2 py-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#9D1F32] text-xs font-black">
            127
          </span>
          <strong>127Vaults</strong>
        </div>
        <Button variant="ghost" className="justify-start bg-white/7">
          <LayoutList size={17} />
          <span>All items</span>
          <span className="ml-auto">{items.length}</span>
        </Button>
        <p className="mb-2 mt-7 px-3 text-[10px] font-bold tracking-[.16em] text-slate-600">
          VAULTS
        </p>
        {vaults.map((vault) => <Button key={vault.vaultId} variant="ghost" className={cn("justify-start", vault.vaultId === vaultId && "bg-white/10")} onClick={() => void selectVault(vault.vaultId)}>
          <Vault size={17} />
          <span className="truncate">{vault.name}</span>
          <span className="ml-auto text-[10px] text-slate-500">{vault.code}</span>
        </Button>)}
        <Button variant="ghost" className="justify-start" onClick={() => void addVault()} disabled={!online}>
          <Plus size={17} />
          <span>Add private vault</span>
        </Button>
        <div className="mt-auto grid gap-1">
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
      </aside>
      <section className="overflow-hidden border-r border-white/7 bg-[#080c1d]">
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
          <h1 className="text-xl font-bold">All items</h1>
          <Button
            size="icon"
            title="New item"
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
              setEditing(true);
            }}
          >
            <Plus size={18} />
          </Button>
        </div>
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
                <small className="text-slate-500">{item.website}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
      <main className="overflow-auto p-7">
        {selected ? (
          <div className="mx-auto max-w-3xl">
            {editing ? (
              <>
                <div className="mb-7 flex items-start justify-between gap-4">
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
                <section>
                  <div className="mb-6 grid gap-2 text-sm text-slate-400">Item type
                    <TypePicker value={itemType(selected.customFields)} onSelect={(type) => setSelected({ ...selected, customFields: setItemType(selected.customFields, type as ItemType) })} />
                  </div>
                  <h3 className="mb-3 text-xs font-bold tracking-[.1em] text-slate-500">
                    BASICS
                  </h3>
                  <div className="grid gap-4">
                    <label className="grid gap-2 text-sm text-slate-400">
                      Title
                      <Input
                        value={selected.title}
                        aria-invalid={!!errors.title}
                        className={
                          errors.title
                            ? "border-red-400 ring-4 ring-red-400/10"
                            : ""
                        }
                        onChange={(e) =>
                          setSelected({ ...selected, title: e.target.value })
                        }
                      />
                      {errors.title && (
                        <span className="text-xs text-red-300">
                          {errors.title}
                        </span>
                      )}
                    </label>
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
                <section className="mt-8 grid gap-5">
                  {sections(selected.customFields).map((section) => <div key={section.id} className="rounded-2xl border border-white/10 bg-white/3 p-5">
                    <div className="mb-4 flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-[#E0BB95]">{section.label}</h3><Button size="sm" variant="ghost" onClick={() => setSelected({ ...selected, customFields: removeSection(selected.customFields, section.id) })}><Trash2 size={15} /><span>Remove section</span></Button></div>
                    <div className="grid gap-4">{section.fields.map(knownFieldEditor)}</div>
                  </div>)}
                  <TypePicker section onSelect={(type) => setSelected({ ...selected, customFields: addSection(selected.customFields, type) })} />
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
                        className="grid grid-cols-[minmax(8rem,1fr)_8rem_minmax(10rem,2fr)_auto] gap-2"
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
                          "grid min-h-16 grid-cols-[7rem_1fr_auto] items-center gap-4 px-4",
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
                    {section.fields.map((field) => <div key={field.id} className="grid min-h-16 grid-cols-[7rem_1fr_auto] items-center gap-4 border-b border-white/7 px-4 last:border-0">
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
        <span>·</span>
        <span role="status">{status}</span>
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
      {conflict && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="conflict-title"
        >
          <section className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-amber-300/20 bg-[#11162b] p-7 shadow-2xl">
            <AlertTriangle className="text-amber-300" />
            <h2 id="conflict-title" className="mt-4 text-xl font-bold">
              Resolve sync conflict
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {conflict.message} Compare each field and select the value to save.
            </p>
            {conflict.server && conflict.choices && (
              <div className="mt-5 overflow-hidden rounded-xl border border-white/10">
                <div className="grid grid-cols-[9rem_1fr_1fr] gap-3 border-b border-white/10 bg-white/5 p-3 text-xs font-bold uppercase tracking-wider text-slate-400"><span>Field</span><span>Mine</span><span>Theirs</span></div>
                {(["title", "website", "username", "password", "customFields"] as const).map((field) => {
                  const display = (value: Item[typeof field]) => field === "password" ? "••••••••" : field === "customFields" ? `${(value as CustomField[]).length} field(s)` : String(value || "—");
                  return <div key={field} className="grid grid-cols-[9rem_1fr_1fr] gap-3 border-b border-white/7 p-3 last:border-0"><b className="self-center text-xs capitalize text-slate-400">{field === "customFields" ? "Custom fields" : field}</b>{(["local", "server"] as const).map((source) => <button key={source} role="radio" aria-checked={conflict.choices?.[field] === source} className={cn("flex min-h-14 items-center gap-3 rounded-lg border p-3 text-left text-sm", conflict.choices?.[field] === source ? "border-[#E0BB95]/60 bg-[#E0BB95]/10" : "border-white/10")} onClick={() => setConflict({ ...conflict, choices: { ...conflict.choices!, [field]: source } })}><span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded border", conflict.choices?.[field] === source ? "border-[#E0BB95] bg-[#E0BB95] text-[#11162b]" : "border-slate-500")}>{conflict.choices?.[field] === source && <Check size={14} />}</span><span className="min-w-0 truncate">{display(source === "local" ? conflict.draft[field] : conflict.server![field])}</span></button>)}</div>;
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
