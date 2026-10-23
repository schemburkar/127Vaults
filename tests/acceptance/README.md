# Isolated acceptance workflows

These opt-in scenarios use disposable synthetic data. They are separate from
product unit tests and from the retained-fixture workflows in
[`tests/internal`](../internal/README.md). There is no run-all entry point.
Run commands from the repository root after the documented build prerequisites.

| Canonical file | Entry point | Requirements and side effects |
| --- | --- | --- |
| `web/pwa-browser-smoke.mjs` | `pnpm --filter @127vaults/web test:pwa:browser` | Built web/WASM, Playwright and Chromium; starts an isolated HTTP/auth fixture and writes synthetic browser evidence to `.tools/` |
| `web/item-workspace-browser-smoke.mjs` | `node scripts/item-workspace-browser-smoke.mjs` | Enables workspace checks in the same isolated PWA scenario before its dynamic import |
| `web/item-workspace-web-smoke.mjs` | Imported `exerciseItemWorkspace` helper | Uses the authenticated disposable page supplied by the PWA workflow; no independent server or credentials |
| `desktop/item-workspace-desktop-smoke.mjs` | `node scripts/item-workspace-desktop-smoke.mjs` | Local desktop Vite on port 1421 and Playwright; injects synthetic Tauri IPC and opens browser windows, with no real desktop profile |
| `desktop/native-startup.ps1` | `powershell.exe -File tests/acceptance/desktop/native-startup.ps1 -Executable <exe> -Work <new external folder>` | Starts the actual Windows Tauri binary with new profile/WebView folders, verifies its native window, closes it, and retains a binary hash receipt |
| `desktop/dev-launcher.ps1` | `powershell.exe -File tests/acceptance/desktop/dev-launcher.ps1 -EnvironmentFile <private fixture env> -Work <new external folder>` | Exercises actual default `dev.ps1` child commands using an already-running isolated HTTPS fixture; verifies native dev window, extension staging and HTTPS modules/API proxy; closes only its child processes |
| `extension/startup.mjs` | `node tests/acceptance/extension/startup.mjs --release <verified release directory> --work <new external folder>` | Verifies/extracts the extension archive, starts its worker/popup, exercises credential creation/assertion in the browser, and stubs native popup requests |

`scripts/item-workspace-preview.mjs` remains a developer preview server. It
serves synthetic comparison data from a saved build and the current web build;
it is not an acceptance test. Development/build/operator commands stay under
`scripts/`. Existing smoke paths are compatibility launchers/exports so external
commands continue to work. Retain these while documented direct invocations
exist; they contain no duplicate scenario implementation.

Use `pnpm test:acceptance:check` for syntax and local dependency checks without
executing the scenarios. The same checks run in `pnpm test`. Browser scenarios
need the locked fixture build (`pnpm fixture:build`) and web build. Set
`VAULTS_PLAYWRIGHT_MODULE` / `VAULTS_BROWSER_EXECUTABLE` when selecting an existing
Playwright runtime or browser, as supported by each workflow. Read each scenario
before adding mode flags; modes exercise different interruption/recovery cases.

Keep scenario filenames outside unit-test discovery patterns. Do not rename a
mutating workflow to `*.test.mjs` or place it in a component's `test/` directory.

The packaged-extension startup probe needs Chromium with extension-loading flags
(the installed Edge build can be selected with `VAULTS_BROWSER_EXECUTABLE`). Its
native messaging stub confines startup to synthetic source discovery; use the
existing packaged native-host smoke for the actual connector protocol. It never
registers a native host or edits the user's browser/connector configuration.
