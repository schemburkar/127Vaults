import init, {
  ExperimentalEcf1Core,
  ExperimentalOpaqueBridge,
  generate_secret,
} from "/wasm/vaults_browser_fixture.js";
import { PASSKEY_META, PASSKEY_KEY, readMetadata, passkeyFields } from '/app/passkeys.mjs';
import { PwaReplica, isInstalledApp, networkUnavailable, replicaRead, recordRevision, collapseQueue, requireEntitlement } from '/app/pwa-replica.mjs';
import { requestBrowserEnrollment, finishBrowserEnrollment } from '/app/browser-enrollment.mjs';
import { VaultLifecycleClient } from '/app/vault-lifecycle.mjs';
import { verifySyncHistory, verifyLatestPayload, verifyCheckpoints, checkpointHash, verifyQueuedOperation } from '/app/signed-sync.mjs';
const installedApp = isInstalledApp();
let replica = null, reconnectCredentials = null, serverAuthenticated = false, snapshotBusy = false;
let startupReady = false;
let sessionGeneration = 0, lockDeadline = 0;
const replicaChanged = () => {
  window.dispatchEvent(new CustomEvent('vaults:pwa-status', { detail: { ready: !!replica?.state.snapshotAt, at: replica?.state.snapshotAt } }));
  if (root) updateSessionDates();
};
let passkeyVerifier = null, editorPasskeyFields = [];
window.addEventListener('vaults:remove-editor-passkey', () => { editorPasskeyFields = []; });
async function passwordCheckBytes(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 }, key, 256));
}
async function verifyPasskeyPassword(password) {
  const verifier = passkeyVerifier, activeRoot = root;
  if (!verifier || !activeRoot || typeof password !== 'string' || password.length > 16384) throw Error('Unlock the web vault first.');
  const candidate = await passwordCheckBytes(password, verifier.salt);
  const ok = equal(candidate, verifier.value);
  candidate.fill(0);
  if (!ok || root !== activeRoot || passkeyVerifier !== verifier) throw Error('Master password verification failed or vault locked.');
  arm();
  return true;
}
const $ = (id) => document.getElementById(id),
  te = new TextEncoder(),
  td = new TextDecoder(),
  b64 = (x) => {
    let s = "";
    for (const v of x) s += String.fromCharCode(v);
    return btoa(s)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  },
  un = (x) =>
    Uint8Array.from(atob(x.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
      c.charCodeAt(0),
    ),
  cat = (...xs) => {
    let n = xs.reduce((a, x) => a + x.length, 0),
      o = new Uint8Array(n),
      p = 0;
    for (let x of xs) {
      o.set(x, p);
      p += x.length;
    }
    return o;
  },
  id = (x) =>
    Uint8Array.from(x.replaceAll("-", "").match(/../g), (v) => parseInt(v, 16)),
  uuid = (x) => {
    let h = [...x].map((v) => v.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  },
  be = (n, size) => {
    let x = new Uint8Array(size),
      v = BigInt(n);
    for (let i = size - 1; i >= 0; i--) {
      x[i] = Number(v & 255n);
      v >>= 8n;
    }
    return x;
  };
let core,
  root,
  vault,
  catalogue,
  vaultId,
  availableVaults = [],
  vaultDialogTarget = null,
  settingsRevision = null,
  vaultSettings = { version: 1, names: {}, collections: [], default_view: null, removal_preference: null },
  csrf,
  busy = false,
  sessionTimer,
  identity,
  currentItem,
  authContext,
  loadedItems = [],
  registrationStep = 0,
  ownerSetupRequired = false,
  generatedAccountSecret = "",
  lastSynced = null,
  lastLocalChange = null;
const features = window.__vaultsFeatures;
let favoritesOnly = false, favoriteItems = [], editorBaseline = null, syncState = 'idle', syncFailure = '';
let browseView = null, browseItems = [], applyDefaultView = false;
function editorSnapshot() {
  if ($("item-form").hidden) return null;
  try { return JSON.stringify({ values: ["item-id", "title", "url", "item-username", "item-password"].map(id => $(id).value), fields: collectCustomFields() }); }
  catch { return JSON.stringify([...$("item-form").querySelectorAll('input,select,textarea')].map(input => [input.value, input.checked])); }
}
function hasUnsavedChanges() { return editorBaseline !== null && !$("item-form").hidden && editorSnapshot() !== editorBaseline; }
function confirmDiscard() {
  if (!hasUnsavedChanges()) return true;
  if (!window.confirm("Discard your unsaved changes?")) return false;
  editorBaseline = null;
  if (currentItem) displayItem(currentItem); else clearItem();
  return true;
}
window.addEventListener('beforeunload', event => { if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ''; } });
const updateSessionDates = () => {
  let node = $("session-dates");
  if (!node) return;
  let time = (value) => value ? value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  const localStatus = replica?.local ? 'Offline · saved on this device' : '';
  node.textContent = `${syncState === 'syncing' ? 'Syncing…' : syncState === 'error' ? 'Sync needs attention' : localStatus || (hasUnsavedChanges() ? 'Unsaved changes' : lastSynced ? 'Up to date' : 'Not synced')}${replica?.pending ? ` · ${replica.pending} pending change${replica.pending === 1 ? '' : 's'}` : ''} · ${hasUnsavedChanges() ? 'Unsaved edit · ' : ''}Server sync ${time(lastSynced)}`;
  node.title = syncFailure || (installedApp ? 'Encrypted changes are saved on this device and synced while the app is open and connected.' : 'Web saves directly to the server. Unsaved edits have not been synced.');
  window.__vaultsSyncState = { unlocked: !!root, pending: replica?.pending || 0, offline: !!replica?.local, syncing: busy, error: syncFailure, at: replica?.state.snapshotAt || null };
  window.dispatchEvent(new CustomEvent('vaults:sync-state', { detail: window.__vaultsSyncState }));
};
const toast = (title, detail = "", type = "info") => {
  window.dispatchEvent(new CustomEvent("vaults:toast", { detail: { title, detail, kind: type } }));
};
const msg = (x, t = "info") => {
    if (root) {
      toast(t === "error" ? "Something went wrong" : t === "success" ? "Done" : "127Vaults", x, t);
      return;
    }
    let e = $("message");
    e.textContent = x;
    e.className = `notice ${t} my-5 rounded-xl border px-3.5 py-3 text-sm ${t === "error" ? "border-red-400/25 bg-red-400/10 text-red-200" : t === "success" ? "hidden border-[#E0BB95]/25 bg-[#E0BB95]/10 text-[#E0BB95]" : "hidden border-white/10 bg-white/5 text-slate-300"}`;
  },
  status = (id, x, t = "") => {
    let e = $(id);
    e.textContent = x;
    e.className = `inline-status text-xs ${t === "error" ? "text-red-300" : "text-slate-500"}`;
  },
  hash = (x) =>
    crypto.subtle.digest("SHA-512", x).then((v) => new Uint8Array(v)),
  sha256 = (x) =>
    crypto.subtle.digest("SHA-256", x).then((v) => new Uint8Array(v));
function equal(a, b) {
  if (a.length !== b.length) return false;
  let v = 0;
  for (let i = 0; i < a.length; i++) v |= a[i] ^ b[i];
  return v === 0;
}
async function remoteCall(path, { method = "GET", body, token = csrf } = {}) {
  if (installedApp && navigator.onLine === false) throw Error('SERVER_UNREACHABLE');
  let h = {};
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    h["X-127V-CSRF"] = token;
  }
  let r;
  try {
    r = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw Error(
      e.name === "TimeoutError" ? "SERVER_TIMEOUT" : "SERVER_UNREACHABLE",
    );
  }
  let v;
  try {
    v = await r.json();
  } catch {
    throw Error("INVALID_SERVER_RESPONSE");
  }
  if (!r.ok) { const error = Error(v.error === 'base_changed' ? 'BASE_CHANGED' : v.error ?? `HTTP_${r.status}`); error.status = r.status; throw error; }
  return v;
}
async function call(path, options = {}) {
  const method = options.method || 'GET';
  if (root && (replicaRead(path) || path.startsWith('/api/v1/vaults'))) checkLicense(method !== 'GET');
  if (!installedApp || !replica || !root) return remoteCall(path, options);
  if (method === 'GET' && replicaRead(path)) {
    if (replica.state.snapshotAt || replica.local || replica.pending) return replica.read(path);
    try { return await remoteCall(path, options); }
    catch (error) {
      if (!networkUnavailable(error) || !replica.state.snapshotAt) throw error;
      replica.local = true; updateSessionDates(); return replica.read(path);
    }
  }
  const writable = (path === '/api/v1/vault-settings' && method === 'PUT') || (path === '/api/v1/vaults' && method === 'POST') || (/^\/api\/v1\/vaults\/[0-9a-f-]+\/items(?:\/[0-9a-f-]+)?$/.test(path) && ['POST', 'PUT', 'DELETE'].includes(method));
  if (writable) {
    if (!replica.state.snapshotAt) {
      if (replica.local) throw Error('OFFLINE_DATA_UNAVAILABLE');
      return remoteCall(path, options);
    }
    const wasLocal = replica.local;
    const result = await replica.enqueue(path, method, options.body);
    if (!wasLocal && serverAuthenticated) {
      try { await replica.flush(remoteCall); }
      catch (error) {
        // Keep the durable local change even after a rejected/ambiguous send.
        syncFailure = networkUnavailable(error) ? '' : safeError(error);
        syncState = networkUnavailable(error) ? 'idle' : 'error';
      }
    }
    updateSessionDates(); return result;
  }
  if (replica.local) throw Error('ONLINE_REQUIRED');
  return remoteCall(path, options);
}
function reusableSecret(identityRecord) {
  return Boolean(identityRecord && (installedApp || identityRecord.secretExpiresAt === undefined || identityRecord.secretExpiresAt > Date.now()) && (identityRecord.secretEnvelope || identityRecord.accountSecret));
}
function credentials() {
  let secret = $("secret").value || (reusableSecret(identity) ? identity?.accountSecret : ""),
    master = $("master").value;
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
    status(
      "login-status",
      "This device is missing its local account credential. Register it again.",
      "error",
    );
    throw Error("INVALID_ACCOUNT_SECRET");
  }
  if ([...master].length < 20) {
    status(
      "login-status",
      "Master password must contain at least 20 characters.",
      "error",
    );
    $("master").focus();
    throw Error("INVALID_MASTER_PASSWORD");
  }
  return {
    secret: Uint8Array.from(secret.match(/../g), (v) => parseInt(v, 16)),
    password: te.encode(master),
  };
}
const safeError = (e) => e.name === 'QuotaExceededError' ? 'Device storage is full. Free storage and retry before closing the app.' : e.name === 'SecurityError' ? 'Device storage is unavailable. Use a regular browser profile with website storage enabled.' :
  ({
    INVALID_ACCOUNT_SECRET:
      "Account secret must be exactly 64 hexadecimal characters.",
    INVALID_MASTER_PASSWORD:
      "Master password must contain at least 20 characters.",
    rate_limited: "Too many attempts. Wait before retrying.",
    SERVER_TIMEOUT: "The server did not respond within 30 seconds.",
    SERVER_UNREACHABLE:
      "The server could not be reached. Check that the MVP stack is running.",
    INVALID_SERVER_RESPONSE: "The server returned an invalid response.",
    OFFLINE_DATA_UNAVAILABLE: "This device has no complete offline copy yet. Connect and sync first.",
    ONLINE_REQUIRED: "Connect to the server to perform this action.",
    LOCAL_STORAGE_FAILED: "Device storage could not save this change. Free space and retry before closing the app.",
    LOCAL_REPLICA_INVALID: "The encrypted local queue is invalid. It has been preserved; no queued requests were sent.",
    authentication_required: "Unlock with your master password to reconnect and sync. Local changes are preserved.",
    ENROLLMENT_EXPIRED: "This registration code expired. Close this dialog and register again.",
    ENROLLMENT_INVALID: "Device approval could not be verified. Start a new registration.",
    INVALID_USERNAME: "Enter your username (5–64 letters, digits, dots, hyphens, or underscores).",
    SYNC_REVIEW_PENDING: "Your offline changes are preserved. Choose Sync to finish reviewing the conflict.",
    LOCAL_QUEUE_CHANGED: "Another app window saved a change. Sync again to include it.",
    BASE_CHANGED: "This item changed on another device. Your queued edit is preserved. Choose Sync to review both versions.",
    VAULT_RETIRED: "This vault was removed on another device. Your offline changes are preserved for review.",
    SERVER_IDENTITY_CHANGED: "The server identity changed. Your local copy and pending changes are preserved; verify the server before registering again.",
    PENDING_REMOVAL: "Resume or cancel the pending vault removal before starting another.",
    REMOVAL_SOURCE_CHANGED: "The source vault changed. It remains available; cancel the pending move and start again after syncing.",
    REMOVAL_DESTINATION_CHANGED: "The destination copy changed. Both vaults remain available; review the copy before cancelling or restarting the move.",
    SYNC_ROLLBACK: "The server returned an older sync history. Your verified local copy is preserved.",
    SYNC_FORK: "The server sync history differs from this device’s verified copy. Your local changes are preserved.",
    INVALID_SYNC_HISTORY: "Sync signatures or the operation chain could not be verified. Your encrypted local copy and changes are preserved.",
    SYNC_DEVICE_KEY_CHANGED: "A registered device’s signing key changed unexpectedly. Sync stopped; your local changes are preserved.",
    SYNC_PAYLOAD_MISMATCH: "Downloaded vault records do not match their signed operation. Sync stopped; your local copy is preserved.",
    INVALID_SYNC_CHECKPOINT: "The server’s signed checkpoint could not be verified. Your local copy and changes are preserved.",
    SYNC_CHECKPOINT_KEY_CHANGED: "The server checkpoint signing key changed. Sync stopped; verify the server before proceeding.",
    onboarding_failed:
      "Setup was rejected. The code may be invalid, expired, or already used.",
    authentication_failed:
      "Unlock failed. Check the username, account secret, master password, and enrolled browser profile.",
  })[e.message] ??
  "The operation failed. Retry; if it repeats, record the stage shown here.";
