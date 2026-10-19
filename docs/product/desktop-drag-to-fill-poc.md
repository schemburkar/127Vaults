# Desktop drag-to-fill POC decision record

Date: 2026-09-16. Status: Stage A interoperability gate passed on Windows.

## Question

Can an explicitly selected username or password be dragged from an unlocked
127Vaults desktop window into a browser or native application without using the
clipboard, while preserving a credible path to lock revocation and memory cleanup?

## Findings

1. Tauri 2 has two mutually exclusive drag paths in a WebView window on Windows.
   Its default native, file-oriented handler (`dragDropEnabled: true`) interferes
   with DOM HTML5 drag events. Disabling that handler restores HTML5 drag, but the
   window loses Tauri native incoming-file drops. The POC needs outbound text only,
   so it explicitly selects the HTML5 path.
2. A WebView drag can establish target compatibility and user experience, but it
   cannot demonstrate dependable zeroization or revoke `GetData` after an OS lock.
   WebView2 and OLE may copy immutable text outside application-owned buffers.
3. 1Password publicly documents an Electron/React desktop UI backed by a shared
   Rust core. This is useful architectural precedent, but no public source found
   here establishes its drag-to-fill implementation. We must not infer that its
   drag behavior comes for free from Electron.
4. Manual testing confirmed drops into website form fields and Notepad. An
   unelevated client cannot drop into an elevated Command Prompt; 1Password has
   the same integrity-boundary behavior, so elevation is not a Stage A blocker.

## Staged decision

- Stage A (current): Tauri/WebView2 HTML5 fixture, fake values only. Establish the
  Windows target matrix, cancellation behavior, and whether password inputs accept
  `text/plain` drops.
- Stage B: if Stage A interoperates, implement a native Windows OLE fixture with a
  revocable `IDataObject`, `IDropSource`, owned `HGLOBAL`, explicit buffer wiping,
  and lock-state checks from `QueryContinueDrag` and `GetData`.
- Stage C: compare integration cost for Tauri plus the native provider, hardened
  Electron plus the same provider, and a native UI. Retain the existing Rust core
  regardless of UI choice.
- Stage D: investigate macOS `NSDraggingSource`/`NSItemProvider` and Linux Wayland
  data-control / X11 selection behavior independently. Cross-platform UI reuse
  does not remove the need for platform-native secret-transfer code.

## Go/no-go criteria

Stage A is a go only if current Edge/Chrome, Firefox, Notepad, and a representative
Win32 application accept username and password text; Escape and rejected targets
produce no fill; no clipboard format is created; and an unelevated source cannot
fill an elevated target. Record exact OS and WebView2 versions.

Stage B must prove lock-during-drag revocation,
best-effort wiping of every application-owned native buffer, crash/close cleanup,
and absence of secret logging. Target applications can always retain accepted
plaintext; the UI must state that trust boundary.

## References

- Tauri window configuration documents that disabling `dragDropEnabled` is needed
  for frontend HTML5 drag-and-drop on Windows.
- Tauri issue 14373 records the confusing native-vs-DOM behavior; issues 14055 and
  15138 demonstrate the missing hybrid mode.
- 1Password, “1Password 8: The Story So Far,” describes Electron desktop frontends
  and a shared Rust backend; its `electron-secure-defaults` repository documents
  renderer hardening used by its desktop app.
