import init, {
  ExperimentalEcf1Core,
  ExperimentalOpaqueBridge,
} from "/wasm/vaults_browser_fixture.js";
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
  generatedAccountSecret = "",
  lastSynced = null,
  lastLocalChange = null;
const updateSessionDates = () => {
  let node = $("session-dates");
  if (!node) return;
  let time = (value) => value ? value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  node.textContent = `Local change ${time(lastLocalChange)} · Server sync ${time(lastSynced)}`;
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
async function call(path, { method = "GET", body, token = csrf } = {}) {
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
  if (!r.ok) throw Error(v.error ?? `HTTP_${r.status}`);
  return v;
}
function reusableSecret(identityRecord) {
  return Boolean(identityRecord && (identityRecord.secretExpiresAt === undefined || identityRecord.secretExpiresAt > Date.now()) && (identityRecord.secretEnvelope || identityRecord.accountSecret));
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
const safeError = (e) =>
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
}
function publishVaults(rows) {
  window.__vaultsSnapshot = rows;
  window.dispatchEvent(new CustomEvent("vaults:vaults", { detail: rows }));
}
async function saveVaultName(vaultId, name) {
  const next = { ...vaultSettings, names: { ...vaultSettings.names, [vaultId]: name } };
  const encrypted = core.encrypt_account_settings(root, te.encode(JSON.stringify(next)));
  const revision = uuid(encrypted.slice(76, 92));
  await call("/api/v1/vault-settings", { method: "PUT", body: { baseRevision: settingsRevision, revision, envelope: b64(encrypted) } });
  settingsRevision = revision;
  vaultSettings = next;
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
async function loadIdentity() {
  let s = await db();
  return new Promise((ok, no) => {
    let q = s.get("active");
    q.onsuccess = () => ok(q.result);
    q.onerror = () => no(q.error);
  });
}
async function saveIdentity(v) {
  let s = await db("readwrite");
  return new Promise((ok, no) => {
    let q = s.put(v, "active");
    q.onsuccess = () => ok();
    q.onerror = () => no(q.error);
  });
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
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 },
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
  return { salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext) };
}
async function recoverAccountSecret(envelope, password) {
  try {
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
          iterations: 310000,
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
      secretEnvelope,
      secretExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    identity = await loadIdentity();
    $("device").value = deviceId;
    $("bootstrap").value = "";
    $("master").value = "";
    core.lock();
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
async function login() {
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
    stage = "verifying account credentials";
    status("login-status", "Verifying credentials…");
    let start = ExperimentalOpaqueBridge.client_login_start(secret, password),
      request = start.message(),
      begun = await call("/api/v1/auth/", {
        method: "POST",
        body: {
          username: identity.username,
          deviceId: identity.deviceId,
          request: b64(request),
        },
      });
    csrf = begun.csrf;
    let binding = un(begun.binding),
      challenge = un(begun.challenge),
      finish = ExperimentalOpaqueBridge.client_login_finish(
        start.state(),
        secret,
        password,
        challenge,
        binding,
      ),
      finalization = finish.message();
    stage = "verifying encrypted root";
    let wrapped = await call(`/api/v1/auth/${begun.attemptId}/password`, {
        method: "POST",
        body: { finalization: b64(finalization) },
      }),
      descriptor = un(wrapped.descriptor),
      envelope = un(wrapped.envelope),
      verified = await verifyRootTag(
        finish.session_key(),
        binding,
        request,
        challenge,
        finalization,
        descriptor,
        envelope,
        un(wrapped.tag),
      );
    root = core.unwrap_root(envelope, descriptor, password, secret);
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
    stage = "opening private vault";
    let logged = await call(`/api/v1/auth/${begun.attemptId}/device-proof`, {
      method: "POST",
      body: { signature: b64(signature) },
    });
    csrf = logged.csrf;
    await reload();
    if (!identity.secretExpiresAt || !reusableSecret(identity) || identity.accountSecret) {
      try {
        const nextIdentity = { ...identity, secretEnvelope: await protectAccountSecret($("secret").value || identity.accountSecret, $("master").value), secretExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 };
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
    void call('/api/v1/license').then((license) => {
      if (!$("vault").hidden) $("state").textContent = `Unlocked · license ${license.mode}${license.enforcement === 'disabled' ? ' (experimental)' : ''}`;
    }).catch(() => { /* Older servers may not expose license status. */ });
    arm();
    await reloadDevices();
    queueMicrotask(openPendingDesktopEnrollment);
  } catch (e) {
    lock(false);
    let detail =
      e.message.startsWith("This device ") ||
      e.message.startsWith("The username ")
        ? e.message
        : safeError(e);
    status("login-status", `${stage}: ${detail}`, "error");
    msg(`Login did not complete: ${detail}`, "error");
  } finally {
    setBusy(false);
  }
}
async function reload() {
  await loadVaultSettings();
  let data = await call("/api/v1/vaults");
  lastSynced = new Date();
  updateSessionDates();
  if (!data.directory || !data.vaultEnvelopes.some((row) => !row.retired)) {
    availableVaults = [];
    publishVaults([]);
    vault = catalogue = null;
    vaultId = null;
    loadedItems = [];
    showEmpty();
    renderItems([]);
    $("vault-state").textContent = "No vault yet";
    $("vault-title").textContent = "No vault";
    $("nav-count").textContent = "0";
    $("create-vault").disabled = false;
    $("new-item").disabled = true;
    $("save").disabled = true;
    return;
  }
  let directory = un(data.directory),
    chosen = data.vaultEnvelopes.find((row) => row.vaultId === vaultId && !row.retired) || data.vaultEnvelopes.find((row) => !row.retired),
    activeRows = data.vaultEnvelopes.filter((row) => !row.retired);
  if (!chosen) throw Error("NO_ACTIVE_VAULT");
  availableVaults = activeRows.map((row, index) => ({ vaultId: row.vaultId, name: vaultSettings.names[row.vaultId] || (index === 0 ? "Private" : `Vault ${index + 1}`), selected: row.vaultId === chosen.vaultId }));
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
    items.push({ row, index });
  }
  items.sort(
    (a, b) =>
      (a.index.title || "").localeCompare(b.index.title || "", undefined, {
        sensitivity: "base",
        numeric: true,
      }) || (a.index.website || "").localeCompare(b.index.website || ""),
  );
  vaultId = nextVaultId;
  vault = nextVault;
  catalogue = nextCatalogue;
  loadedItems = items;
  renderItems(items);
  $("vault-state").textContent =
    `${items.length} item${items.length === 1 ? "" : "s"}`;
  $("nav-count").textContent = String(items.length);
  $("create-vault").disabled = false;
  $("new-item").disabled = false;
  $("save").disabled = false;
}
function renderItems(items) {
  let query = $("search").value.trim().toLowerCase();
  let filtered = items.filter((x) =>
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
        empty: query ? "No matching items." : "This vault has no items yet.",
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
) {
  let sync = await call(
      `/api/v1/vaults/${vaultId}/operations?cursor=0&limit=500`,
    ),
    previous =
      [...(sync.operations ?? [])]
        .reverse()
        .find((x) => x.operation.deviceId === identity.deviceId)?.operation
        .opId ?? null,
    framed = cat(
      be(catalogueBytes.length, 4),
      catalogueBytes,
      be(indexBytes.length, 4),
      indexBytes,
      be(bodyBytes.length, 4),
      bodyBytes,
    ),
    body = {
      protocolVersion: 1,
      tenantId: authContext.tenantId,
      vaultId,
      deviceId: identity.deviceId,
      epoch: authContext.epoch,
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
          identity.privateKey,
          te.encode(canonical({ ...body, opId })),
        ),
      ),
    );
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
      let type = row.querySelector("select").value,
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
  return [...metadata, ...typed, ...custom];
}
function renderCustomFields(fields = [], password = "") {
  window.dispatchEvent(
    new CustomEvent("vaults:view-fields", { detail: { fields, password } }),
  );
}
const itemKinds = {
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
function displayItem(item, button) {
  currentItem = item;
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
  $("view-password").textContent = "••••••••••••";
  $("reveal-password").textContent = "Reveal";
  renderCustomFields(item.body.customFields, item.body.password || "");
  $("item-empty").hidden = true;
  $("item-form").hidden = true;
  $("item-view").hidden = false;
}
async function openItem(itemId, index, button) {
  const requestedItem = itemId;
  $("items").setAttribute("aria-busy", "true");
  try {
    let item = await fetchItem(itemId, index);
    if ($("items").dataset.requestedItem === requestedItem)
      displayItem(item, button);
  } catch (e) {
    if ($("items").dataset.requestedItem === requestedItem)
      toast("Item could not be opened", `${safeError(e)} Try syncing and select the item again.`, "error");
  } finally {
    if ($("items").dataset.requestedItem === requestedItem)
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
window.__vaultsExtensionActions = {
  async lock() {
    await lock();
    return true;
  },
  list() {
    if (!root || !vault || !catalogue) return { locked: true, items: [] };
    arm();
    return {
      locked: false,
      vaultId,
      items: loadedItems
        .filter(({ index }) => index?.website && (!index?.type || index.type === "login"))
        .map(({ row, index }) => ({ itemId: row.itemId, title: index.title || "Untitled login", website: index.website })),
    };
  },
  async credential(itemId, requestedVaultId) {
    if (!root || !vault || !catalogue || requestedVaultId !== vaultId) throw Error("VAULT_LOCKED_OR_CHANGED");
    const found = loadedItems.find(({ row }) => row.itemId === itemId);
    if (!found || !found.index.website) throw Error("ITEM_NOT_FOUND");
    const activeVault = vault;
    const item = await fetchItem(itemId, found.index);
    if (!root || vault !== activeVault || requestedVaultId !== vaultId) throw Error("VAULT_LOCKED_OR_CHANGED");
    if (itemKind(item.body.customFields) !== "login") throw Error("NOT_A_LOGIN_ITEM");
    arm();
    return { itemId, website: found.index.website, username: item.body.username || "", password: item.body.password || "" };
  },
};
function openCreateVaultDialog() {
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
      ).PrivateVaultClient({ core, root, csrf }),
      newId = await client.create(un(data.directory));
    accepted = true;
    vaultId = newId;
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
async function selectVault(nextVaultId) {
  if (!availableVaults.some((row) => row.vaultId === nextVaultId)) return;
  vaultId = nextVaultId;
  clearItem();
  try { await reload(); }
  catch (error) { toast("Vault could not be opened", safeError(error), "error"); }
}
async function save(event) {
  event.preventDefault();
  let titleInput = $("title"), titleError = $("title-error");
  titleInput.setAttribute("aria-invalid", String(!titleInput.value.trim()));
  titleError.classList.toggle("hidden", !!titleInput.value.trim());
  if (!titleInput.value.trim()) { titleInput.focus(); return; }
  setBusy(true);
  let draft, accepted = false;
  try {
    let itemId = $("item-id").value || null,
      index = {
        title: $("title").value.trim(),
        website: normalizeWebsite($("url").value),
      },
      body = {
        username: $("item-username").value,
        password: $("item-password").value,
        customFields: collectCustomFields(),
      };
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
    await call(
      `/api/v1/vaults/${vaultId}/items${itemId ? `/${itemId}` : ""}`,
      { method: itemId ? "PUT" : "POST", body: payload },
    );
    accepted = true;
    let acceptedRevision = uuid(made.catalogue().slice(44, 60));
    catalogue = made.catalogue();
    lastLocalChange = new Date();
    lastSynced = new Date();
    updateSessionDates();
    clearItem();
    await reload();
    if (uuid(catalogue.slice(44, 60)) !== acceptedRevision) throw Error("SAVE_REVISION_MISMATCH");
    let summary = loadedItems.find((row) => row.row.itemId === newId);
    if (!summary) throw Error("SAVED_ITEM_MISSING");
    displayItem(await fetchItem(newId, summary.index));
    toast(itemId ? "Item updated" : "Item created", "Your encrypted change was saved successfully.", "success");
  } catch (e) {
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
        await reload();
        let summary = loadedItems.find((row) => row.row.itemId === draft?.itemId);
        if (summary) serverItem = await fetchItem(summary.row.itemId, summary.index);
      } catch (loadError) {
        serverLoadFailed = true;
        toast("Server version could not be loaded", safeError(loadError), "error");
      }
      if (serverLoadFailed) { beginEdit(draft); return; }
      let choice = await resolveConflict(draft, serverItem);
      if (choice === "mine") {
        beginEdit(serverItem ? draft : { ...draft, itemId: null });
        await new Promise(requestAnimationFrame);
        await save(event);
      } else if (choice === "server") {
        if (serverItem) displayItem(serverItem); else clearItem();
        toast("Server version restored", "Your unsaved local edit was discarded.", "success");
      } else if (choice?.kind === "merge") {
        beginEdit(choice.item);
        await new Promise(requestAnimationFrame);
        await save(event);
      } else if (draft) {
        beginEdit(draft);
      }
    } else toast("Item was not saved", messages[e.message] || `${safeError(e)} Check the highlighted values and try again.`, "error");
    if (e.message === "WEBSITE_INVALID") $("url").focus();
    else if (e.message.startsWith("CUSTOM_FIELD_"))
      document.querySelector("#custom-fields .custom-label:invalid")?.focus();
  } finally {
    setBusy(false);
  }
}
function resolveConflict(local, server) {
  return new Promise((resolve) => {
    let dialog = $("conflict-dialog"), finish = (choice) => { dialog.close(); resolve(choice); };
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
      finish({ kind: "merge", item: { itemId: local.itemId, index: { title: selected.get("title") === "server" ? server.index.title : local.index.title, website: selected.get("website") === "server" ? server.index.website : local.index.website }, body: { username: selected.get("username") === "server" ? server.body.username : local.body.username, password: selected.get("password") === "server" ? server.body.password : local.body.password, customFields: [...custom.values()] } } });
    };
    $("conflict-keep").onclick = () => finish("mine");
    $("conflict-server").onclick = () => finish("server");
    $("conflict-cancel").onclick = () => finish("cancel");
    dialog.showModal();
  });
}
function confirmAction(title, detail) {
  return new Promise((resolve) => {
    let dialog = $("confirm-dialog"), finish = (answer) => { dialog.close(); resolve(answer); };
    $("confirm-title").textContent = title;
    $("confirm-detail").textContent = detail;
    $("confirm-cancel").onclick = () => finish(false);
    $("confirm-accept").onclick = () => finish(true);
    dialog.showModal();
  });
}
function showEmpty() {
  currentItem = null;
  $("item-empty").hidden = false;
  $("item-view").hidden = true;
  $("item-form").hidden = true;
}
function beginEdit(item = currentItem) {
  $("item-id").value = item?.itemId ?? "";
  $("title").value = item?.index.title ?? "";
  $("url").value = item?.index.website ?? "";
  $("item-username").value = item?.body.username ?? "";
  $("item-password").value = item?.body.password ?? "";
  $("item-password").type = "password";
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
}
function clearItem() {
  for (let x of ["item-id", "title", "url", "item-username", "item-password"])
    $(x).value = "";
  $("item-password").type = "text";
  window.dispatchEvent(
    new CustomEvent("vaults:set-editor-fields", { detail: [] }),
  );
  renderCustomFields([], "");
  $("save").textContent = "Save";
  showEmpty();
}
function wipeInputs(all = true) {
  $("master").value = "";
  $("secret").value = "";
  if (all) clearItem();
}
function arm() {
  clearTimeout(sessionTimer);
  const minutes = Number(localStorage.getItem("127vaults:lock-minutes") || 30);
  sessionTimer = setTimeout(
    () => {
      lock();
      msg(`Locked after ${minutes} minutes of inactivity.`);
    },
    minutes * 60 * 1000,
  );
}
async function lock(logout = true) {
  clearTimeout(sessionTimer);
  try {
    if (logout && csrf) await call("/api/v1/session", { method: "DELETE" });
  } catch {}
  core?.lock();
  root = vault = catalogue = null;
  vaultId = csrf = authContext = null;
  wipeInputs();
  $("vault").hidden = true;
  $("entry-shell").hidden = false;
  if ($("settings").open) $("settings").close();
  window.dispatchEvent(
    new CustomEvent("vaults:devices", {
      detail: { devices: [], currentDeviceId: null },
    }),
  );
  $("lock").disabled = true;
  $("state").textContent = "Locked";
  if (new URLSearchParams(location.search).get("register") === "1")
    showRegistration();
  else showLogin();
}
function showLogin() {
  $("registration-flow").hidden = true;
  $("login-flow").hidden = false;
  $("login-password-step").hidden = true;
  $("login-username-step").hidden = false;
  $("access-step").textContent = "";
  $("username").value = identity?.username || $("username").value;
  $("username").focus();
}
function showLoginPassword() {
  let username = $("username").value.trim();
  if (!username) {
    $("username").focus();
    return;
  }
  if (!identity) {
    status(
      "login-status",
      "This device is not registered. Use the registration link below.",
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
    "#save,#new-item,#create-vault,#web-create-vault-submit,#login,#setup,#begin-enrollment,#complete-enrollment,#mobile-sync",
  ))
    b.disabled =
      v ||
      (b.id === "save" && !vault) ||
      (b.id === "new-item" && !vault) ||
      (b.id === "lock" && !root);
}
window.__vaultsActions = {
  openCreateVaultDialog,
  openRenameVaultDialog,
  selectVault,
  openItem: ({ row, index }, button) => {
    $("items").dataset.requestedItem = row.itemId;
    return openItem(row.itemId, index, button);
  },
  runAction: (id) => {
    $("search").value = "";
    renderItems(loadedItems);
    if (id === "new-item") beginEdit(null);
    else if (id === "edit-item" && currentItem) beginEdit();
    else if (id === "create-vault") openCreateVaultDialog();
    else if (id === "reload") reload().catch(() => msg("Vault refresh failed.", "error"));
    else if (id === "settings") $("settings-toggle").click();
    else if (id === "lock") lock();
  },
  revokeDevice,
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
$("lock").onclick = () => lock();
$("lock-app").onclick = () => lock();
$("create-vault").onclick = openCreateVaultDialog;
$("web-create-vault-form").onsubmit = submitVaultDialog;
$("web-create-vault-cancel").onclick = () => $("web-create-vault-dialog").close();
$("new-item").onclick = () => beginEdit(null);
$("edit-item").onclick = () => beginEdit();
$("cancel-edit").onclick = () =>
  currentItem
    ? displayItem(
        currentItem,
        document.querySelector(`[data-item-id="${currentItem.itemId}"]`),
      )
    : showEmpty();
$("close-item-detail").onclick = () => { clearItem(); renderItems(loadedItems); };
$("nav-all-items").onclick = () => { clearItem(); renderItems(loadedItems); };
$("reload").onclick = () => reload().catch(() => {});
for (const [id, key, fallback] of [["preference-lock-minutes", "127vaults:lock-minutes", "30"], ["preference-clipboard-seconds", "127vaults:clipboard-seconds", "30"]]) {
  const control = $(id);
  control.value = localStorage.getItem(key) || fallback;
  control.onchange = () => { localStorage.setItem(key, control.value); if (id === "preference-lock-minutes" && root) arm(); };
}
$("mobile-sync").onclick = async () => {
  try { await reload(); toast("Sync complete", "The latest server version is loaded.", "success"); }
  catch (error) { toast("Sync failed", safeError(error), "error"); }
};
$("session-footer").oncontextmenu = (event) => {
  event.preventDefault();
  $("session-menu").classList.remove("hidden");
};
$("session-menu").onmouseleave = () => $("session-menu").classList.add("hidden");
$("footer-sync").onclick = async () => {
  $("session-menu").classList.add("hidden");
  try { await reload(); toast("Sync complete", "The latest server version is loaded.", "success"); }
  catch (error) { toast("Sync failed", safeError(error), "error"); }
};
$("footer-use-server").onclick = async () => {
  $("session-menu").classList.add("hidden");
  let choice = await resolveConflict();
  if (choice !== "server") return;
  try { await reload(); clearItem(); toast("Server version restored", "Local unsaved edits were discarded.", "success"); }
  catch (error) { toast("Server version unavailable", safeError(error), "error"); }
};
$("reload-devices").onclick = reloadDevices;
$("begin-enrollment").onclick = beginEnrollment;
$("complete-enrollment").onclick = completeEnrollment;
$("settings-toggle").onclick = () => {
  $("profile-username").textContent = identity?.username || "";
  $("profile-device").textContent = identity?.deviceId || "Unavailable";
  $("profile-secret-status").textContent = reusableSecret(identity) ? `Remembered in this browser until ${new Date(identity.secretExpiresAt || Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}` : "Required at next unlock";
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
  $("reveal-password").textContent = hidden ? "Hide" : "Reveal";
};
$("toggle-edit-password").onclick = () => {
  let input = $("item-password"),
    show = input.type === "password";
  input.type = show ? "text" : "password";
  $("toggle-edit-password").textContent = show ? "Hide" : "Reveal";
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
$("item-form").onsubmit = save;
for (let n of ["pointerdown", "keydown"])
  document.addEventListener(n, (e) => {
    if (e.isTrusted && root) arm();
  });
window.addEventListener("pagehide", () => {
  core?.lock();
  wipeInputs();
});
try {
  await init();
  core = new ExperimentalEcf1Core();
  identity = await loadIdentity();
  if (identity) {
    $("username").value = identity.username;
    $("device").value = identity.deviceId;
  }
  showLogin();
  msg(identity ? "Ready to sign in." : "Register this device to continue.");
  $("state").textContent = "Locked";
} catch (e) {
  msg(
    "Rust/WASM failed to load. Reload the page; if it repeats, confirm the MVP stack was rebuilt.",
    "error",
  );
  $("state").textContent = "Unavailable";
  setBusy(true);
}