async function ceremony() {
  let v = await call("/api/v1/ceremony");
  csrf = v.csrf;
}
function bindingParts(x) {
  let n = (x[0] << 8) | x[1],
    p = 2 + n,
    origin = td.decode(x.slice(2, p)),
    installation = uuid(x.slice(p, (p += 16))),
    account = uuid(x.slice(p, (p += 16))),
    device = uuid(x.slice(p, (p += 16))),
    epoch = Number(new DataView(x.buffer, x.byteOffset + p, 8).getBigUint64(0));
  return {
    origin,
    installation,
    account,
    device,
    epoch,
    attempt: x.slice(p + 8, p + 40),
    serverPublicKey: x.slice(p + 40, p + 72),
  };
}
function rootTemplate(tenant, account) {
  let x = new Uint8Array(77);
  x[0] = 1;
  x.set(id(tenant), 1);
  x.set(id(account), 17);
  x.set([0, 0, 0, 1], 65);
  x[76] = 1;
  return x;
}
async function loadVaultSettings() {
  const response = await call("/api/v1/vault-settings");
  settingsRevision = response.revision;
  vaultSettings = response.envelope
    ? JSON.parse(td.decode(core.decrypt_account_settings(root, un(response.envelope))))
    : { version: 1, names: {}, collections: [], default_view: null, removal_preference: null };
  if (vaultSettings.version !== 1 || typeof vaultSettings.names !== "object" || !vaultSettings.names) throw Error("INVALID_VAULT_SETTINGS");
  vaultSettings.collections ||= [];
  if (!Array.isArray(vaultSettings.collections) || vaultSettings.collections.some(row => typeof row.id !== 'string' || typeof row.name !== 'string' || !Array.isArray(row.vault_ids))) throw Error('INVALID_VAULT_SETTINGS');
  publishSettings();
}
function publishSettings() {
  window.__vaultsSettings = { settings: vaultSettings, view: browseView };
  window.dispatchEvent(new CustomEvent('vaults:settings', { detail: window.__vaultsSettings }));
}
async function publishVaultLifecycle(data) {
  const retired = data.vaultEnvelopes.filter(row => row.retired).map(row => ({ ...row, name: vaultSettings.names[row.vaultId] || 'Archived vault' }));
  const pending = identity && await loadIdentity(`vault-removal:${identity.deviceId}`);
  window.__vaultsLifecycle = { retired, pending };
  window.dispatchEvent(new CustomEvent('vaults:lifecycle', { detail: window.__vaultsLifecycle }));
}
async function manageVault(source, choice, destination = null) {
  if (!root || busy || !confirmDiscard()) return;
  if (replica?.local || navigator.onLine === false) { toast('Connection required', 'Vault removal and restoration require an online session, as in the desktop app.'); return; }
  const journalKey = `vault-removal:${identity.deviceId}`, pending = await loadIdentity(journalKey);
  if (!pending && choice !== 'restore' && !await confirmAction(choice === 'move' ? 'Move this vault’s items?' : 'Archive this vault?', choice === 'move' ? 'Items will be copied to the destination before the source vault is retired. The source remains recoverable.' : 'This hides the vault from active views and keeps its encrypted items recoverable.')) return;
  if (installedApp) { await syncInstalled(); if (!root || replica?.local || replica?.pending) return; }
  else await reload();
  setBusy(true);
  const generation = sessionGeneration, activeRoot = root;
  const check = () => { if (generation !== sessionGeneration || root !== activeRoot) throw Error('LOCKED'); };
  try {
    const client = new VaultLifecycleClient({ core, root: activeRoot, send: remoteCall, check,
      readJournal: () => loadIdentity(journalKey), writeJournal: async value => { check(); await saveIdentity(value, journalKey); },
      signItem: async (targetVault, itemId, catalogueBytes, indexBytes, bodyBytes) => signedMutation('item.create', itemId, catalogueBytes, indexBytes, bodyBytes, { targetVault, history: await operationHistory(targetVault) }),
      verifyCopy: (body, targetVault) => verifyPendingEntry({ path: `/api/v1/vaults/${targetVault}/items`, method: 'POST', body }) });
    if (choice === 'restore') await client.restore(source); else await client.remove(source, choice, destination);
    check(); clearItem(); browseView = null; await reload();
    toast(choice === 'restore' ? 'Vault restored' : choice === 'move' ? 'Vault moved' : 'Vault archived', 'Your encrypted vault data remains recoverable.', 'success');
  } catch (error) { if (generation === sessionGeneration) toast('Vault action needs attention', `${safeError(error)} Any pending operation can be resumed in Settings → Vaults.`, 'error'); }
  finally { if (generation === sessionGeneration) { try { await publishVaultLifecycle(await call('/api/v1/vaults')); } catch {} setBusy(false); } }
}
async function cancelVaultRemoval() {
  if (!root || busy || !await confirmAction('Cancel pending removal?', 'This stops retries. Copies already made and actions accepted by the server remain in place.')) return;
  await saveIdentity(null, `vault-removal:${identity.deviceId}`); await publishVaultLifecycle(await call('/api/v1/vaults'));
}
async function saveVaultSettings(next) {
  const encrypted = core.encrypt_account_settings(root, te.encode(JSON.stringify(next))), revision = uuid(encrypted.slice(76,92));
  await call('/api/v1/vault-settings', { method: 'PUT', body: { baseRevision: settingsRevision, revision, envelope: b64(encrypted) } });
  settingsRevision = revision; vaultSettings = next; publishSettings();
}
function publishVaults(rows) {
  window.__vaultsSnapshot = rows;
  window.dispatchEvent(new CustomEvent("vaults:vaults", { detail: rows }));
}
async function saveVaultName(vaultId, name) {
  const next = { ...vaultSettings, names: { ...vaultSettings.names, [vaultId]: name } };
  await saveVaultSettings(next);
}
async function db(mode = "readonly") {
  let d = await new Promise((ok, no) => {
    let q = indexedDB.open("127vaults-mvp", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("identity");
    q.onsuccess = () => ok(q.result);
    q.onerror = () => no(q.error);
  });
  return d.transaction("identity", mode).objectStore("identity");
}
async function loadIdentity(key = "active") {
  let s = await db();
  return new Promise((ok, no) => {
    let q = s.get(key);
    q.onsuccess = () => ok(q.result);
    q.onerror = () => no(q.error);
    s.transaction.oncomplete = () => s.transaction.db.close();
  });
}
async function saveIdentity(v, key = "active") {
  let s = await db("readwrite");
  return new Promise((ok, no) => {
    if (v === null) s.delete(key); else s.put(v, key);
    s.transaction.oncomplete = () => { s.transaction.db.close(); ok(); };
    s.transaction.onabort = s.transaction.onerror = () => { s.transaction.db.close(); no(s.transaction.error || Error('LOCAL_STORAGE_FAILED')); };
  });
}
let pendingBrowserEnrollment = null;
async function registerBrowserDevice() {
  if (busy || identity) return;
  setBusy(true);
  try {
    const username = $("username").value.trim();
    const saved = await loadIdentity('enrollment');
    pendingBrowserEnrollment = saved?.username === username && (saved.approval || Date.parse(saved.expiresAt) > Date.now())
      ? saved : await requestBrowserEnrollment(username, remoteCall);
    await saveIdentity(pendingBrowserEnrollment, 'enrollment');
    $("browser-enrollment-code").textContent = pendingBrowserEnrollment.code;
    $("browser-enrollment-status").textContent = 'Waiting for approval on your registered device. This code expires in 10 minutes.';
    $("browser-enrollment-dialog").showModal();
  } catch (error) { status('login-status', safeError(error), 'error'); }
  finally { setBusy(false); }
}
async function checkBrowserApproval() {
  if (busy) return;
  setBusy(true);
  try {
    const approved = await finishBrowserEnrollment(pendingBrowserEnrollment, remoteCall, async value => { await saveIdentity(value, 'enrollment'); pendingBrowserEnrollment = value; });
    if (!approved) { $("browser-enrollment-status").textContent = 'Still waiting. Approve the code on your registered device, then check again.'; return; }
    await saveIdentity(approved);
    await saveIdentity(null, 'enrollment');
    pendingBrowserEnrollment = null; identity = approved;
    $("browser-enrollment-dialog").close();
    $("register-browser-device").hidden = true;
    $("username").value = identity.username; $("device").value = identity.deviceId;
    showLoginPassword();
    status('login-status', 'Device registered. Enter your account secret and master password once to prepare this device.');
  } catch (error) { $("browser-enrollment-status").textContent = safeError(error); }
  finally { setBusy(false); }
}
async function protectAccountSecret(secret, password) {
  let salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12)),
    material = await crypto.subtle.importKey(
      "raw",
      te.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    ),
    key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 600000 },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    ),
    ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        te.encode(secret),
      ),
    );
  return { version: 1, iterations: 600000, salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext) };
}
async function recoverAccountSecret(envelope, password) {
  try {
    if (![310000, 600000].includes(envelope.iterations ?? 310000)) throw Error('authentication_failed');
    let material = await crypto.subtle.importKey(
        "raw",
        te.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"],
      ),
      key = await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: un(envelope.salt),
          iterations: envelope.iterations ?? 310000,
        },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
      );
    return td.decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: un(envelope.iv) },
        key,
        un(envelope.ciphertext),
      ),
    );
  } catch {
    throw Error("authentication_failed");
  }
}
async function generateIdentity() {
  let keys = await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
    "sign",
    "verify",
  ]);
  return {
    keys,
    publicRaw: new Uint8Array(
      await crypto.subtle.exportKey("raw", keys.publicKey),
    ),
  };
}
async function registrationSignature(candidate, record, key) {
  let parts = [
    te.encode("127Vaults/first-device-activation/1\0"),
    id(candidate.deviceId),
    un(candidate.signingPublicKey),
    await hash(record),
    await hash(un(candidate.wrappedRootDescriptor)),
    await hash(un(candidate.wrappedRootEnvelope)),
    await hash(un(candidate.privateDirectory)),
  ];
  return new Uint8Array(
    await crypto.subtle.sign("Ed25519", key, cat(...parts)),
  );
}
async function setup() {
  let stage = "validating setup fields";
  setBusy(true);
  status("setup-status", "Validating…");
  try {
    let token = $("bootstrap").value.trim(),
      username = $("registration-username").value.trim(),
      displayName = $("display").value.trim(),
      email = $("email").value.trim(),
      master = $("registration-master").value;
    if (master !== $("registration-master-confirm").value)
      throw Error("Master passwords do not match.");
    $("username").value = username;
    $("master").value = master;
    $("secret").value = generatedAccountSecret;
    if (!token) {
      $("bootstrap").focus();
      throw Error("Enter the one-time bootstrap code.");
    }
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{4,63}$/.test(username)) {
      $("registration-username").focus();
      throw Error(
        "Username must be 5–64 ASCII letters, digits, dots, hyphens, or underscores; start with a letter, digit, or underscore.",
      );
    }
    if (!displayName || !$("email").checkValidity()) {
      ($("email").checkValidity() ? $("display") : $("email")).focus();
      throw Error("Enter a display name and valid email address.");
    }
    let { secret, password } = credentials();
    stage = "starting secure registration";
    status("setup-status", "Registering this device…");
    await ceremony();
    let accountId = crypto.randomUUID(),
      deviceId = crypto.randomUUID(),
      generated = await generateIdentity(),
      start = ExperimentalOpaqueBridge.client_registration_start(
        secret,
        password,
      ),
      server = await call("/api/v1/onboarding/register", {
        method: "POST",
        body: { accountId, deviceId, request: b64(start.message()) },
      }),
      binding = un(server.binding),
      parts = bindingParts(binding),
      upload = ExperimentalOpaqueBridge.client_registration_finish(
        start.state(),
        secret,
        password,
        un(server.response),
        binding,
      ),
      made = core.create_root(
        rootTemplate(parts.installation, accountId),
        password,
        secret,
      ),
      directory = core.create_empty_directory(made),
      candidate = {
        accountId,
        deviceId,
        username,
        displayName,
        email,
        signingPublicKey: b64(generated.publicRaw),
        opaqueUpload: b64(upload),
        wrappedRootDescriptor: b64(made.context()),
        wrappedRootEnvelope: b64(made.envelope()),
        privateDirectory: b64(directory),
        registrationArtifact: server.registrationArtifact,
      };
    stage = "creating device activation proof";
    candidate.activationSignature = b64(
      await registrationSignature(candidate, upload, generated.keys.privateKey),
    );
    stage = "activating first owner";
    await call("/api/v1/onboarding/register", {
      method: "POST",
      body: { token, candidate },
    });
    stage = "saving this browser identity";
    let secretEnvelope = await protectAccountSecret(
      generatedAccountSecret,
      master,
    );
    await saveIdentity({
      accountId,
      deviceId,
      username: candidate.username,
      privateKey: generated.keys.privateKey,
      publicKey: b64(generated.publicRaw),
      secretEnvelope,
      secretExpiresAt: installedApp ? undefined : Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    identity = await loadIdentity();
    $("device").value = deviceId;
    $("bootstrap").value = "";
    $("master").value = "";
    core.lock();
    ownerSetupRequired = false;
    $("show-registration").hidden = true;
    $("registration-exit").hidden = false;
    showLogin();
    showLoginPassword();
    status(
      "login-status",
      "Account created. Enter your master password to log in.",
    );
    msg("Registration complete.", "success");
  } catch (e) {
    let detail =
      e.message.startsWith("Enter ") ||
      e.message.startsWith("Username ") ||
      e.message.startsWith("Master passwords")
        ? e.message
        : stage === "creating device activation proof"
          ? "This browser could not create the device activation proof. Reload once; if it repeats, use a current browser."
          : safeError(e);
    status("setup-status", `${stage}: ${detail}`, "error");
    msg(`Setup did not complete: ${detail}`, "error");
  } finally {
    setBusy(false);
  }
}
function secretBytes() {
  return credentials().secret;
}
async function verifyRootTag(
  sessionKey,
  binding,
  request,
  response,
  finalization,
  descriptor,
  envelope,
  tag,
) {
  let p = bindingParts(binding),
    context = cat(
      te.encode("127Vaults/login-context/1\0"),
      be(te.encode(p.origin).length, 2),
      te.encode(p.origin),
      id(p.installation),
      id(p.account),
      id(p.device),
      be(p.epoch, 8),
      p.attempt,
    ),
    contextHash = await hash(context),
    salt = await hash(
      cat(te.encode("127Vaults/session-salt/1\0"), contextHash),
    ),
    base = await crypto.subtle.importKey("raw", sessionKey, "HKDF", false, [
      "deriveKey",
    ]),
    key = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-512",
        salt,
        info: te.encode("127Vaults/root-tag-key/1"),
      },
      base,
      { name: "HMAC", hash: "SHA-512", length: 256 },
      false,
      ["sign"],
    ),
    transcript = await hash(cat(request, response, finalization)),
    deviceTranscript = await hash(cat(request, response)),
    data = cat(
      te.encode("127Vaults/root-response/1\0"),
      contextHash,
      transcript,
      be(descriptor.length, 2),
      descriptor,
      be(envelope.length, 4),
      envelope,
    ),
    actual = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  if (!equal(actual, tag)) throw Error("TAG");
  authContext = { tenantId: p.installation, epoch: p.epoch };
  return { p, contextHash, deviceTranscript };
}
async function authenticateOnline(secret, password) {
    const generation = sessionGeneration;
    let start, finish, nextRoot, delivered = false;
    try {
    start = ExperimentalOpaqueBridge.client_login_start(secret, password);
    let
      request = start.message(),
      begun = await remoteCall("/api/v1/auth/", {
        method: "POST",
        body: {
          username: identity.username,
          deviceId: identity.deviceId,
          request: b64(request),
        },
      });
    if (generation !== sessionGeneration) throw Error("LOCKED");
    csrf = begun.csrf;
    let binding = un(begun.binding),
      challenge = un(begun.challenge),
      finishStep = ExperimentalOpaqueBridge.client_login_finish(
        start.state(),
        secret,
        password,
        challenge,
        binding,
      ),
      finalization = finishStep.message();
    finish = finishStep;
    let wrapped = await remoteCall(`/api/v1/auth/${begun.attemptId}/password`, {
        method: "POST",
        body: { finalization: b64(finalization) },
      }),
      descriptor = un(wrapped.descriptor),
      envelope = un(wrapped.envelope);
    if (generation !== sessionGeneration) throw Error("LOCKED");
    const sessionKey = finish.session_key();
    let verified;
    try { verified = await verifyRootTag(
        sessionKey,
        binding,
        request,
        challenge,
        finalization,
        descriptor,
        envelope,
        un(wrapped.tag),
      ); } finally { sessionKey.fill(0); }
    if (generation !== sessionGeneration) throw Error("LOCKED");
    if (verified.p.origin !== location.origin || verified.p.device !== identity.deviceId || verified.p.account !== identity.accountId
      || (identity.installationId && identity.installationId !== verified.p.installation)
      || (identity.serverPublicKey && identity.serverPublicKey !== b64(verified.p.serverPublicKey))) throw Error('SERVER_IDENTITY_CHANGED');
    nextRoot = core.unwrap_root(envelope, descriptor, password, secret);
    let rootHash = await hash(cat(descriptor, envelope)),
      proof = cat(
        te.encode("127Vaults/device-proof/1\0"),
        verified.contextHash,
        verified.deviceTranscript,
        id(verified.p.installation),
        id(verified.p.account),
        id(verified.p.device),
        be(verified.p.epoch, 8),
        rootHash,
      ),
      signature = new Uint8Array(
        await crypto.subtle.sign("Ed25519", identity.privateKey, proof),
      );
    let logged = await remoteCall(`/api/v1/auth/${begun.attemptId}/device-proof`, {
      method: "POST",
      body: { signature: b64(signature) },
    });
    if (generation !== sessionGeneration) throw Error("LOCKED");
    csrf = logged.csrf;
    serverAuthenticated = true;
    identity = { ...identity, installationId: verified.p.installation, serverPublicKey: b64(verified.p.serverPublicKey) };
    delivered = true;
    return { root: nextRoot, unlock: { descriptor: wrapped.descriptor, envelope: wrapped.envelope, authContext, origin: location.origin, deviceId: identity.deviceId, accountId: identity.accountId } };
    } finally {
      start?.free?.(); finish?.free?.();
      if (nextRoot && !delivered) { if (generation === sessionGeneration) core.release_root(nextRoot); nextRoot.free?.(); }
    }
}
let licenseEntitlement = null;
function checkLicense(write = false) {
  return requireEntitlement(licenseEntitlement, { origin: location.origin, device: identity?.deviceId, installation: identity?.installationId, write });
}
async function refreshEntitlement() {
  const generation = sessionGeneration, activeRoot = root, activeReplica = replica;
  if (!activeRoot) throw Error('LOCKED');
  const status = await remoteCall('/api/v1/license');
  if (generation !== sessionGeneration || root !== activeRoot) throw Error('LOCKED');
  const next = { kind: 'license-entitlement-v1', origin: location.origin, device: identity.deviceId, installation: identity.installationId,
    observedAt: Math.max(Date.now(), licenseEntitlement?.observedAt || 0), status };
  licenseEntitlement = next;
  if (activeReplica) await activeReplica.saveLicense(b64(core.encrypt_account_settings(activeRoot, te.encode(JSON.stringify(next)))));
  if (generation !== sessionGeneration || root !== activeRoot) throw Error('LOCKED');
  return checkLicense();
}
let stopLicenseStatus = () => {};
function monitorLicenseStatus() {
  stopLicenseStatus();
  const generation = sessionGeneration;
  let disposed = false, refreshing = false;
  const refresh = async () => {
    if (disposed || refreshing || !root || $("vault").hidden) return;
    refreshing = true;
    try {
      const license = serverAuthenticated ? await refreshEntitlement() : checkLicense();
      if (!disposed && generation === sessionGeneration && serverAuthenticated && !$("vault").hidden) {
        if (!['active', 'read-only'].includes(license.mode)) { await lock(); $("state").textContent = 'A valid license or trial is required. Ask your operator for a replacement license.'; return; }
        const guidance = license.mode === 'read-only' ? 'Expired: vault and invitation writes are blocked during the 30-day read-only period.'
          : license.mode === 'revoked' ? 'Revoked: server writes are blocked. Ask the operator for a replacement license.'
            : license.mode === 'locked' ? 'Locked: server writes are blocked. Check expiry and the server clock.'
              : license.mode === 'active' ? `Active${license.expiresAt ? ` until ${license.expiresAt.slice(0, 10)}` : ''}.`
                : 'A valid license is required.';
        $("state").textContent = `Unlocked · ${guidance}`;
      }
    } catch (error) {
      if (!disposed && generation === sessionGeneration) {
        try { if (!networkUnavailable(error)) throw error; checkLicense(); }
        catch (failure) { await lock(); $("state").textContent = failure.message; }
      }
    }
    finally { refreshing = false; }
  };
  const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
  window.addEventListener('focus', refresh);
  stopLicenseStatus = () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  void refresh();
}
async function login() {
  const generation = ++sessionGeneration;
  let loginCredentials;
  let stage = "checking this browser";
  setBusy(true);
  status("login-status", "Checking enrolled device…");
  try {
    identity = await loadIdentity();
    if (!identity)
      throw Error(
        "This device is not registered. Use the registration link below.",
      );
    if (identity.username !== $("username").value.trim())
      throw Error(
        "The username does not match this device’s registered identity.",
      );
    if (identity.secretEnvelope && reusableSecret(identity))
      $("secret").value = await recoverAccountSecret(
        identity.secretEnvelope,
        $("master").value,
      );
    let { secret, password } = credentials();
    loginCredentials = { secret, password };
    stage = "verifying account credentials";
    status("login-status", "Verifying credentials…");
    if (installedApp) {
      replica = await new PwaReplica({ scope: identity.deviceId, changed: replicaChanged, validateEntry: verifyPendingEntry }).load();
      replicaChanged();
      reconnectCredentials = { secret: secret.slice(), password: password.slice() };
    }
    try {
      const authenticated = await authenticateOnline(secret, password);
      if (generation !== sessionGeneration) throw Error('LOCKED');
      root = authenticated.root;
      await refreshEntitlement();
      if (replica) {
        await replica.saveUnlock(authenticated.unlock);
        if (replica.pending) {
          try { await replica.flush(remoteCall); }
          catch (error) { replica.local = true; syncState = 'error'; syncFailure = safeError(error); }
        }
      }
    } catch (error) {
      if (!replica || !networkUnavailable(error) || !replica.state.unlock || !replica.state.snapshotAt) throw error;
      if (replica.state.unlock.origin !== location.origin || replica.state.unlock.deviceId !== identity.deviceId || replica.state.unlock.accountId !== identity.accountId) throw Error('SERVER_IDENTITY_CHANGED');
      if (root) { core.release_root(root); root.free?.(); root = null; }
      root = core.unwrap_root(un(replica.state.unlock.envelope), un(replica.state.unlock.descriptor), password, secret);
      licenseEntitlement = JSON.parse(td.decode(core.decrypt_account_settings(root, un(replica.state.licenseEnvelope || ""))));
      checkLicense();
      authContext = replica.state.unlock.authContext;
      replica.local = true; serverAuthenticated = false;
      lastSynced = new Date(replica.state.snapshotAt);
    }
    if (replica?.state.snapshotAt) await verifyOfflineHistory();
    secret.fill(0); password.fill(0);
    const verificationSalt = crypto.getRandomValues(new Uint8Array(32));
    passkeyVerifier = { salt: verificationSalt, value: await passwordCheckBytes($("master").value, verificationSalt) };
    await reload();
    if (installedApp || !identity.secretExpiresAt || !reusableSecret(identity) || identity.accountSecret) {
      try {
        const nextIdentity = { ...identity, secretEnvelope: await protectAccountSecret($("secret").value || identity.accountSecret, $("master").value), secretExpiresAt: installedApp ? undefined : Date.now() + 30 * 24 * 60 * 60 * 1000 };
        delete nextIdentity.accountSecret;
        await saveIdentity(nextIdentity);
        identity = nextIdentity;
      } catch { toast("Remember this device needs attention", "The account secret could not be saved securely. Enter it again next time.", "error"); }
    }
    wipeInputs();
    $("entry-shell").hidden = true;
    $("vault").hidden = false;
    $("lock").disabled = false;
    $("state").textContent = "Unlocked";
    monitorLicenseStatus();
    arm();
    applyDefaultView = true;
    if (vaultSettings.default_view?.kind === 'all') await selectBrowseView({ kind: 'all' });
    else if (vaultSettings.default_view?.kind === 'collection') await selectBrowseView({ kind: 'collection', id: vaultSettings.default_view.id });
    else if (vaultSettings.default_view?.kind === 'vault') await selectVault(vaultSettings.default_view.id);
    applyDefaultView = false;
    if (!replica?.local) { await reloadDevices(); await reloadOwnershipRequests(); }
    queueMicrotask(openPendingDesktopEnrollment);
  } catch (e) {
    await lock(false);
    let detail =
      e.message.startsWith("This device ") ||
      e.message.startsWith("The username ")
        ? e.message
        : safeError(e);
    status("login-status", `${stage}: ${detail}`, "error");
    msg(`Login did not complete: ${detail}`, "error");
  } finally {
    loginCredentials?.secret.fill(0); loginCredentials?.password.fill(0);
    setBusy(false);
  }
}
async function operationHistory(targetVault, send = remoteCall) {
  let cursor = 0, operations = [], devicePublicKeys = {};
  const generation = sessionGeneration, context = authContext;
  for (;;) {
    const page = await send(`/api/v1/vaults/${targetVault}/operations?cursor=${cursor}&limit=500`);
    if (generation !== sessionGeneration || !context) throw Error('LOCKED');
    if (!Array.isArray(page.operations) || !Number.isSafeInteger(page.cursor) || page.cursor < cursor
      || typeof page.hasMore !== 'boolean') throw Error('INVALID_SYNC_HISTORY');
    for (const [device, key] of Object.entries(page.devicePublicKeys || {})) {
      if (devicePublicKeys[device] && devicePublicKeys[device] !== key) throw Error('SYNC_DEVICE_KEY_CHANGED');
    }
    operations.push(...page.operations);
    Object.assign(devicePublicKeys, page.devicePublicKeys || {});
    if (!page.hasMore) {
      // Version-one local queues omitted projected cursors. Full history makes
      // their positions unambiguous; never repair cursors received remotely.
      if (send === call && replica?.state.snapshotAt) operations = operations.map((row, index) => ({ ...row, cursor: row.cursor ?? index + 1 }));
      const knownKeys = Object.assign({}, ...Object.entries(replica?.state.records || {}).filter(([path]) => path.endsWith('/operations')).map(([, history]) => history.devicePublicKeys || {}));
      if (identity.publicKey) knownKeys[identity.deviceId] = identity.publicKey;
      const result = await verifySyncHistory({ cursor: page.cursor, operations, devicePublicKeys, hasMore: false }, {
        tenantId: context.tenantId, vaultId: targetVault, knownKeys, ownDeviceId: identity.deviceId, ownPrivateKey: identity.privateKey,
      });
      if (generation !== sessionGeneration) throw Error('LOCKED');
      return result;
    }
    if (page.cursor <= cursor) throw Error('INVALID_SERVER_RESPONSE');
    cursor = page.cursor;
  }
}
async function verifyOfflineHistory() {
  const activeReplica = replica, generation = sessionGeneration;
  for (const row of activeReplica.state.records['/api/v1/vaults'].vaultEnvelopes) {
    const listed = activeReplica.read(`/api/v1/vaults/${row.vaultId}/items`);
    const handle = core.open_private_vault(root, un(activeReplica.state.records['/api/v1/vaults'].directory), id(row.vaultId), un(row.envelope));
    try { verifyListedCatalogue(handle, listed); } finally { core.release_vault(handle); handle.free?.(); }
    const history = await operationHistory(row.vaultId, call), latest = history.operations.at(-1)?.operation;
    if (generation !== sessionGeneration || replica !== activeReplica) throw Error('LOCKED');
    const checkpoints = activeReplica.state.records[`/api/v1/vaults/${row.vaultId}/checkpoint`];
    if (checkpoints) await verifyCheckpoints(checkpoints.checkpoints, history, { tenantId: authContext.tenantId, vaultId: row.vaultId, publicKey: checkpoints.checkpointPublicKey });
    if (latest?.kind === 'item.delete') {
      await verifyLatestPayload(history, listed.catalogue);
    } else if (latest) {
      const path = `/api/v1/vaults/${row.vaultId}/items`, listed = activeReplica.read(path);
      const index = listed.indices.find(item => item.itemId === latest.itemId);
      if (!index) throw Error('SYNC_PAYLOAD_MISMATCH');
      await verifyLatestPayload(history, listed.catalogue, index.envelope, activeReplica.read(`${path}/${latest.itemId}`).envelope);
    }
  }
}
async function verifyPendingEntry(entry) {
  const generation = sessionGeneration, activeRoot = root;
  if (!activeRoot) throw Error('LOCKED');
  if (entry.path === '/api/v1/vault-settings') core.decrypt_account_settings(activeRoot, un(entry.body.envelope));
  else if (entry.path === '/api/v1/vaults') {
    const created = un(entry.body.vaultEnvelope), vaultId = created.slice(44, 60);
    const handle = core.open_private_vault(activeRoot, un(entry.body.directory), vaultId, created);
    try { verifyListedCatalogue(handle, { catalogue: entry.body.catalogue, indices: [] }); } finally { core.release_vault(handle); handle.free?.(); }
  } else await verifyQueuedOperation(entry, { tenantId: authContext.tenantId, deviceId: identity.deviceId, privateKey: identity.privateKey });
  if (generation !== sessionGeneration || root !== activeRoot) throw Error('LOCKED');
}
async function downloadCheckpoints(vaultId, history) {
  const saved = replica?.state.records[`/api/v1/vaults/${vaultId}/checkpoint`];
  const checkpoints = structuredClone(saved?.checkpoints || []);
  let publicKey = saved?.checkpointPublicKey || null;
  for (;;) {
    const after = checkpoints.length ? `&after=${await checkpointHash(checkpoints.at(-1))}` : '';
    const page = await remoteCall(`/api/v1/vaults/${vaultId}/checkpoint?history=1&limit=500${after}`);
    if (!Array.isArray(page.checkpoints) || typeof page.hasMore !== 'boolean' || (page.hasMore && !page.checkpoints.length)) throw Error('INVALID_SYNC_CHECKPOINT');
    if (publicKey && publicKey !== page.checkpointPublicKey) throw Error('SYNC_CHECKPOINT_KEY_CHANGED');
    publicKey = page.checkpointPublicKey;
    if (page.checkpoints.some(checkpoint => checkpoint.cursor > history.cursor)) throw Error('BASE_CHANGED');
    checkpoints.push(...page.checkpoints);
    if (!page.hasMore) break;
  }
  await verifyCheckpoints(checkpoints, history, { tenantId: authContext.tenantId, vaultId, publicKey, pinnedKey: saved?.checkpointPublicKey });
  return { checkpoints, checkpointPublicKey: publicKey };
}
async function downloadReplica() {
  const activeRoot = root, generation = sessionGeneration;
  const records = {};
  records['/api/v1/vault-settings'] = await remoteCall('/api/v1/vault-settings');
  if (records['/api/v1/vault-settings'].envelope) core.decrypt_account_settings(activeRoot, un(records['/api/v1/vault-settings'].envelope));
  const data = await remoteCall('/api/v1/vaults');
  records['/api/v1/vaults'] = data;
  for (const row of data.vaultEnvelopes) {
    if (generation !== sessionGeneration || root !== activeRoot) throw Error('LOCKED');
    const localVault = core.open_private_vault(activeRoot, un(data.directory), id(row.vaultId), un(row.envelope));
    try {
      const listPath = `/api/v1/vaults/${row.vaultId}/items`, listed = await remoteCall(listPath);
      records[listPath] = listed;
      verifyListedCatalogue(localVault, listed);
      const localCatalogue = un(listed.catalogue), revision = recordRevision(listed.catalogue, 44);
      for (const summary of listed.indices) {
        core.decrypt_private_part(localVault, localCatalogue, id(summary.itemId), un(summary.envelope), 4);
        const body = await remoteCall(`${listPath}/${summary.itemId}?catalogueRevision=${revision}`);
        core.decrypt_private_part(localVault, localCatalogue, id(summary.itemId), un(body.envelope), 3);
        records[`${listPath}/${summary.itemId}`] = body;
      }
      const operations = await operationHistory(row.vaultId);
      // Check the catalogue again before comparing the signed payload; a
      // concurrent save is a retryable torn snapshot, not signature corruption.
      if ((await remoteCall(listPath)).catalogue !== listed.catalogue) throw Error('BASE_CHANGED');
      const latest = operations.operations.at(-1)?.operation;
      if (latest?.kind === 'item.delete') {
        await verifyLatestPayload(operations, listed.catalogue);
      } else if (latest) {
        const latestIndex = listed.indices.find(summary => summary.itemId === latest.itemId);
        if (!latestIndex) throw Error('SYNC_PAYLOAD_MISMATCH');
        await verifyLatestPayload(operations, listed.catalogue, latestIndex.envelope, records[`${listPath}/${latest.itemId}`].envelope);
      }
      // Fetch after bodies/history to reject a torn catalogue snapshot.
      if ((await remoteCall(listPath)).catalogue !== listed.catalogue) throw Error('BASE_CHANGED');
      records[`/api/v1/vaults/${row.vaultId}/operations`] = operations;
      records[`/api/v1/vaults/${row.vaultId}/checkpoint`] = await downloadCheckpoints(row.vaultId, operations);
    } finally { if (generation === sessionGeneration) core.release_vault(localVault); localVault.free?.(); }
  }
  if (generation !== sessionGeneration || root !== activeRoot) throw Error('LOCKED');
  if (JSON.stringify(await remoteCall('/api/v1/vaults')) !== JSON.stringify(data)) throw Error('BASE_CHANGED');
  if ((await remoteCall('/api/v1/vault-settings')).revision !== records['/api/v1/vault-settings'].revision) throw Error('BASE_CHANGED');
  return records;
}
function verifyListedCatalogue(handle, listed) {
  const authenticated = core.verify_private_catalogue(handle, un(listed.catalogue)), expected = [];
  for (let offset = 0; offset < authenticated.length; offset += 16) expected.push(uuid(authenticated.slice(offset, offset + 16)));
  if (!Array.isArray(listed.indices) || JSON.stringify(expected.sort()) !== JSON.stringify(listed.indices.map(row => row.itemId).sort())) throw Error('SYNC_PAYLOAD_MISMATCH');
}
async function refreshReplica() {
  if (!replica || replica.local || replica.pending || snapshotBusy) return;
  snapshotBusy = true;
  const activeReplica = replica;
  try {
    let records;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { records = await downloadReplica(); break; }
      catch (error) { if (error.message !== 'BASE_CHANGED' || attempt === 2) throw error; }
    }
    if (replica !== activeReplica || !root) throw Error('LOCKED');
    await activeReplica.snapshot(records);
    window.dispatchEvent(new CustomEvent('vaults:pwa-status', { detail: { ready: true, at: activeReplica.state.snapshotAt } }));
  } catch (error) {
    if (error.message === 'LOCKED') return;
    if (activeReplica.state.snapshotAt && networkUnavailable(error)) { activeReplica.local = true; updateSessionDates(); return; }
    toast('Offline copy needs attention', `${safeError(error)} Your previous copy and pending changes are preserved.`, 'error');
    throw error;
  } finally { snapshotBusy = false; }
}
const stable = value => JSON.stringify(value, function (_key, entry) {
  return entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry;
});
function chooseSyncVersion(title, detail, destinations = null) {
  return new Promise(resolve => {
    const dialog = $('sync-review-dialog');
    $('sync-review-title').textContent = title; $('sync-review-detail').textContent = detail;
    const destination = $('sync-review-destination');
    destination.hidden = !destinations;
    destination.replaceChildren(...(destinations || []).map(row => new Option(row.name, row.vaultId)));
    $('sync-review-mine').textContent = destinations ? 'Recover items into this vault' : 'Keep my offline changes';
    $('sync-review-mine').disabled = !!destinations && !destinations.length;
    $('sync-review-server').textContent = destinations ? 'Discard these offline edits' : 'Use server version';
    const onLock = () => finish('cancel');
    const finish = choice => { window.removeEventListener('vaults:locked', onLock); dialog.close(); resolve(choice); };
    window.addEventListener('vaults:locked', onLock, { once: true });
    $('sync-review-mine').onclick = () => finish(destinations ? destination.value : 'mine');
    $('sync-review-server').onclick = () => finish('server');
    $('sync-review-later').onclick = () => finish('cancel');
    dialog.oncancel = event => { event.preventDefault(); finish('cancel'); };
    dialog.showModal();
  });
}
async function rebasePendingChanges(interactive) {
  const activeReplica = replica, activeRoot = root, generation = sessionGeneration;
  const oldState = structuredClone(activeReplica.state), expected = oldState.queue, recoveryTargets = new Map();
  const records = await downloadReplica(), fresh = structuredClone(records), planned = [];
  activeReplica.validateRemote(records);
  const check = () => { if (root !== activeRoot || replica !== activeReplica || generation !== sessionGeneration) throw Error('LOCKED'); };
  const decodeSettings = value => value?.envelope ? JSON.parse(td.decode(core.decrypt_account_settings(activeRoot, un(value.envelope)))) : { version: 1, names: {}, collections: [], default_view: null, removal_preference: null };
  for (const entry of collapseQueue(expected)) {
    check();
    let next = { ...entry, id: crypto.randomUUID(), body: structuredClone(entry.body) };
    if (entry.path === '/api/v1/vaults') {
      const addedId = uuid(un(entry.body.vaultEnvelope).slice(44, 60));
      const existing = fresh[entry.path].vaultEnvelopes.find(row => row.vaultId === addedId);
      if (existing && !existing.retired && existing.envelope === entry.body.vaultEnvelope) continue;
      if (existing) throw Error('VAULT_RETIRED');
      next.body.requestId = crypto.randomUUID();
      next.body.baseDirectoryRevision = recordRevision(fresh[entry.path].directory, 36);
      next.body.directory = b64(core.rebase_private_vault(activeRoot, un(fresh[entry.path].directory), un(entry.body.vaultEnvelope)));
    } else if (entry.path === '/api/v1/vault-settings') {
      const base = decodeSettings(entry.baseline), local = decodeSettings(entry.body), server = decodeSettings(fresh[entry.path]);
      const merged = structuredClone(server);
      merged.names = { ...server.names };
      for (const name of new Set([...Object.keys(base.names || {}), ...Object.keys(local.names || {})])) {
        if (base.names?.[name] === local.names?.[name]) continue;
        let useMine = true;
        if (server.names?.[name] !== base.names?.[name] && server.names?.[name] !== local.names?.[name]) {
          if (!interactive) throw Error('SYNC_REVIEW_PENDING');
          const choice = await chooseSyncVersion('Vault name changed', `Your offline name is “${local.names?.[name] || 'Unnamed'}”. The server name is “${server.names?.[name] || 'Unnamed'}”.`);
          check(); if (choice === 'cancel') throw Error('SYNC_REVIEW_PENDING'); useMine = choice === 'mine';
        }
        if (useMine) { if (name in (local.names || {})) merged.names[name] = local.names[name]; else delete merged.names[name]; }
      }
      for (const key of ['collections', 'default_view', 'removal_preference']) {
        if (stable(base[key]) === stable(local[key])) continue;
        if (stable(server[key]) !== stable(base[key]) && stable(server[key]) !== stable(local[key])) {
          if (!interactive) throw Error('SYNC_REVIEW_PENDING');
          const choice = await chooseSyncVersion('Vault preferences changed', 'Your offline preferences and the server preferences both changed. Choose which to keep.');
          check(); if (choice === 'cancel') throw Error('SYNC_REVIEW_PENDING'); if (choice === 'server') continue;
        }
        merged[key] = local[key];
      }
      if (stable(merged) === stable(server)) continue;
      const envelope = core.encrypt_account_settings(activeRoot, te.encode(JSON.stringify(merged)));
      next.body = { baseRevision: fresh[entry.path].revision, revision: uuid(envelope.slice(76,92)), envelope: b64(envelope) };
      next.baseline = structuredClone(fresh[entry.path]);
    } else {
      const sourceId = entry.body.signedOperation.vaultId, itemId = entry.body.signedOperation.itemId;
      let targetVault = sourceId, recovering = false;
      const sourceRow = oldState.records['/api/v1/vaults'].vaultEnvelopes.find(row => row.vaultId === sourceId);
      if (entry.method === 'DELETE' && !fresh['/api/v1/vaults'].vaultEnvelopes.some(row => row.vaultId === sourceId && !row.retired)) {
        if (!interactive) throw Error('SYNC_REVIEW_PENDING');
        const choice = await chooseSyncVersion('Queued deletion belongs to a removed vault', 'This deletion cannot be applied to a removed vault. Use server version to discard this deletion, or review later to preserve it.');
        check(); if (choice === 'server') continue;
        throw Error('SYNC_REVIEW_PENDING');
      }
      if (!fresh['/api/v1/vaults'].vaultEnvelopes.some(row => row.vaultId === sourceId && !row.retired)) {
        if (!interactive) throw Error('SYNC_REVIEW_PENDING');
        if (!recoveryTargets.has(sourceId)) {
          const destinations = fresh['/api/v1/vaults'].vaultEnvelopes.filter(row => !row.retired).map((row, index) => ({ vaultId: row.vaultId, name: decodeSettings(fresh['/api/v1/vault-settings']).names?.[row.vaultId] || `Vault ${index + 1}` }));
          const choice = await chooseSyncVersion('This vault was removed on another device', 'Recover the saved offline items as new items in an active vault, or explicitly discard these edits. Review later keeps the encrypted queue unchanged.', destinations);
          check(); if (choice === 'cancel') throw Error('SYNC_REVIEW_PENDING'); recoveryTargets.set(sourceId, choice);
        }
        targetVault = recoveryTargets.get(sourceId);
        if (targetVault === 'server') continue;
        recovering = true;
      }
      const listPath = `/api/v1/vaults/${targetVault}/items`;
      const targetRow = fresh['/api/v1/vaults'].vaultEnvelopes.find(row => row.vaultId === targetVault && !row.retired);
      if (!sourceRow || !targetRow) throw Error('VAULT_RETIRED');
      const sourceVault = core.open_private_vault(activeRoot, un(oldState.records['/api/v1/vaults'].directory), id(sourceId), un(sourceRow.envelope));
      const targetHandle = core.open_private_vault(activeRoot, un(fresh['/api/v1/vaults'].directory), id(targetVault), un(targetRow.envelope));
      try {
        const decode = (handle, catalogue, indexEnvelope, bodyEnvelope) => ({ itemId,
          index: JSON.parse(td.decode(core.decrypt_private_part(handle, un(catalogue), id(itemId), un(indexEnvelope), 4))),
          body: JSON.parse(td.decode(core.decrypt_private_part(handle, un(catalogue), id(itemId), un(bodyEnvelope), 3))) });
        if (entry.method === 'DELETE') {
          const listed = fresh[listPath], summary = listed.indices.find(row => row.itemId === itemId);
          if (!summary) continue; // Verified server state already has no such item.
          const server = decode(targetHandle, listed.catalogue, summary.envelope, fresh[`${listPath}/${itemId}`].envelope);
          const base = entry.baseline?.index && entry.baseline?.body
            ? decode(sourceVault, entry.baseline.catalogue, entry.baseline.index, entry.baseline.body) : null;
          if (stable(base) !== stable(server)) {
            if (!interactive) throw Error('SYNC_REVIEW_PENDING');
            const choice = await chooseSyncVersion('Delete an item changed on another device?', `Your queued deletion targets “${server.index.title || 'Untitled item'}”. Keep my offline changes deletes the current server version, including its passwords and passkeys. Use server version discards this deletion.`);
            check(); if (choice === 'server') continue;
            if (choice !== 'mine') throw Error('SYNC_REVIEW_PENDING');
          }
          const deleted = core.delete_private_item(targetHandle, un(listed.catalogue), id(itemId));
          const signedOperation = await signedMutation('item.delete', itemId, deleted, undefined, undefined,
            { targetVault, history: fresh[`/api/v1/vaults/${targetVault}/operations`] });
          check();
          next.path = `${listPath}/${itemId}`; next.method = 'DELETE';
          next.baseline = { catalogue: listed.catalogue, index: summary.envelope, body: fresh[`${listPath}/${itemId}`].envelope };
          next.body = { requestId: crypto.randomUUID(), baseCatalogueRevision: recordRevision(listed.catalogue,44), catalogue: b64(deleted), signedOperation };
          activeReplica.project(fresh, next); planned.push(next);
          continue;
        }
        let local = decode(sourceVault, entry.body.catalogue, entry.body.index, entry.body.body);
        const base = !recovering && entry.baseline?.index && entry.baseline?.body ? decode(sourceVault, entry.baseline.catalogue, entry.baseline.index, entry.baseline.body) : null;
        const listed = fresh[listPath], summary = !recovering && listed.indices.find(row => row.itemId === itemId);
        const server = summary ? decode(targetHandle, listed.catalogue, summary.envelope, fresh[`${listPath}/${itemId}`].envelope) : null;
        if (stable(local) === stable(server)) continue;
        if (stable(base) !== stable(server)) {
          if (!interactive) throw Error('SYNC_REVIEW_PENDING');
          const choice = await resolveConflict(local, server);
          check();
          if (choice === 'server') continue;
          if (choice?.kind === 'merge') local = choice.item;
          else if (choice !== 'mine') throw Error('SYNC_REVIEW_PENDING');
        }
        const made = !recovering && !server && !base
          ? core.create_private_item_at_id(targetHandle, un(listed.catalogue), id(itemId), te.encode(JSON.stringify(local.index)), te.encode(JSON.stringify(local.body)))
          : core.upsert_private_item(targetHandle, un(listed.catalogue), server ? id(itemId) : undefined, te.encode(JSON.stringify(local.index)), te.encode(JSON.stringify(local.body)));
        const newId = uuid(made.item());
        const signedOperation = await signedMutation(server ? 'item.update' : 'item.create', newId, made.catalogue(), made.index(), made.body(), { targetVault, history: fresh[`/api/v1/vaults/${targetVault}/operations`] });
        check();
        next.path = `${listPath}${server ? `/${itemId}` : ''}`; next.method = server ? 'PUT' : 'POST';
        next.baseline = { catalogue: listed.catalogue, index: summary?.envelope || null, body: server ? fresh[`${listPath}/${itemId}`].envelope : null };
        next.body = { requestId: crypto.randomUUID(), baseCatalogueRevision: recordRevision(listed.catalogue, 44), catalogue: b64(made.catalogue()), index: b64(made.index()), body: b64(made.body()), ...(server ? {} : { itemId: newId }), signedOperation };
        made.free?.();
      } finally {
        if (generation === sessionGeneration) { core.release_vault(sourceVault); core.release_vault(targetHandle); }
        sourceVault.free?.(); targetHandle.free?.();
      }
    }
    activeReplica.project(fresh, next); planned.push(next);
  }
  check();
  await activeReplica.replaceQueue(records, planned, expected);
}
async function syncInstalled({ interactive = true } = {}) {
  if (!installedApp) { await reload(); return; }
  if (!root || busy || hasUnsavedChanges()) {
    if (interactive && hasUnsavedChanges()) toast('Finish editing before syncing', 'Save or cancel your edit, then Sync.');
    return;
  }
  const generation = sessionGeneration, activeReplica = replica;
  setBusy(true); syncState = 'syncing'; syncFailure = ''; updateSessionDates();
  try {
    const credentials = reconnectCredentials;
    if (!credentials) throw Error('authentication_required');
    const authenticated = await authenticateOnline(credentials.secret, credentials.password);
    if (generation !== sessionGeneration || replica !== activeReplica) throw Error('LOCKED');
    if (vault) { core.release_vault(vault); vault.free?.(); vault = null; }
    core.release_root(root); root.free?.(); root = authenticated.root;
    await refreshEntitlement();
    await activeReplica.saveUnlock(authenticated.unlock);
    try { await activeReplica.flush(remoteCall); }
    catch (error) {
      if (error.status !== 409 || !['BASE_CHANGED', 'sync_conflict', 'device_fork', 'VAULT_RETIRED'].includes(error.message)) throw error;
      await rebasePendingChanges(interactive);
      await activeReplica.flush(remoteCall);
    }
    if (generation !== sessionGeneration) throw Error('LOCKED');
    activeReplica.local = false;
    await reload({ preserveDraft: true });
    if (activeReplica.local) throw Error('SERVER_UNREACHABLE');
    if (currentItem) { const summary = loadedItems.find(row => row.row.itemId === currentItem.itemId); if (summary) displayItem(await fetchItem(summary.row.itemId, summary.index)); else clearItem(); }
    if (interactive) toast('Sync complete', 'Your saved changes and latest server data are synced.', 'success');
  } catch (error) {
    if (generation !== sessionGeneration) return;
    if (activeReplica) activeReplica.local = true;
    syncState = networkUnavailable(error) ? 'idle' : 'error'; syncFailure = networkUnavailable(error) ? '' : safeError(error);
    if (interactive) toast(networkUnavailable(error) ? 'Offline' : 'Sync needs attention', networkUnavailable(error) ? 'Your encrypted copy and saved changes remain on this device.' : safeError(error), networkUnavailable(error) ? 'info' : 'error');
  } finally { if (generation === sessionGeneration) { setBusy(false); updateSessionDates(); } }
}
window.addEventListener('online', () => { if (installedApp && root) void syncInstalled({ interactive: false }); });
window.addEventListener('offline', () => { if (installedApp && root && replica) { replica.local = true; serverAuthenticated = false; updateSessionDates(); } });
// Background Sync is not universally available on iOS. Foreground retries cover
// reconnects, missed online events, and expired server sessions without storing
// the master password or account secret on disk.
setInterval(() => { if (installedApp && root && !busy && navigator.onLine && document.visibilityState === 'visible') void syncInstalled({ interactive: false }); }, 60000);
let lastForegroundSync = 0;
const syncOnResume = () => queueMicrotask(() => {
  if (installedApp && root && !busy && navigator.onLine && Date.now() - lastForegroundSync > 15000) {
    lastForegroundSync = Date.now(); void syncInstalled({ interactive: false });
  }
});
window.addEventListener('focus', syncOnResume);
window.addEventListener('pageshow', syncOnResume);
async function reload({ preserveDraft = false } = {}) {
  if (!preserveDraft && !confirmDiscard()) return;
  const selectionAtStart = currentItem, reloadGeneration = sessionGeneration;
  syncState = 'syncing'; if (!replica?.pending) syncFailure = ''; updateSessionDates();
  try {
  await refreshReplica();
  await loadVaultSettings();
  let data = await call("/api/v1/vaults");
  await publishVaultLifecycle(data);
  updateSessionDates();
  if (!data.directory || !data.vaultEnvelopes.some((row) => !row.retired)) {
    availableVaults = [];
    publishVaults([]);
    vault = catalogue = null;
    vaultId = null;
    loadedItems = [];
    favoriteItems = [];
    showEmpty();
    renderItems([]);
    $("vault-state").textContent = "No vault yet";
    $("vault-title").textContent = "No vault";
    $("nav-count").textContent = "0";
    $("create-vault").disabled = false;
    $("new-item").disabled = true;
    $("save").disabled = true;
    if (!replica?.local && !replica?.pending) lastSynced = new Date();
    syncState = "idle"; updateSessionDates();
    return;
  }
  let directory = un(data.directory),
    chosen = data.vaultEnvelopes.find((row) => row.vaultId === vaultId && !row.retired) || data.vaultEnvelopes.find((row) => !row.retired),
    activeRows = data.vaultEnvelopes.filter((row) => !row.retired);
  if (!chosen) throw Error("NO_ACTIVE_VAULT");
  availableVaults = activeRows.map((row, index) => ({ vaultId: row.vaultId, name: vaultSettings.names[row.vaultId] || (index === 0 ? "Private" : `Vault ${index + 1}`), selected: !browseView && !favoritesOnly && row.vaultId === chosen.vaultId }));
  $("vault-title").textContent = availableVaults.find((row) => row.selected)?.name || "Private";
  publishVaults(availableVaults);
  let
    nextVaultId = chosen.vaultId,
    nextVault = core.open_private_vault(
      root,
      directory,
      id(nextVaultId),
      un(chosen.envelope),
    ),
    listed = await call(`/api/v1/vaults/${nextVaultId}/items`),
    nextCatalogue = un(listed.catalogue),
    items = [];
  verifyListedCatalogue(nextVault, listed);
  for (let row of listed.indices) {
    let index = JSON.parse(
      td.decode(
        core.decrypt_private_part(
          nextVault,
          nextCatalogue,
          id(row.itemId),
          un(row.envelope),
          4,
        ),
      ),
    );
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(row.itemId)));
    const code = 'I-' + Array.from(digest.slice(0, 5), byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    items.push({ row: { ...row, code }, index: {
      ...index,
      createdAt: row.createdAt ?? index.createdAt ?? null,
      updatedAt: row.updatedAt ?? index.updatedAt ?? null,
    } });
  }
  items.sort(
    (a, b) =>
      (a.index.title || "").localeCompare(b.index.title || "", undefined, {
        sensitivity: "base",
        numeric: true,
      }) || (a.index.website || "").localeCompare(b.index.website || ""),
  );
  vaultId = nextVaultId;
  if (vault) { core.release_vault(vault); vault.free?.(); }
  vault = nextVault;
  catalogue = nextCatalogue;
  loadedItems = items;
  if (browseView) browseItems = await loadBrowseItems(browseView.kind === 'collection' ? vaultSettings.collections.find(row => row.id === browseView.id)?.vault_ids || [] : null);
  if (favoritesOnly) favoriteItems = await loadFavorites();
  renderItems(items);
  $("vault-state").textContent =
    `${items.length} item${items.length === 1 ? "" : "s"}`;
  $("nav-count").textContent = String(items.length);
  $("create-vault").disabled = false;
  $("new-item").disabled = false;
  $("save").disabled = false;
  if (favoritesOnly) { $("vault-title").textContent = "Favorites"; $("vault-state").textContent = "All active vaults"; }
  if (browseView && !favoritesOnly) { $('vault-title').textContent = browseView.kind === 'all' ? 'All items' : vaultSettings.collections.find(row => row.id === browseView.id)?.name || 'Collection'; $('vault-state').textContent = `${browseItems.length} items across vaults`; $('nav-count').textContent = String(browseItems.length); }
  if (!preserveDraft && selectionAtStart && currentItem === selectionAtStart && reloadGeneration === sessionGeneration) {
    const summary = items.find(row => row.row.itemId === selectionAtStart.itemId);
    if (summary) {
      const fresh = await fetchItem(summary.row.itemId, summary.index);
      if (currentItem === selectionAtStart && reloadGeneration === sessionGeneration) displayItem(fresh);
    } else clearItem();
  }
  if (!replica?.local && !replica?.pending) lastSynced = new Date();
  syncState = syncFailure ? 'error' : 'idle'; updateSessionDates();
  } catch (error) { syncState = 'error'; syncFailure = safeError(error); updateSessionDates(); throw error; }
}
async function loadBrowseItems(vaultIds = null, onlyFavorites = false) {
  const sessionRoot = root;
  const data = await call('/api/v1/vaults');
  const result = [];
  for (const row of data.vaultEnvelopes.filter(row => !row.retired)) {
    if (vaultIds && !vaultIds.includes(row.vaultId)) continue;
    if (!sessionRoot || root !== sessionRoot) throw Error('LOCKED');
    const localVault = core.open_private_vault(sessionRoot, un(data.directory), id(row.vaultId), un(row.envelope));
    try {
    const listed = await call(`/api/v1/vaults/${row.vaultId}/items`);
    verifyListedCatalogue(localVault, listed);
    const localCatalogue = un(listed.catalogue);
    for (const summary of listed.indices) {
      if (root !== sessionRoot) throw Error('LOCKED');
      const index = JSON.parse(td.decode(core.decrypt_private_part(localVault, localCatalogue, id(summary.itemId), un(summary.envelope), 4)));
      if (onlyFavorites && !index.favorite) continue;
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(summary.itemId)));
      const code = 'I-' + Array.from(digest.slice(0,5), byte => byte.toString(16).padStart(2,'0')).join('').toUpperCase();
      result.push({ row: { ...summary, vaultId: row.vaultId, code }, index });
    }
    } finally { if (root === sessionRoot) core.release_vault(localVault); localVault.free?.(); }
  }
  return result.sort((a,b) => (a.index.title || '').localeCompare(b.index.title || ''));
}
const loadFavorites = () => loadBrowseItems(null, true);
async function selectBrowseView(view) {
  if ((!applyDefaultView && busy) || !root || !confirmDiscard()) return;
  if (view.kind === 'collection' && !vaultSettings.collections.some(row => row.id === view.id)) return;
  browseView = view; favoritesOnly = false; clearItem(); publishSettings();
  await reload();
}
function openCollectionDialog(collectionId = null) {
  if (!root || busy || !confirmDiscard()) return;
  const collection = vaultSettings.collections.find(row => row.id === collectionId);
  window.dispatchEvent(new CustomEvent('vaults:edit-collection', { detail: collection || { id: null, name: '', vault_ids: [] } }));
  $('web-collection-dialog').showModal();
}
async function saveCollection(event) {
  event.preventDefault(); if (busy || !root) return;
  const collectionId = $('web-collection-id').value || crypto.randomUUID(), name = $('web-collection-name').value.trim();
  const vault_ids = [...document.querySelectorAll('#web-collection-vaults input:checked')].map(input => input.value).sort();
  if (!name || [...name].length > 80 || !vault_ids.length) { $('web-collection-status').textContent = 'Enter a name and select at least one vault.'; return; }
  setBusy(true);
  try {
    const rows = vaultSettings.collections.filter(row => row.id !== collectionId);
    if (rows.length >= 64) throw Error('COLLECTION_LIMIT');
    await saveVaultSettings({ ...vaultSettings, collections: [...rows, { id: collectionId, name, vault_ids }] });
    $('web-collection-dialog').close(); await reload(); toast('Collection saved', name, 'success');
  } catch (error) { $('web-collection-status').textContent = safeError(error); }
  finally { setBusy(false); }
}
async function removeCollection(collectionId) {
  if (!root || busy || !await confirmAction('Remove collection?', 'The vaults and their items will remain available.')) return;
  setBusy(true);
  try {
    await saveVaultSettings({ ...vaultSettings, collections: vaultSettings.collections.filter(row => row.id !== collectionId), default_view: vaultSettings.default_view?.kind === 'collection' && vaultSettings.default_view.id === collectionId ? null : vaultSettings.default_view });
    if (browseView?.id === collectionId) browseView = { kind: 'all' };
    publishSettings(); await reload();
  } catch (error) { toast('Collection could not be removed', safeError(error), 'error'); }
  finally { setBusy(false); }
}
async function setDefaultView(value) {
  if (!root || busy) return;
  setBusy(true);
  try {
    const [kind, selected] = value.split(':');
    const default_view = kind === 'all' ? { kind: 'all' } : ['vault', 'collection'].includes(kind) ? { kind, id: selected } : null;
    await saveVaultSettings({ ...vaultSettings, default_view });
    toast('Default view saved', 'This view will open after unlocking.', 'success');
  } catch (error) { toast('Default view could not be saved', safeError(error), 'error'); }
  finally { setBusy(false); }
}
function renderItems(items) {
  if (favoritesOnly) items = favoriteItems;
  else if (browseView) items = browseItems;
  let query = $("search").value.trim().toLowerCase();
  let filtered = items.filter((x) => (!favoritesOnly || x.index.favorite) &&
    `${x.index.title ?? ""} ${x.index.website ?? ""}`
      .toLowerCase()
      .includes(query),
  );
  let actions = query
    ? [
        { id: "new-item", label: "New item", description: "Create a vault item", terms: "new create add item login bank card wifi router ssh password" },
        { id: "edit-item", label: "Edit selected item", description: currentItem ? currentItem.index.title : "Select an item first", terms: "edit modify selected item" },
        { id: "create-vault", label: "Create vault", description: vault ? "A private vault already exists" : "Create your private vault", terms: "new create vault" },
        { id: "reload", label: "Reload vault", description: "Refresh encrypted data", terms: "reload refresh sync vault" },
        { id: "settings", label: "Open settings", description: "Profile and trusted devices", terms: "settings profile devices trust" },
        { id: "lock", label: "Lock 127Vaults", description: "Close the current vault", terms: "lock logout secure vault" },
      ].filter((action) => `${action.label} ${action.description} ${action.terms}`.toLowerCase().includes(query))
        .map(({ terms: _, ...action }) => action)
    : [];
  window.dispatchEvent(
    new CustomEvent("vaults:items", {
      detail: {
        items: filtered,
        actions,
        selectedId: currentItem?.itemId ?? null,
        favoriteView: favoritesOnly,
        empty: query ? "No matching items." : favoritesOnly ? "No favorites yet." : "This vault has no items yet.",
      },
    }),
  );
}
async function revokeDevice(device) {
  if (device.deviceId === identity?.deviceId) return;
  if (!(await confirmAction("Revoke trusted device?", `Device ${device.deviceId.slice(0, 8)} will need enrollment before it can sign in again.`))) return;
  setBusy(true);
  try {
    await call("/api/v1/devices/revoke", {
      method: "POST",
      body: { deviceId: device.deviceId },
    });
    await reloadDevices();
    msg("Device trust removed.", "success");
  } catch (e) {
    msg(`Device could not be revoked (${e.message}).`, "error");
  } finally {
    setBusy(false);
  }
}
function publishOwnershipRequests(grants = []) {
  window.__vaultsOwnershipRequests = grants;
  window.dispatchEvent(new CustomEvent("vaults:ownership", { detail: grants }));
}
async function reloadOwnershipRequests() {
  publishOwnershipRequests();
  if (!root || replica?.local) return;
  const generation = sessionGeneration;
  let result;
  try { result = await call('/api/v1/ownership/requests'); } catch { return; }
  if (generation !== sessionGeneration || !Array.isArray(result.grants) || result.grants.length > 100) return;
  publishOwnershipRequests(result.grants.filter(grant => /^[0-9a-f-]{36}$/.test(grant.grantId) && typeof grant.expiresAt === 'string' && Number.isFinite(new Date(grant.expiresAt).getTime())));
}
async function acceptOwnership(grantId) {
  if (!root || !window.__vaultsOwnershipRequests?.some(grant => grant.grantId === grantId)) return;
  if (!await confirmAction('Accept server ownership?', 'This gives your account server-owner responsibilities. Your existing sessions will end; unlock again after acceptance.')) return;
  try {
    await call('/api/v1/ownership/requests/' + grantId + '/accept', { method: 'POST', body: { requestId: crypto.randomUUID() } });
    await lock(); toast('Ownership accepted', 'Unlock again to refresh your server role.', 'success');
  } catch (error) {
    toast('Ownership was not confirmed', error.message === 'fresh_auth_required' ? 'Lock and unlock again, then accept this request within five minutes.' : safeError(error), 'error');
  }
}
async function reloadDevices() {
  if (!root) return;
  $("device-status").textContent = "Checking trusted devices…";
  try {
    let data = await call("/api/v1/devices"),
      rows = Array.isArray(data.devices) ? data.devices : [];
    window.dispatchEvent(
      new CustomEvent("vaults:devices", {
        detail: { devices: rows, currentDeviceId: identity?.deviceId ?? null },
      }),
    );
    $("device-status").textContent = rows.length
      ? `${rows.length} device${rows.length === 1 ? "" : "s"} registered.`
      : "No registered devices were returned.";
  } catch (e) {
    window.dispatchEvent(
      new CustomEvent("vaults:devices", {
        detail: { devices: [], currentDeviceId: identity?.deviceId ?? null },
      }),
    );
    $("device-status").textContent =
      e.message === "HTTP_404"
        ? "Device management is not mounted on this server yet."
        : "Device status is temporarily unavailable. Your vault remains unlocked.";
  }
}
const canonical = (value) => JSON.stringify(value, Object.keys(value).sort());
async function beginEnrollment() {
  status("enrollment-status", "Checking enrollment code…");
  try {
    let code = $("enrollment-request").value.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code))
      throw Error("CODE_MUST_BE_8_CHARACTERS");
    let binding = await call(
        "/api/v1/device-enrollment/inspect",
        { method: "POST", body: { code } },
      ),
      approvalSignature = b64(
        new Uint8Array(
          await crypto.subtle.sign(
            "Ed25519",
            identity.privateKey,
            te.encode(canonical(binding)),
          ),
        ),
      );
    await call(`/api/v1/device-enrollment/${binding.enrollmentId}/approval`, {
      method: "POST",
      body: { approvalSignature },
    });
    $("enrollment-request").value = "";
    status(
      "enrollment-status",
      `Approved CLI device ${binding.newDeviceId.slice(0, 8)}. The CLI will finish automatically.`,
    );
  } catch (e) {
    status(
      "enrollment-status",
      `Enrollment approval failed (${e.message}).`,
      "error",
    );
  }
}
async function completeEnrollment() {
  status("enrollment-status", "Checking CLI possession proof…");
  try {
    let value = JSON.parse($("enrollment-completion").value);
    if (value.version !== 1) throw Error("INVALID_COMPLETION_PROOF");
    let confirmed = await call(
        "/api/v1/devices/enrollments/approve",
        {
          method: "POST",
          body: {
            enrollmentId: value.enrollmentId,
            code: value.code,
            approvalSignature: value.approvalSignature,
            possessionSignature: value.possessionSignature,
          },
        },
      ),
      receipt = JSON.stringify({
        version: 1,
        deviceId: confirmed.deviceId,
        credentialEpoch: confirmed.credentialEpoch,
      });
    $("enrollment-approval").value = receipt;
    $("enrollment-request").value = $("enrollment-completion").value = "";
    try {
      await navigator.clipboard.writeText(receipt);
      status(
        "enrollment-status",
        "CLI device enrolled. Success receipt copied; paste it into the CLI.",
      );
    } catch {
      status(
        "enrollment-status",
        "CLI device enrolled. Copy the success receipt field into the CLI.",
      );
    }
    await reloadDevices();
  } catch (e) {
    status(
      "enrollment-status",
      `Enrollment completion failed (${e.message}). Start a new enrollment if it expired.`,
      "error",
    );
  }
}
const hex = (bytes) =>
  [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
async function signedMutation(
  kind,
  itemId,
  catalogueBytes,
  indexBytes,
  bodyBytes,
  { targetVault = vaultId, history = null } = {},
) {
  const generation = sessionGeneration, signingIdentity = identity, context = authContext;
  let sync = history || await operationHistory(targetVault, call),
    previous =
      [...(sync.operations ?? [])]
        .reverse()
        .find((x) => x.operation.deviceId === signingIdentity.deviceId)?.operation
        .opId ?? null,
    framed = kind === 'item.delete' ? cat(be(catalogueBytes.length, 4), catalogueBytes) : cat(
      be(catalogueBytes.length, 4),
      catalogueBytes,
      be(indexBytes.length, 4),
      indexBytes,
      be(bodyBytes.length, 4),
      bodyBytes,
    ),
    body = {
      protocolVersion: 1,
      tenantId: context.tenantId,
      vaultId: targetVault,
      deviceId: signingIdentity.deviceId,
      epoch: Number(new DataView(catalogueBytes.buffer, catalogueBytes.byteOffset + 36, 8).getBigUint64(0)),
      causalBase: sync.cursor ?? 0,
      previousDeviceOpId: previous,
      kind,
      itemId,
      payloadHash: hex(new Uint8Array(await sha256(framed))),
    },
    opId = hex(new Uint8Array(await sha256(te.encode(canonical(body))))),
    signature = b64(
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          signingIdentity.privateKey,
          te.encode(canonical({ ...body, opId })),
        ),
      ),
    );
  if (generation !== sessionGeneration || !root || signingIdentity !== identity) throw Error('LOCKED');
  return { ...body, opId, signature };
}
function normalizeWebsite(value) {
  value = value.trim();
  if (!value) return "";
  let candidate = /^[a-z][a-z0-9+.-]*:/i.test(value)
      ? value
      : `https://${value}`,
    parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw Error("WEBSITE_INVALID");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  )
    throw Error("WEBSITE_INVALID");
  return parsed.href;
}
function customInputType(type) {
  return (
    {
      date: "date",
      url: "url",
      email: "email",
      number: "number",
      password: "password",
    }[type] || "text"
  );
}
function addCustomField(field = {}) {
  window.dispatchEvent(
    new CustomEvent("vaults:add-editor-field", { detail: field }),
  );
}
function collectCustomFields() {
  let labels = new Set();
  let custom = [...document.querySelectorAll("#custom-fields .custom-field")].map(
    (row) => {
      let label = row.querySelector(".custom-label").value.trim(),
        key = label.toLocaleLowerCase();
      if (!label) throw Error("CUSTOM_FIELD_NAME_REQUIRED");
      if (labels.has(key)) throw Error("CUSTOM_FIELD_NAME_DUPLICATE");
      labels.add(key);
      let type = row.querySelector(".field-type-value").value,
        value = row.querySelector(".custom-value").value;
      if (type === "url" && value) value = normalizeWebsite(value);
      return { id: row.dataset.fieldId, label, type, value };
    },
  );
  let typed = [...document.querySelectorAll("#custom-fields .typed-value")].map((input) => {
    let label = input.dataset.fieldLabel?.trim();
    if (!label) throw Error("CUSTOM_FIELD_NAME_REQUIRED");
    return { id: input.dataset.fieldId, label, type: input.dataset.fieldType, value: input.value };
  });
  let metadata = [...document.querySelectorAll('#custom-fields input.item-metadata[data-field-id]')].map((input) => ({
    id: input.dataset.fieldId,
    label: input.dataset.fieldLabel,
    type: input.dataset.fieldType,
    value: input.value,
  }));
  return [...metadata, ...typed, ...custom, ...editorPasskeyFields];
}
function renderCustomFields(fields = [], password = "") {
  window.dispatchEvent(
    new CustomEvent("vaults:view-fields", { detail: { fields, password } }),
  );
}
const itemKinds = {
  passkey: { label: "Passkey", website: true },
  login: { label: "Login", username: true, password: true, website: true },
  bank: { label: "Bank account", username: true, password: true, website: true },
  card: { label: "Payment card" },
  wifi: { label: "Wi-Fi network", password: true },
  router: { label: "Router", username: true, password: true, website: true },
  ssh: { label: "SSH / device", username: true, password: true },
  password: { label: "Password only", password: true },
};
function itemKind(fields = []) {
  let marker = fields.find((field) => field.id === "__127vaults_item_type")?.value;
  return marker in itemKinds ? marker : "login";
}
function showItemKind(kind, editing = false) {
  let shape = itemKinds[kind] || itemKinds.login;
  if (editing) {
    $("form-mode").textContent = `${$("item-id").value ? "EDIT" : "NEW"} ${shape.label.toUpperCase()}`;
    $("url").closest("label").hidden = !shape.website;
    $("url").readOnly = editorPasskeyFields.length > 0 || kind === "passkey";
    $("item-username").readOnly = kind === "passkey";
    $("item-username").closest("label").hidden = !shape.username;
    $("item-password").closest("label").hidden = !shape.password;
    $("form-signin").hidden = !shape.username && !shape.password;
  } else {
    $("view-type").textContent = shape.label.toUpperCase();
    $("view-username-row").hidden = !shape.username;
    $("view-password-row").hidden = !shape.password;
    $("view-signin").hidden = !shape.username && !shape.password;
  }
}
function setPasswordVisibilityButton(button, revealed) {
  const label = revealed ? "Hide password" : "Reveal password";
  button.setAttribute("aria-pressed", String(revealed));
  button.setAttribute("aria-label", label);
  button.title = label;
}
function displayItem(item, button) {
  editorBaseline = null;
  currentItem = item;
  window.dispatchEvent(new CustomEvent("vaults:detail-item", { detail: { ...item, vaultId } }));
  const favorite = features.isFavorite(item.body.customFields);
  $("favorite-item").setAttribute('aria-pressed', String(favorite));
  $("favorite-item").setAttribute('aria-label', favorite ? 'Remove from favorites' : 'Add to favorites');
  $("favorite-item").title = favorite ? 'Remove from favorites' : 'Add to favorites';
  // Do not leave credential-shaped values in the hidden editor. Password-manager
  // extensions can otherwise mistake item selection for a completed login form.
  for (let x of ["item-id", "title", "url", "item-username", "item-password"])
    $(x).value = "";
  $("item-password").type = "text";
  window.dispatchEvent(
    new CustomEvent("vaults:set-editor-fields", { detail: [] }),
  );
  renderItems(loadedItems);
  $("view-title").textContent = item.index.title || "Untitled";
  let website = item.index.website || "";
  $("view-url").textContent = website;
  $("view-url").hidden = !website;
  try {
    $("view-url").href = new URL(website).href;
  } catch {
    $("view-url").removeAttribute("href");
  }
  $("view-username").textContent = item.body.username || "—";
  showItemKind(itemKind(item.body.customFields));
  $("duplicate-item").hidden = !!readMetadata(item.body.customFields);
  $("view-password").textContent = "••••••••••••";
  setPasswordVisibilityButton($("reveal-password"), false);
  renderCustomFields(item.body.customFields, item.body.password || "");
  $("item-empty").hidden = true;
  $("item-form").hidden = true;
  $("item-view").hidden = false;
}
async function openItem(itemId, index, button) {
  if (!confirmDiscard()) return;
  const requestedItem = itemId, generation = sessionGeneration, ownerVault = vaultId;
  $("items").setAttribute("aria-busy", "true");
  try {
    let item = await fetchItem(itemId, index);
    if (generation === sessionGeneration && ownerVault === vaultId && $("items").dataset.requestedItem === requestedItem)
      displayItem(item, button);
  } catch (e) {
    if (generation === sessionGeneration && ownerVault === vaultId && $("items").dataset.requestedItem === requestedItem)
      toast("Item could not be opened", `${safeError(e)} Try syncing and select the item again.`, "error");
  } finally {
    if (generation === sessionGeneration && ownerVault === vaultId && $("items").dataset.requestedItem === requestedItem)
      $("items").removeAttribute("aria-busy");
  }
}
async function fetchItem(itemId, index) {
  let revision = uuid(catalogue.slice(44, 60)),
    got = await call(`/api/v1/vaults/${vaultId}/items/${itemId}?catalogueRevision=${revision}`),
    body = JSON.parse(td.decode(core.decrypt_private_part(vault, catalogue, id(itemId), un(got.envelope), 3)));
  return { itemId, index, body };
}
// Called only by the installed extension's user-initiated browser action. The
// extension reads this object in the page's main world after obtaining explicit
// permission for this vault origin. No credential is pushed to other pages.
function extensionOrigin(website) {
  if (typeof website !== 'string') return null;
  const value = website.trim();
  if (!value || /[\s\\]/u.test(value) || value.startsWith('//')) return null;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname && !url.hostname.includes('*') ? url.origin : null;
  }
  catch { return null; }
}
function extensionRelatedLogins(item, siteOrigin) {
  const fields = Array.isArray(item.body.customFields) ? item.body.customFields : [];
  const output = [];
  for (const marker of fields) {
    const entryId = typeof marker.id === 'string' && marker.id.startsWith('__127vaults_section:') ? marker.id.slice('__127vaults_section:'.length) : null;
    if (!entryId || marker.type !== 'metadata' || String(marker.value).split('|', 1)[0] !== 'login') continue;
    const field = name => fields.find(row => row.id === `__127vaults_field:${entryId}:${name}`);
    const website = field('website')?.value;
    if (extensionOrigin(website) !== siteOrigin || field('password')?.type !== 'password') continue;
    output.push({ itemId: item.itemId, entryId, title: String(marker.value).split('|').slice(1).join('|') || 'Related login', website, username: field('username')?.value || '' });
  }
  return output;
}
window.__vaultsExtensionActions = {
  status() { return { locked: !root || !vault || !catalogue }; },
  passkeyVaults() {
    if (!root || !vault || !catalogue) throw Error("Unlock the web vault first.");
    return [{ vaultId, name: availableVaults.find(row => row.vaultId === vaultId)?.name || "Current vault" }];
  },
  async passkeyList(siteOrigin) {
    if (!root || !vault || !catalogue) throw Error('Unlock the web vault first.');
    const activeVault = vault, output = [];
    for (const { row, index } of loadedItems) {
      if (extensionOrigin(index.website) !== siteOrigin) continue;
      const item = await fetchItem(row.itemId, index);
      if (!root || vault !== activeVault) throw Error('Vault locked or changed.');
      const metadata = readMetadata(item.body.customFields);
      if (metadata?.origin === siteOrigin) output.push({ vaultId, itemId: row.itemId, title: index.title, metadata });
    }
    return output;
  },
  async passkeyGet(itemId, requestedVault, siteOrigin, password) {
    await verifyPasskeyPassword(password);
    const activeVault = vault;
    if (requestedVault !== vaultId) throw Error('Vault changed.');
    const row = loadedItems.find(row => row.row.itemId === itemId);
    if (!row || extensionOrigin(row.index.website) !== siteOrigin) throw Error('Passkey does not match.');
    const item = await fetchItem(itemId, row.index), metadata = readMetadata(item.body.customFields);
    if (!root || vault !== activeVault || metadata?.origin !== siteOrigin) throw Error('Vault locked or changed.');
    const key = item.body.customFields.find(f => f.id === PASSKEY_KEY && f.type === 'password');
    if (!key) throw Error('Passkey key is missing.');
    return { metadata, privateKey: key.value };
  },
  async passkeyTargets(siteOrigin) {
    if (!root || !vault || !catalogue) throw Error('Unlock the web vault first.');
    const activeVault = vault, targets = [];
    for (const { row, index } of loadedItems) {
      if (index.itemType !== 'login' && index.itemType) continue;
      if (extensionOrigin(index.website) !== siteOrigin) continue;
      const item = await fetchItem(row.itemId, index);
      if (!root || vault !== activeVault) throw Error('Vault changed.');
      if (!readMetadata(item.body.customFields)) targets.push({ vaultId, itemId: row.itemId, title: index.title, username: item.body.username });
    }
    return targets;
  },
  async passkeySave(metadata, privateKey, siteOrigin, password, requestedVaultId, targetItemId) {
    if (requestedVaultId !== vaultId) throw Error("The destination vault changed. Review the request again.");
    if (busy || !$("item-form").hidden || !root || !vault || !catalogue) throw Error('Finish editing and unlock the destination vault first.');
    const fields = passkeyFields(metadata, privateKey);
    if (metadata.origin !== siteOrigin) throw Error('Passkey origin mismatch.');
    const activeVault = vault, targetVault = vaultId;
    setBusy(true);
    try {
      await verifyPasskeyPassword(password);
      if ((await window.__vaultsExtensionActions.passkeyList(siteOrigin)).some(row => row.metadata.credentialId === metadata.credentialId)) throw Error('Passkey already exists.');
      if (!root || vault !== activeVault || vaultId !== targetVault) throw Error('Vault changed.');
      const now = Date.now();
      let index = { title: metadata.username ? `${metadata.rpId} · ${metadata.username}` : metadata.rpId, website: siteOrigin, itemType: 'passkey', favorite: false, createdAt: now, updatedAt: now };
      let body = { username: metadata.username, password: '', customFields: fields };
      if (targetItemId) {
        const target = loadedItems.find(row => row.row.itemId === targetItemId);
        if (!target || extensionOrigin(target.index.website) !== siteOrigin || !['login', undefined].includes(target.index.itemType)) throw Error('Choose a matching login.');
        const original = await fetchItem(targetItemId, target.index);
        if (readMetadata(original.body.customFields)) throw Error('This item already has a passkey.');
        index = { ...target.index, updatedAt: now };
        body = { ...original.body, customFields: [...(original.body.customFields || []), ...fields.filter(field => field.id !== '__127vaults_item_type')] };
      }
      if (!root || vault !== activeVault || vaultId !== targetVault) throw Error('Vault changed.');
      const made = core.upsert_private_item(vault, catalogue, targetItemId ? id(targetItemId) : undefined, te.encode(JSON.stringify(index)), te.encode(JSON.stringify(body)));
      const itemId = uuid(made.item()), payload = { requestId: crypto.randomUUID(), baseCatalogueRevision: uuid(catalogue.slice(44, 60)), catalogue: b64(made.catalogue()), index: b64(made.index()), body: b64(made.body()), itemId };
      payload.signedOperation = await signedMutation(targetItemId ? 'item.update' : 'item.create', itemId, made.catalogue(), made.index(), made.body());
      if (!root || vault !== activeVault || vaultId !== targetVault) throw Error('Vault changed.');
      await call(`/api/v1/vaults/${targetVault}/items${targetItemId ? '/' + itemId : ''}`, { method: targetItemId ? 'PUT' : 'POST', body: payload });
      if (!root || vault !== activeVault || vaultId !== targetVault) throw Error('Saved, but vault changed. Check the vault before retrying.');
      catalogue = made.catalogue();
      await reload();
      if (!root || vaultId !== targetVault) throw Error('Vault changed.');
      toast('Passkey saved', `${metadata.username} on ${metadata.rpId}`, 'success');
      return { itemId, vaultId: targetVault, saved: true };
    } finally { setBusy(false); }
  },
  async lock() {
    await lock();
    return true;
  },
  async list(siteOrigin) {
    if (!root || !vault || !catalogue) return { locked: true, items: [] };
    arm();
    const activeVault = vault;
    const items = [];
    for (const { row, index } of loadedItems) {
      if (!root || vault !== activeVault) return { locked: true, items: [] };
      const item = await fetchItem(row.itemId, index);
      if (itemKind(item.body.customFields) === 'login' && extensionOrigin(index.website) === siteOrigin) {
        items.push({ itemId: row.itemId, entryId: '', title: index.title || 'Untitled login', website: index.website, username: item.body.username || '' });
      }
      items.push(...extensionRelatedLogins(item, siteOrigin));
    }
    return {
      locked: false,
      vaultId,
      items,
    };
  },
  async credential(itemId, requestedVaultId, entryId, siteOrigin) {
    if (!root || !vault || !catalogue || requestedVaultId !== vaultId) throw Error("VAULT_LOCKED_OR_CHANGED");
    const found = loadedItems.find(({ row }) => row.itemId === itemId);
    if (!found) throw Error("ITEM_NOT_FOUND");
    const activeVault = vault;
    const item = await fetchItem(itemId, found.index);
    if (!root || vault !== activeVault || requestedVaultId !== vaultId) throw Error("VAULT_LOCKED_OR_CHANGED");
    arm();
    if (entryId) {
      const entry = extensionRelatedLogins(item, siteOrigin).find(row => row.entryId === entryId);
      if (!entry) throw Error('RELATED_LOGIN_NOT_FOUND');
      const fields = item.body.customFields;
      const password = fields.find(row => row.id === `__127vaults_field:${entryId}:password`)?.value;
      if (typeof password !== 'string') throw Error('RELATED_PASSWORD_NOT_FOUND');
      return { itemId, entryId, website: entry.website, username: entry.username, password };
    }
    if (itemKind(item.body.customFields) !== 'login' || extensionOrigin(found.index.website) !== siteOrigin) throw Error('NOT_A_MATCHING_LOGIN');
    return { itemId, entryId: '', website: found.index.website, username: item.body.username || '', password: item.body.password || '' };
  },
};
function openCreateVaultDialog() {
  if (!confirmDiscard()) return;
  vaultDialogTarget = null;
  $("web-vault-name").value = availableVaults.length ? `Vault ${availableVaults.length + 1}` : "Private";
  $("web-vault-dialog-title").textContent = "Create vault";
  $("web-create-vault-submit").textContent = "Create vault";
  $("web-create-vault-dialog").showModal();
  $("web-vault-name").focus();
}
function openRenameVaultDialog(vaultId) {
  const selected = availableVaults.find((row) => row.vaultId === vaultId);
  if (!selected) return;
  vaultDialogTarget = vaultId;
  $("web-vault-name").value = selected.name;
  $("web-vault-dialog-title").textContent = "Rename vault";
  $("web-create-vault-submit").textContent = "Save name";
  $("web-create-vault-dialog").showModal();
  $("web-vault-name").focus();
}
async function submitVaultDialog(event) {
  event.preventDefault();
  if (!vaultDialogTarget) return createVault();
  const name = $("web-vault-name").value.trim();
  if (!name || [...name].length > 80) { $("web-vault-name").focus(); return; }
  setBusy(true);
  try { await saveVaultName(vaultDialogTarget, name); await reload(); $("web-create-vault-dialog").close(); toast("Vault renamed", name, "success"); }
  catch (error) { toast("Vault was not renamed", safeError(error), "error"); }
  finally { setBusy(false); }
}
async function createVault(event) {
  event?.preventDefault();
  const name = $("web-vault-name").value.trim();
  if (!name || [...name].length > 80) { $("web-vault-name").focus(); return; }
  setBusy(true);
  let accepted = false;
  try {
    let data = await call("/api/v1/vaults"),
      client = new (
        await import("/app/private-vault-client.mjs")
      ).PrivateVaultClient({ core, root, csrf, fetcher: async (path, options) => {
        const value = await call(path, { method: options.method, body: JSON.parse(options.body) });
        return { ok: true, json: async () => value };
      } }),
      newId = await client.create(un(data.directory));
    accepted = true;
    syncState = "idle"; syncFailure = "";
    editorBaseline = null;
    vaultId = newId;
    browseView = null; browseItems = []; publishSettings(); clearItem();
    if (vault) { core.release_vault(vault); vault.free?.(); }
    vault = client.vault;
    catalogue = client.catalogue;
    await saveVaultName(newId, name);
    await reload();
    $("web-create-vault-dialog").close();
    lastLocalChange = new Date();
    updateSessionDates();
    toast("Vault created", `${name} is ready.`, "success");
  } catch (error) {
    if (accepted) { await reload().catch(() => {}); $("web-create-vault-dialog").close(); toast("Vault created; name needs attention", `The vault was created, but its name could not sync. (${safeError(error)})`, "error"); }
    else toast("Vault was not created", `Try again after checking the server connection. (${safeError(error)})`, "error");
  } finally {
    setBusy(false);
  }
}
async function selectVault(nextVaultId, preserveFavorites = false) {
  if (busy && !applyDefaultView) return;
  if (!confirmDiscard()) return;
  if (!preserveFavorites) { favoritesOnly = false; browseView = null; browseItems = []; publishSettings(); }
  if (!availableVaults.some((row) => row.vaultId === nextVaultId)) return;
  vaultId = nextVaultId;
  clearItem();
  try { await reload(); }
  catch (error) { toast("Vault could not be opened", safeError(error), "error"); }
}
async function deleteItem() {
  if (!root || !currentItem?.itemId || busy || !confirmDiscard()) return;
  const selected = currentItem, targetVault = vaultId, generation = sessionGeneration;
  if (!window.confirm(`Permanently delete “${selected.index.title || 'Untitled item'}”? This removes its passwords and passkeys. Offline deletion will sync when connected.`)) return;
  setBusy(true);
  let accepted = false;
  try {
    const next = core.delete_private_item(vault, catalogue, id(selected.itemId));
    const signedOperation = await signedMutation('item.delete', selected.itemId, next);
    if (generation !== sessionGeneration || !root) throw Error('LOCKED');
    await call(`/api/v1/vaults/${targetVault}/items/${selected.itemId}`, { method: 'DELETE', body: {
      requestId: crypto.randomUUID(), baseCatalogueRevision: uuid(catalogue.slice(44,60)),
      catalogue: b64(next), signedOperation,
    } });
    accepted = true;
    if (generation !== sessionGeneration || !root) return;
    catalogue = next; clearItem();
    window.dispatchEvent(new CustomEvent('vaults:item-deleted', { detail: { itemId: selected.itemId, vaultId: targetVault } }));
    lastLocalChange = new Date();
    await reload();
    updateSessionDates();
    toast(replica?.pending ? 'Deletion saved on this device' : 'Item deleted', replica?.pending ? 'The encrypted deletion will sync when connected.' : 'The item has been removed.', 'success');
  } catch (error) {
    if (generation !== sessionGeneration || error.message === 'LOCKED') return;
    toast(accepted ? 'Deletion saved; refresh needs attention' : 'Deletion needs attention',
      `${safeError(error)} Sync and review pending changes before retrying.`, 'error');
  } finally { if (generation === sessionGeneration) setBusy(false); }
}
async function save(event, retry = false) {
  event.preventDefault();
  if ((busy && !retry) || !root) return;
  const generation = sessionGeneration, activeRoot = root;
  const currentSession = () => generation === sessionGeneration && root === activeRoot;
  let titleInput = $("title"), titleError = $("title-error");
  titleInput.setAttribute("aria-invalid", String(!titleInput.value.trim()));
  titleError.classList.toggle("hidden", !!titleInput.value.trim());
  if (!titleInput.value.trim()) { titleInput.focus(); return; }
  setBusy(true);
  let draft, accepted = false;
  try {
    let itemId = $("item-id").value || null,
      previousIndex = itemId ? loadedItems.find((item) => item.row.itemId === itemId)?.index : null,
      now = Date.now(),
      fields = collectCustomFields(),
      index = {
        title: $("title").value.trim(),
        website: normalizeWebsite($("url").value),
        itemType: itemKind(fields),
        favorite: features.isFavorite(fields),
        createdAt: previousIndex?.createdAt ?? (itemId ? null : now),
        updatedAt: now,
      },
      body = {
        username: $("item-username").value,
        password: $("item-password").value,
        customFields: fields,
      };
    const authenticator = fields.find(field => field.id === features.TOTP_ID)?.value;
    if (authenticator) features.parseTotp(authenticator);
    const passkey = readMetadata(fields);
    if (passkey && (extensionOrigin(index.website) !== passkey.origin)) throw Error("A passkey’s website and type cannot be changed.");
    draft = { itemId, index, body };
    let
      made = core.upsert_private_item(
        vault,
        catalogue,
        itemId ? id(itemId) : undefined,
        te.encode(JSON.stringify(index)),
        te.encode(JSON.stringify(body)),
      ),
      newId = uuid(made.item()),
      payload = {
        requestId: crypto.randomUUID(),
        baseCatalogueRevision: uuid(catalogue.slice(44, 60)),
        catalogue: b64(made.catalogue()),
        index: b64(made.index()),
        body: b64(made.body()),
        ...(itemId ? {} : { itemId: newId }),
      };
    payload.signedOperation = await signedMutation(
      itemId ? "item.update" : "item.create",
      newId,
      made.catalogue(),
      made.index(),
      made.body(),
    );
    if (!currentSession()) return;
    await call(
      `/api/v1/vaults/${vaultId}/items${itemId ? `/${itemId}` : ""}`,
      { method: itemId ? "PUT" : "POST", body: payload },
    );
    if (!currentSession()) return;
    accepted = true;
    let acceptedRevision = uuid(made.catalogue().slice(44, 60));
    catalogue = made.catalogue();
    lastLocalChange = new Date();
    if (!replica?.local && !replica?.pending) lastSynced = new Date();
    updateSessionDates();
    clearItem();
    await reload();
    if (!currentSession()) return;
    if (uuid(catalogue.slice(44, 60)) !== acceptedRevision) throw Error("SAVE_REVISION_MISMATCH");
    let summary = loadedItems.find((row) => row.row.itemId === newId);
    if (!summary) throw Error("SAVED_ITEM_MISSING");
    const savedItem = await fetchItem(newId, summary.index);
    if (!currentSession()) return;
    displayItem(savedItem);
    toast(replica?.pending ? "Saved on this device" : itemId ? "Item updated" : "Item created", replica?.pending ? "Your encrypted change is saved locally and will sync when connected." : "Your encrypted change was saved successfully.", "success");
  } catch (e) {
    if (!currentSession()) return;
    if (accepted) {
      toast("Item saved; refresh needs attention", "The server accepted the encrypted change, but the fresh replica could not be verified. Sync before editing again.", "error");
      return;
    }
    let messages = {
      WEBSITE_INVALID: "Enter a valid website or domain.",
      CUSTOM_FIELD_NAME_REQUIRED: "Every custom field needs a name.",
      CUSTOM_FIELD_NAME_DUPLICATE: "Custom field names must be unique.",
    };
    if (["HTTP_409", "BASE_CHANGED", "sync_conflict"].includes(e.message) || e.message.includes("409")) {
      let serverItem = null, serverLoadFailed = false;
      try {
        await reload({ preserveDraft: true });
        if (!currentSession()) return;
        let summary = loadedItems.find((row) => row.row.itemId === draft?.itemId);
        if (summary) serverItem = await fetchItem(summary.row.itemId, summary.index);
      } catch (loadError) {
        if (!currentSession()) return;
        serverLoadFailed = true;
        toast("Server version could not be loaded", safeError(loadError), "error");
      }
      if (!currentSession()) return;
      if (serverLoadFailed) { beginEdit(draft, true); return; }
      let choice = await resolveConflict(draft, serverItem);
      if (!currentSession()) return;
      if (choice === "mine") {
        beginEdit(serverItem ? draft : { ...draft, itemId: null }, true);
        await new Promise(requestAnimationFrame);
        if (!currentSession()) return;
        await save(event, true);
      } else if (choice === "server") {
        if (serverItem) displayItem(serverItem); else clearItem();
        toast("Server version restored", "Your unsaved local edit was discarded.", "success");
      } else if (choice?.kind === "merge") {
        beginEdit(choice.item, true);
        await new Promise(requestAnimationFrame);
        if (!currentSession()) return;
        await save(event, true);
      } else if (draft) {
        beginEdit(draft, true);
      }
    } else toast("Item was not saved", messages[e.message] || `${safeError(e)} Check the highlighted values and try again.`, "error");
    if (e.message === "WEBSITE_INVALID") $("url").focus();
    else if (e.message.startsWith("CUSTOM_FIELD_"))
      document.querySelector("#custom-fields .custom-label:invalid")?.focus();
  } finally {
    if (currentSession()) setBusy(false);
  }
}
function resolveConflict(local, server) {
  return new Promise((resolve) => {
    let dialog = $("conflict-dialog"), finished = false;
    const onLock = () => finish('cancel');
    const finish = choice => { if (finished) return; finished = true; window.removeEventListener('vaults:locked', onLock); dialog.close(); $('merge-fields').replaceChildren(); resolve(choice); };
    window.addEventListener('vaults:locked', onLock, { once: true });
    dialog.oncancel = event => { event.preventDefault(); finish('cancel'); };
    $("conflict-detail").textContent = local && !server
      ? "This item was deleted on another device while you were editing it. Save your version as a new item, accept the deletion, or keep editing."
      : "This item changed on another device while you were editing it. Choose which values to save.";
    $("conflict-keep").textContent = local && !server ? "Save mine as a new item" : "Use mine and save";
    $("conflict-server").textContent = local && !server ? "Accept deletion" : "Use server version";
    $("merge-fields").classList.add("hidden");
    $("merge-fields").replaceChildren();
    $("conflict-apply-merge").classList.add("hidden");
    $("conflict-merge").classList.toggle("hidden", !local || !server);
    let selected = new Map();
    const addChoice = (key, label, mine, theirs, secret = false) => {
      selected.set(key, "local");
      let row = document.createElement("div");
      row.className = "grid grid-cols-[minmax(5rem,7rem)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-white/7 p-3 last:border-0 max-[560px]:grid-cols-2";
      let name = document.createElement("b");
      name.className = "self-center text-xs text-slate-400 max-[560px]:col-span-2";
      name.textContent = label;
      row.append(name);
      for (let [source, value] of [["local", mine], ["server", theirs]]) {
        let button = document.createElement("button");
        button.type = "button";
        button.className = `merge-choice min-w-0 rounded-lg border p-2 text-left text-xs ${source === "local" ? "border-[#E0BB95]/60 bg-[#E0BB95]/10" : "border-white/10"}`;
        button.setAttribute("aria-pressed", String(source === "local"));
        let heading = document.createElement("span"), preview = document.createElement("span");
        heading.className = "block text-[10px] font-bold text-[#E0BB95]";
        heading.textContent = source === "local" ? "MINE" : "SERVER";
        preview.className = "block truncate";
        preview.textContent = secret && value ? "••••••••" : value || "—";
        button.append(heading, preview);
        button.onclick = () => {
          selected.set(key, source);
          for (let candidate of row.querySelectorAll("button.merge-choice")) {
            let active = candidate === button;
            candidate.setAttribute("aria-pressed", String(active));
            candidate.className = `min-w-0 rounded-lg border p-2 text-left text-xs ${active ? "border-[#E0BB95]/60 bg-[#E0BB95]/10" : "border-white/10"}`;
          }
        };
        row.append(button);
      }
      $("merge-fields").append(row);
    };
    if (local && server) {
      for (let field of ["title", "website", "username", "password"]) {
        let part = field === "title" || field === "website" ? "index" : "body";
        addChoice(field, field[0].toUpperCase() + field.slice(1), local[part][field], server[part][field], field === "password");
      }
      let custom = new Map([...server.body.customFields || [], ...local.body.customFields || []].map((field) => [field.id, field]));
      for (let [id, field] of custom) {
        let mine = local.body.customFields?.find((entry) => entry.id === id);
        let theirs = server.body.customFields?.find((entry) => entry.id === id);
        addChoice(`custom:${id}`, field.label || "Field", mine?.value || (mine ? "" : "(deleted)"), theirs?.value || (theirs ? "" : "(deleted)"), field.type === "password");
      }
    }
    $("conflict-merge").onclick = () => { $("merge-fields").classList.remove("hidden"); $("conflict-apply-merge").classList.remove("hidden"); $("conflict-merge").classList.add("hidden"); };
    $("conflict-apply-merge").onclick = () => {
      let custom = new Map();
      for (let field of [...server.body.customFields || [], ...local.body.customFields || []]) {
        let source = selected.get(`custom:${field.id}`) === "server" ? server : local;
        let picked = source.body.customFields?.find((entry) => entry.id === field.id);
        if (picked) custom.set(field.id, picked);
        else custom.delete(field.id);
      }
      const customFields = [...custom.values()];
      finish({ kind: "merge", item: { itemId: local.itemId, index: { ...local.index, title: selected.get("title") === "server" ? server.index.title : local.index.title, website: selected.get("website") === "server" ? server.index.website : local.index.website, itemType: itemKind(customFields), favorite: features.isFavorite(customFields) }, body: { username: selected.get("username") === "server" ? server.body.username : local.body.username, password: selected.get("password") === "server" ? server.body.password : local.body.password, customFields } } });
    };
    $("conflict-keep").onclick = () => finish("mine");
    $("conflict-server").onclick = () => finish("server");
    $("conflict-cancel").onclick = () => finish("cancel");
    dialog.showModal();
  });
}
function confirmAction(title, detail) {
  return new Promise((resolve) => {
    const dialog = $("confirm-dialog"), onLock = () => finish(false);
    const finish = (answer) => { window.removeEventListener('vaults:locked', onLock); dialog.close(); resolve(answer); };
    window.addEventListener('vaults:locked', onLock, { once: true });
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
    $("confirm-title").textContent = title;
    $("confirm-detail").textContent = detail;
    $("confirm-cancel").onclick = () => finish(false);
    $("confirm-accept").onclick = () => finish(true);
    dialog.showModal();
  });
}
function showEmpty() {
  currentItem = null;
  window.dispatchEvent(new CustomEvent("vaults:detail-item", { detail: null }));
  $("item-empty").hidden = false;
  $("item-view").hidden = true;
  $("item-form").hidden = true;
}
function beginEdit(item = currentItem, preserveDraft = false) {
  editorPasskeyFields = (item?.body.customFields || []).filter(f => f.id === PASSKEY_META || f.id === PASSKEY_KEY);
  if (!preserveDraft && !confirmDiscard()) return;
  editorBaseline = null;
  const prefilledDraft = item && item !== currentItem;
  window.dispatchEvent(new Event("vaults:clear-generator"));
  $("item-id").value = item?.itemId ?? "";
  $("title").value = item?.index.title ?? "";
  $("url").value = item?.index.website ?? "";
  $("item-username").value = item?.body.username ?? "";
  $("item-password").value = item?.body.password ?? "";
  $("item-password").type = "password";
  setPasswordVisibilityButton($("toggle-edit-password"), false);
  window.dispatchEvent(
    new CustomEvent("vaults:set-editor-fields", {
      detail: item?.body.customFields ?? [],
    }),
  );
  showItemKind(itemKind(item?.body.customFields), true);
  $("form-title").textContent = item ? "Edit item" : "Create item";
  $("save").textContent = "Save";
  $("item-empty").hidden = true;
  $("item-view").hidden = true;
  $("item-form").hidden = false;
  $("title").focus();
  requestAnimationFrame(() => { editorBaseline = prefilledDraft ? "prefilled-unsaved-draft" : editorSnapshot(); updateSessionDates(); });
}
function clearItem() {
  editorPasskeyFields = [];
  editorBaseline = null;
  currentItem = null;
  window.dispatchEvent(new Event("vaults:clear-generator"));
  for (let x of ["item-id", "title", "url", "item-username", "item-password"])
    $(x).value = "";
  $("item-password").type = "text";
  window.dispatchEvent(
    new CustomEvent("vaults:set-editor-fields", { detail: [] }),
  );
  renderCustomFields([], "");
  for (const name of ['view-title', 'view-username', 'view-url']) $(name).textContent = '';
  $('view-url').removeAttribute('href'); $('view-password').textContent = '••••••••••••';
  $("save").textContent = "Save";
  showEmpty();
}
function wipeInputs(all = true) {
  $("master").value = "";
  $("secret").value = "";
  if (all) {
    $('registration-master').value = ''; $('registration-master-confirm').value = '';
    generatedAccountSecret = ''; $('account-secret-display').textContent = '';
  }
  if (all) clearItem();
}
function arm() {
  clearTimeout(sessionTimer);
  const requested = Number(localStorage.getItem("127vaults:lock-minutes") || 30);
  const minutes = [5, 15, 30, 60].includes(requested) ? requested : 30;
  if (root && lockDeadline && Date.now() >= lockDeadline) { void lock(); return; }
  lockDeadline = Date.now() + minutes * 60 * 1000;
  sessionTimer = setTimeout(
    () => {
      lock();
      msg(`Locked after ${minutes} minutes of inactivity.`);
    },
    minutes * 60 * 1000,
  );
}
async function lock(logout = true) {
  stopLicenseStatus();
  const logoutToken = csrf;
  ++sessionGeneration;
  reconnectCredentials?.password.fill(0); reconnectCredentials?.secret.fill(0);
  reconnectCredentials = null; serverAuthenticated = false; lockDeadline = 0;
  passkeyVerifier?.value.fill(0);
  passkeyVerifier = null;
  editorPasskeyFields = [];
  publishOwnershipRequests();
  editorBaseline = null; favoritesOnly = false; favoriteItems = []; lastSynced = lastLocalChange = null; syncState = "idle";
  window.dispatchEvent(new Event('vaults:locked'));
  window.dispatchEvent(new Event("vaults:clear-generator"));
  clearTimeout(sessionTimer);
  core?.lock();
  root = vault = catalogue = null; licenseEntitlement = null;
  vaultId = csrf = authContext = null;
  replica = null; loadedItems = []; availableVaults = []; vaultSettings = { version: 1, names: {}, collections: [], default_view: null, removal_preference: null }; settingsRevision = null;
  browseView = null; browseItems = []; publishSettings(); applyDefaultView = false;
  window.__vaultsLifecycle = { retired: [], pending: null }; window.dispatchEvent(new CustomEvent('vaults:lifecycle', { detail: window.__vaultsLifecycle }));
  publishVaults([]); renderItems([]);
  wipeInputs();
  $("vault").hidden = true;
  $("entry-shell").hidden = false;
  if ($("settings").open) $("settings").close();
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  setBusy(false);
  window.dispatchEvent(
    new CustomEvent("vaults:devices", {
      detail: { devices: [], currentDeviceId: null },
    }),
  );
  $("lock").disabled = true;
  $("state").textContent = "Locked";
  if (ownerSetupRequired)
    showRegistration();
  else showLogin();
  // Clear decrypted state synchronously, before any slow/offline logout request.
  if (logout && logoutToken) void remoteCall('/api/v1/session', { method: 'DELETE', token: logoutToken }).catch(() => {});
}
function showLogin() {
  $("registration-flow").hidden = true;
  $("login-flow").hidden = false;
  $("login-password-step").hidden = true;
  $("login-username-step").hidden = false;
  $("access-step").textContent = "";
  $("username").value = identity?.username || $("username").value;
  if (installedApp && identity) { showLoginPassword(); return; }
  $("username").focus();
}
function showLoginPassword() {
  if (!startupReady) return;
  let username = $("username").value.trim();
  if (!username) {
    $("username").focus();
    return;
  }
  if (!identity) {
    status(
      "login-status",
      "Register this device below, then unlock with your account secret and master password once.",
      "error",
    );
    return;
  }
  $("login-account-name").textContent = username;
  $("legacy-secret-field").hidden = reusableSecret(identity);
  $("login-username-step").hidden = true;
  $("login-password-step").hidden = false;
  $("master").focus();
}
function showRegistration() {
  generatedAccountSecret = hex(crypto.getRandomValues(new Uint8Array(32)));
  $("account-secret-display").textContent = generatedAccountSecret;
  $("registration-flow").hidden = false;
  $("login-flow").hidden = true;
  setRegistrationStep(0);
  $("registration-username").value = $("username").value;
  $("registration-username").focus();
}
function setRegistrationStep(next) {
  registrationStep = Math.max(0, Math.min(3, next));
  for (let step of document.querySelectorAll(".registration-step"))
    step.hidden = Number(step.dataset.registrationStep) !== registrationStep;
  for (let [i, dot] of [...$("registration-progress").children].entries()) {
    dot.classList.toggle("active", i <= registrationStep);
    dot.classList.toggle("!bg-[#E0BB95]", i <= registrationStep);
  }
}
function advanceRegistration() {
  if (registrationStep === 0) {
    let username = $("registration-username").value.trim();
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{4,63}$/.test(username)) {
      status(
        "setup-status",
        "Enter a valid username (5–64 characters).",
        "error",
      );
      return;
    }
    if (!$("bootstrap").value.trim()) {
      status("setup-status", "Enter the bootstrap code.", "error");
      return;
    }
  }
  if (
    registrationStep === 1 &&
    (!$("display").value.trim() || !$("email").checkValidity())
  ) {
    status("setup-status", "Enter a display name and valid email.", "error");
    return;
  }
  status("setup-status", "");
  setRegistrationStep(registrationStep + 1);
}
function showSettingsView(name) {
  window.dispatchEvent(new CustomEvent("vaults:settings-view", { detail: name }));
  for (let button of document.querySelectorAll(".settings-tab")) {
    const selected = button.dataset.settingsView === name;
    button.classList.toggle("active", selected);
    button.classList.toggle("bg-[#E0BB95]/12", selected);
    button.classList.toggle("text-[#E0BB95]", selected);
    button.classList.toggle("shadow-sm", selected);
  }
  $("settings-profile").hidden = name !== "profile";
  $("settings-devices").hidden = name !== "devices";
  $("settings-vaults").hidden = name !== "vaults";
  $("settings-preferences").hidden = name !== "preferences";
  if (name === "devices") reloadDevices();
}
function showDeviceRegistration(show) {
  $("devices-list-page").hidden = show;
  $("device-registration-page").hidden = !show;
  if (show) $("enrollment-request").focus();
}
function openPendingDesktopEnrollment() {
  let code = new URLSearchParams(location.search).get("enrollDevice");
  if (!root || !/^[A-HJ-NP-Z2-9]{8}$/.test(code || "")) return false;
  $("profile-username").textContent = identity?.username || "";
  showSettingsView("devices");
  showDeviceRegistration(true);
  $("enrollment-request").value = code;
  if (!$("settings").open) $("settings").showModal();
  status("enrollment-status", "Confirm this one-time code to register your desktop.");
  $("begin-enrollment").focus();
  return true;
}
function setBusy(v) {
  busy = v;
  document.body.setAttribute("aria-busy", String(v));
  for (let b of document.querySelectorAll(
    "#save,#new-item,#create-vault,#web-create-vault-submit,#login-next,#login,#setup,#begin-enrollment,#complete-enrollment,#reload,#mobile-sync,#register-browser-device,#browser-enrollment-check",
  ))
    b.disabled =
      v ||
      (b.id === "save" && !vault) ||
      (b.id === "new-item" && !vault) ||
      (b.id === "lock" && !root);
}
window.addEventListener("vaults:workspace-activity", () => { if (root) arm(); });
window.__vaultsActions = {
  acceptOwnership,
  copyField,
  closeWorkspaceItem: () => { if (!confirmDiscard()) return false; clearItem(); renderItems(loadedItems); return true; },
  openWorkspaceItem: async (tab) => {
    if (!confirmDiscard()) return;
    if (tab.vaultId !== vaultId) await selectVault(tab.vaultId, true);
    if (!root || tab.vaultId !== vaultId) throw Error("Item vault is unavailable");
    $("items").dataset.requestedItem = tab.itemId;
    await openItem(tab.itemId, tab.index);
  },
  openCreateVaultDialog,
  openRenameVaultDialog,
  selectVault,
  openItem: async ({ row, index }, button) => {
    if (!confirmDiscard()) return;
    if (row.vaultId && row.vaultId !== vaultId) await selectVault(row.vaultId, true);
    $("items").dataset.requestedItem = row.itemId;
    return openItem(row.itemId, index, button);
  },
  runAction: (id) => {
    $("search").value = "";
    renderItems(loadedItems);
    if (id === "new-item") beginEdit(null);
    else if (id === "edit-item" && currentItem) beginEdit();
    else if (id === "create-vault") openCreateVaultDialog();
    else if (id === "reload") return syncInstalled().catch(() => msg("Vault refresh failed.", "error"));
    else if (id === "settings") $("settings-toggle").click();
    else if (id === "lock" && confirmDiscard()) lock();
  },
  revokeDevice,
  selectBrowseView, openCollectionDialog, removeCollection, setDefaultView,
  manageVault, cancelVaultRemoval,
  healthItems: async () => {
    const sessionRoot = root;
    const data = await call('/api/v1/vaults');
    const result = [];
    for (const row of data.vaultEnvelopes.filter(row => !row.retired)) {
      if (!sessionRoot || root !== sessionRoot) throw Error('LOCKED');
      const healthVault = core.open_private_vault(sessionRoot, un(data.directory), id(row.vaultId), un(row.envelope));
      try {
      const listed = await call(`/api/v1/vaults/${row.vaultId}/items`);
      verifyListedCatalogue(healthVault, listed);
      const healthCatalogue = un(listed.catalogue);
      const revision = uuid(healthCatalogue.slice(44, 60));
      for (const summary of listed.indices) {
        if (root !== sessionRoot) throw Error('LOCKED');
        const index = JSON.parse(td.decode(core.decrypt_private_part(healthVault, healthCatalogue, id(summary.itemId), un(summary.envelope), 4)));
        const got = await call(`/api/v1/vaults/${row.vaultId}/items/${summary.itemId}?catalogueRevision=${revision}`);
        if (root !== sessionRoot) throw Error('LOCKED');
        const body = JSON.parse(td.decode(core.decrypt_private_part(healthVault, healthCatalogue, id(summary.itemId), un(got.envelope), 3)));
        result.push({ itemId: summary.itemId, vaultId: row.vaultId, title: index.title, password: body.password, customFields: body.customFields || [] });
      }
      } finally { if (root === sessionRoot) core.release_vault(healthVault); healthVault.free?.(); }
    }
    return result;
  },
  openHealthItem: async (itemId, ownerVault) => {
    if (!confirmDiscard()) return;
    if (ownerVault && ownerVault !== vaultId) await selectVault(ownerVault);
    const row = loadedItems.find(x => x.row.itemId === itemId);
    if (row) { $("items").dataset.requestedItem = itemId; await openItem(itemId, row.index); }
  },
};
$("setup").onclick = setup;
$("login-next").onclick = showLoginPassword;
$("login-back").onclick = showLogin;
$("show-registration").onclick = showRegistration;
$("registration-exit").onclick = showLogin;
for (let button of document.querySelectorAll(".registration-next"))
  button.onclick = advanceRegistration;
