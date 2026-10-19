# wasm-bindgen toolchain upgrade review

> Historical upgrade review. Use the exact versions in the current manifests, lockfile and build helper; do not treat the dated upstream release observations below as current recommendations.

Reviewed 2026-09-07. This is a documentation-only recommendation. No package,
CLI, lockfile, generated binding, or implementation change was made.

## Disposition

Replace the experimental `wasm-bindgen` package/CLI `0.2.100` pair with an
exactly matched `0.2.126` pair in a dedicated upgrade task. Version `0.2.126`
is the latest immutable upstream release observed during this review; it is a
candidate, not an approved production pin. Do not select the unreleased
`0.2.127` version currently visible on upstream `main`.

The existing `0.2.100` fixture remains reproducible locally, but it is not an
acceptable release baseline: installing its CLI reported a yanked `spin`
transitive dependency and future-incompatibility warnings involving
`buf_redux` and `multipart`. These are build-tool findings, not evidence that
the browser runtime contains those packages. The eventual `0.2.126` install
must prove its own resolved graph is free of yanks, advisories, and Cargo
future-incompatibility warnings; this review does not infer that from its age.

Primary evidence:

- The [upstream 0.2.126 release](https://github.com/wasm-bindgen/wasm-bindgen/releases/tag/0.2.126)
  is immutable and publishes a Windows MSVC archive plus checksums and a release
  attestation.
- The [upstream MSRV policy](https://github.com/wasm-bindgen/wasm-bindgen#msrv-policy)
  states a library MSRV of Rust 1.77 and CLI MSRV of Rust 1.86 for releases from
  0.2.118 onward. Both are below this workspace's pinned Rust 1.98.1.
- The [official deployment guide](https://wasm-bindgen.github.io/wasm-bindgen/reference/deployment.html)
  supports `--target web` for native browser ES modules without postprocessing.
  This matches the current fixture.
- The [official browser support page](https://wasm-bindgen.github.io/wasm-bindgen/reference/browser-support.html)
  names Firefox, Chrome, Safari, and Edge. This is a project support statement,
  not a substitute for 127Vaults browser tests or an exact minimum-version policy.

## Compatibility implications

The package, its macro/support crates, and the CLI generator must use the exact
same version. Generated bindings use a versioned internal schema, so a newer CLI
must not process an older package's output or vice versa. Pin the dependency as
`=0.2.126`, install `wasm-bindgen-cli --version 0.2.126 --locked`, and retain the
build helper's exact version check.

Rust 1.98.1 satisfies the recorded MSRVs. Keep `wasm32-unknown-unknown` and
`--target web`; do not adopt the newer `module` target because upstream calls
out its reliance on source-phase imports and currently limited tool support.
The 0.2.126 release notes include changes for Emscripten and alignment handling,
but the fixture uses neither Emscripten nor WASM threads. If future work enables
threads, atomics, or `panic=unwind`, separately review the release notices and
browser prerequisites rather than inheriting this approval.

The generated JavaScript, TypeScript declarations, and processed WASM may change
even when the Rust API does not. Review the generated diff for new imports,
exports, initialization behavior, memory exposure, snippet files, dynamic code,
and CSP effects. `--target web` cannot consume npm dependencies and supplies no
polyfills. Test the supported browser matrix before release.

## Generated-artifact policy

Keep `apps/web/wasm` ignored and regenerate it from the locked Rust source and
the workspace-local, exact-version CLI. Do not commit generated fixture output.
Release packaging must build it in a clean environment, record the Rust version,
target, CLI version, source revision, dependency locks, commands, and hashes of
the emitted `.js`, `.d.ts`, and `.wasm` files. Never download generated bindings
from an unverified developer machine.

For release CI, prefer an upstream prebuilt CLI only if its published SHA-256 and
release attestation are verified before execution. Otherwise compile the CLI
with the pinned Rust toolchain and `--locked`; record the resulting executable
hash. Either route still requires inspection of the resolved tool graph. Do not
treat reproducible inputs as proof that two platforms emit byte-identical files
until that has been measured.

## Reproducible upgrade procedure

Perform these steps in a clean worktree or review branch, not in-place over a
known-good fixture:

1. Record `rustc --version --verbose`, `cargo --version`, the installed WASM
   target, and hashes of the current generated fixture files.
2. Change only the fixture dependency to `wasm-bindgen = "=0.2.126"` and update
   the Cargo lockfile narrowly with `cargo update -p wasm-bindgen --precise 0.2.126`.
3. Install the matching CLI into a fresh workspace-local directory with
   `cargo install wasm-bindgen-cli --version 0.2.126 --locked --root <fresh-dir>`;
   capture the full output and fail on yanked or future-incompatibility warnings.
4. Check the resolved runtime and CLI graphs for duplicate binding versions,
   yanked crates, RustSec advisories, unexpected build scripts/unsafe code, and
   license or provenance changes. Keep the CLI graph separate from runtime claims.
5. Update the build helper's expected version and installation guidance together.
6. Remove only the ignored generated fixture outputs, rebuild with locked inputs,
   and inspect every regenerated artifact before browser execution.
7. Run all checks below. Revert the candidate if any unexplained ABI, security,
   browser, or reproducibility difference remains.

Exact package selection syntax may need disambiguation if Cargo reports more
than one old `wasm-bindgen` package in the lockfile; inspect first rather than
broadly updating the workspace.

## Required smoke checks after upgrade

- `wasm-bindgen --version` is exactly `wasm-bindgen 0.2.126`, and the build helper
  rejects both an older and a newer CLI.
- `cargo build --locked -p vaults-browser-fixture --target wasm32-unknown-unknown --release`
  passes on Rust 1.98.1 without warnings.
- Binding generation with `--target web` succeeds from a clean output directory;
  a second clean build is compared by artifact hash and investigated if unequal.
- `pnpm check` and the full native Rust formatting, Clippy, test, and feasibility
  checks pass without changing cryptographic-format claims.
- The fixture page initializes from the actual regenerated WASM in current Chrome,
  Edge, Firefox, and Safari (or the project's eventual explicit browser matrix).
- Create, validate, lock, stale-handle rejection, cross-store rejection, idle
  expiry, disposal, back/forward-cache reload, and missing-WASM fail-closed paths
  retain their documented behavior.
- HTTP responses deliver the `.wasm` MIME type expected by streaming
  instantiation, and CSP/network inspection shows no unexpected fetches, eval,
  npm dependency, or remote code path.
- Generated JS exposes no new supported secret-reading API. Inspect its memory
  export and acknowledge that hostile same-page JavaScript can still read WASM
  memory; the upgrade cannot turn WASM into a security boundary.
- Browser entropy success and forced-failure tests pass once real randomness is
  introduced: failure must abort without a persisted key, nonce, or partial
  envelope, and no weak fallback is permitted.
- The resolved runtime and separately installed CLI dependency graphs pass the
  project's advisory, yank, license, and provenance review with captured evidence.

## Risks and non-goals

Upgrading across many patch releases can alter generated ABI/schema details,
browser glue, TypeScript output, memory handling, and transitive dependencies.
The current fixture proves only disposable fixed-byte behavior. It does not
approve processing real secrets, cryptographic formats, browser isolation,
constant-time behavior under a JIT, entropy wiring, or production browser support.

Do not add `wasm-pack` merely to perform this upgrade. The direct Cargo plus
matched CLI flow is smaller and already serves the fixture; adopting another
orchestrator would add a separately versioned supply-chain surface without a
current requirement. Re-evaluate only if testing or npm packaging later provides
a concrete need.

Final recommendation: schedule a bounded `0.2.126` upgrade and validation task
before real-secret browser work. Approval requires clean captured evidence from
the exact resolved graphs and smoke matrix, not merely a successful compilation.

## Execution result — 2026-09-09

The workspace package, lockfile, helper, guidance, and local CLI now use the exact
0.2.126 pair. Locked Rust/WASM builds, formatting, strict Clippy, tests,
TypeScript checks, mismatch rejection, generated-glue inspection, and a two-build
hash comparison passed. The runtime graph contains one binding version.

The locked upstream CLI installation reported yanked `der 0.8.0` and the same
future-incompatibility warnings for `buf_redux`/`multipart`. Therefore 0.2.126 is
usable only for the disposable experimental work; it is not release-approved.
The browser matrix, clean-machine reproduction, automated advisory/license
review, and a clean replacement CLI graph remain required before release.