for (let button of document.querySelectorAll(".registration-back"))
  button.onclick = () => setRegistrationStep(registrationStep - 1);
$("copy-account-secret").onclick = async () => {
  await navigator.clipboard.writeText(generatedAccountSecret);
  status("setup-status", "Account secret copied.");
};
$("registration-master-confirm").onkeydown = (e) => {
  if (e.key === "Enter") setup();
};
$("username").onkeydown = (e) => {
  if (e.key === "Enter") showLoginPassword();
};
$("master").onkeydown = (e) => {
  if (e.key === "Enter") login();
};
$("login").onclick = login;
$("lock").onclick = () => { if (confirmDiscard()) void lock(); };
$("lock-app").onclick = () => { if (confirmDiscard()) void lock(); };
$("create-vault").onclick = openCreateVaultDialog;
$("web-create-vault-form").onsubmit = submitVaultDialog;
$("web-create-vault-cancel").onclick = () => $("web-create-vault-dialog").close();
$("new-item").onclick = () => beginEdit(null);
$("duplicate-item").onclick = () => { if (!currentItem || !!readMetadata(currentItem.body.customFields)) return; beginEdit({ ...structuredClone(currentItem), itemId: null, index: { ...currentItem.index, title: `${currentItem.index.title} (copy)` }, body: { ...currentItem.body, customFields: features.setFavorite(currentItem.body.customFields || [], false) } }); $("form-title").textContent = 'Create a copy'; };
$("favorite-item").onclick = async () => {
  if (!currentItem || busy) return;
  const item = { ...structuredClone(currentItem), body: { ...currentItem.body, customFields: features.setFavorite(currentItem.body.customFields || [], !features.isFavorite(currentItem.body.customFields)) } };
  beginEdit(item);
  // Wait for React to populate all typed and custom fields before encrypting.
  await new Promise(resolve => requestAnimationFrame(resolve));
  await save({ preventDefault() {} });
};
$("password-health").onclick = () => { if (root) window.dispatchEvent(new Event('vaults:health')); };
$("nav-favorites").onclick = async () => {
  if (busy || !confirmDiscard()) return;
  setBusy(true);
  try { browseView = null; publishSettings(); favoriteItems = await loadFavorites(); clearItem(); favoritesOnly = true; renderItems(loadedItems); $("vault-title").textContent = 'Favorites'; $("vault-state").textContent = 'All active vaults'; }
  catch (error) { toast('Favorites unavailable', safeError(error), 'error'); }
  finally { setBusy(false); }
};
$("item-form").addEventListener('input', () => updateSessionDates());
$("edit-item").onclick = () => beginEdit();
$("delete-item").onclick = () => void deleteItem();
$("cancel-edit").onclick = () => {
  if (!confirmDiscard()) return;
  currentItem
    ? displayItem(
        currentItem,
        document.querySelector(`[data-item-id="${currentItem.itemId}"]`),
      )
    : clearItem();
};
$("close-item-detail").onclick = () => { if (!confirmDiscard()) return; clearItem(); renderItems(loadedItems); };
$("nav-all-items").onclick = () => selectBrowseView({ kind: 'all' }).catch(error => toast('All items could not be opened', safeError(error), 'error'));
$("reload").onclick = () => syncInstalled().catch(error => toast("Sync failed", safeError(error), "error"));
for (const [id, key, fallback] of [["preference-lock-minutes", "127vaults:lock-minutes", "30"], ["preference-clipboard-seconds", "127vaults:clipboard-seconds", "30"]]) {
  const control = $(id);
  control.value = localStorage.getItem(key) || fallback;
  control.onchange = () => { localStorage.setItem(key, control.value); if (id === "preference-lock-minutes" && root) arm(); };
}
$("mobile-sync").onclick = async () => {
  try { await syncInstalled(); if (!installedApp) toast("Sync complete", "The latest server version is loaded.", "success"); }
  catch (error) { toast("Sync failed", safeError(error), "error"); }
};
$("session-footer").oncontextmenu = (event) => {
  event.preventDefault();
  $("session-menu").classList.remove("hidden");
};
$("session-menu").onmouseleave = () => $("session-menu").classList.add("hidden");
$("footer-sync").onclick = async () => {
  $("session-menu").classList.add("hidden");
  try { await syncInstalled(); if (!installedApp) toast("Sync complete", "The latest server version is loaded.", "success"); }
  catch (error) { toast("Sync failed", safeError(error), "error"); }
};
$("footer-use-server").onclick = async () => {
  $("session-menu").classList.add("hidden");
  let choice = await resolveConflict();
  if (choice !== "server") return;
  try { await reload(); clearItem(); toast("Server version restored", "Local unsaved edits were discarded.", "success"); }
  catch (error) { toast("Server version unavailable", safeError(error), "error"); }
};
$("reload-devices").onclick = async () => { await reloadDevices(); await reloadOwnershipRequests(); };
$("begin-enrollment").onclick = beginEnrollment;
$("complete-enrollment").onclick = completeEnrollment;
$("settings-toggle").onclick = () => {
  $("profile-username").textContent = identity?.username || "";
  $("profile-device").textContent = identity?.deviceId || "Unavailable";
  $("profile-secret-status").textContent = installedApp && reusableSecret(identity) ? "Remembered on this registered device" : reusableSecret(identity) ? `Remembered in this browser until ${new Date(identity.secretExpiresAt || Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}` : "Required at next unlock";
  showSettingsView("profile");
  $("settings").showModal();
};
$("close-settings").onclick = () => $("settings").close();
for (let button of document.querySelectorAll(".settings-tab"))
  button.onclick = () => showSettingsView(button.dataset.settingsView);
$("show-device-registration").onclick = () => showDeviceRegistration(true);
$("cancel-device-registration").onclick = () => showDeviceRegistration(false);
$("add-custom-field").onclick = () => addCustomField();
window.addEventListener("vaults:item-type", (event) => showItemKind(event.detail, true));
$("reveal-password").onclick = () => {
  let hidden = $("view-password").textContent.startsWith("•");
  $("view-password").textContent = hidden
    ? currentItem?.body.password || "—"
    : "••••••••••••";
  setPasswordVisibilityButton($("reveal-password"), hidden);
};
$("toggle-edit-password").onclick = () => {
  let input = $("item-password"),
    show = input.type === "password";
  input.type = show ? "text" : "password";
  setPasswordVisibilityButton($("toggle-edit-password"), show);
};
async function copyField(value) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
  setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), Number(localStorage.getItem("127vaults:clipboard-seconds") || 30) * 1000);
}
$("copy-username").onclick = () => copyField(currentItem?.body.username);
$("copy-password").onclick = () => copyField(currentItem?.body.password);
$("search").oninput = () => renderItems(loadedItems);
$("items").onkeydown = (e) => {
  let rows = [...$("items").querySelectorAll("[data-item-id]")],
    at = rows.indexOf(document.activeElement);
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  let next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? rows.length - 1
        : Math.max(
            0,
            Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)),
          );
  rows[next]?.focus();
};
document.addEventListener('keydown', event => {
  if (!root || document.querySelector('dialog[open]') || document.querySelector('[aria-labelledby="password-health-title"]')) return;
  const modifier = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
  if (modifier && ['k', 'f', 'n', 's'].includes(key)) {
    event.preventDefault();
    if (['k', 'f'].includes(key)) $("search").focus();
    if (key === 'n') $("new-item").click();
    if (key === 's' && !$("item-form").hidden && !busy) $("item-form").requestSubmit();
  }
  if (event.key === 'Escape' && !$("item-form").hidden) { event.preventDefault(); $("cancel-edit").click(); }
  if (event.key === 'ArrowDown' && event.target === $("search")) { event.preventDefault(); $("items").querySelector('[data-item-id]')?.focus(); }
});
$("item-form").onsubmit = save;
for (let n of ["pointerdown", "keydown"])
  document.addEventListener(n, (e) => {
    if (e.isTrusted && root) arm();
  });
window.addEventListener("pagehide", () => {
  void lock(false);
});
window.addEventListener('pageshow', () => { if (root && Date.now() >= lockDeadline) void lock(); });
window.addEventListener('focus', () => { if (root && Date.now() >= lockDeadline) void lock(); });
if ($('register-browser-device')) {
  $('register-browser-device').onclick = registerBrowserDevice;
  $('browser-enrollment-check').onclick = checkBrowserApproval;
  $('browser-enrollment-cancel').onclick = () => $('browser-enrollment-dialog').close();
}
if ($('web-collection-form')) {
  $('web-collection-form').onsubmit = saveCollection;
  $('web-collection-cancel').onclick = () => $('web-collection-dialog').close();
}
try {
  setBusy(true);
  await init();
  window.addEventListener("vaults:generate-secret", (event) => {
    try {
      if (!root || busy) throw new Error("Unlock the vault and wait for the current operation to finish");
      event.detail.resolve(generate_secret(JSON.stringify(event.detail.options)));
    } catch (error) { event.detail.reject(error); }
  });
  core = new ExperimentalEcf1Core();
  identity = await loadIdentity();
  if (identity) {
    $("username").value = identity.username;
    $("device").value = identity.deviceId;
  }
  let setupState;
  try { setupState = await call("/api/v1/setup"); }
  catch (error) {
    if (!installedApp || !identity || !networkUnavailable(error)) throw error;
    setupState = { ownerRequired: false };
  }
  ownerSetupRequired = setupState.ownerRequired === true;
  $("show-registration").hidden = !ownerSetupRequired;
  if ($('register-browser-device')) $('register-browser-device').hidden = ownerSetupRequired || !!identity;
  $("registration-exit").hidden = ownerSetupRequired;
  $("setup-guidance").textContent = setupState.licenseMode === "active"
    ? "Your server license is active. Run install bootstrap on the server and enter its one-time code below."
    : "Install a signed license on the server, then run install bootstrap and enter its one-time code below.";
  startupReady = true;
  setBusy(false);
  if (ownerSetupRequired) showRegistration();
  else showLogin();
  msg(ownerSetupRequired ? "Create the first owner for this server." : identity ? "Ready to sign in." : "This browser needs device enrollment from an existing user.");
  $("state").textContent = ownerSetupRequired ? "First owner setup" : "Locked";
} catch (e) {
  msg(
    "Secure client or server setup status is unavailable. Reload the page; if it repeats, check server readiness.",
    "error",
  );
  $("state").textContent = "Unavailable";
  setBusy(true);
}
