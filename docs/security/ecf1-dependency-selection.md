# ECF1 exact dependency selection (Batch 3C0)

> Dated selection rationale. The reviewed composition remains subject to the stated limitations; current manifests and lockfiles determine the installed versions. This is not a current dependency/advisory scan.

Reviewed 2026-09-07 against the actual downloaded registry sources. Documentation
only. Read Batch 3A, ECF1, key hierarchy, manifests/lock, backlog, working tree and
the wasm toolchain review. Workspace code, manifests and locks were not changed.

## Disposition

GO for the dependency selection for disposable Batch 3C, subject to coordinating
acceptance and completion of the separately required matched wasm-bindgen upgrade.
NO-GO for real credentials or stable formats. This report proves graph resolution
and compilation, not encryption correctness or actual browser entropy execution.

Two consequential findings change the obvious feature selection:

- Argon2 0.6.0's allocating helper frees its workspace without wiping it, even with
  `zeroize`. Disable `alloc`; use `hash_password_into_with_memory` and a
  caller-owned, fallibly allocated, zeroizing 64 MiB block buffer. Clear that
  buffer on success, error and cancellation. The selected feature implements
  `Zeroize` for `Block`; it does not make every block automatically zeroize.
- AEAD `zeroize` forwards to ChaCha20 but not Poly1305. HKDF does not expose an
  HMAC-zeroize forwarding feature. Explicit feature-unification dependencies below
  enable Poly1305, HMAC/SHA-256 and Argon2's BLAKE2 state clearing.

Primary versioned source references:
[Argon2](https://docs.rs/crate/argon2/0.6.0/source/src/block.rs),
[AEAD manifest](https://docs.rs/crate/chacha20poly1305/0.11.0/source/Cargo.toml),
[HKDF manifest](https://docs.rs/crate/hkdf/0.13.0/source/Cargo.toml),
[HMAC source](https://docs.rs/crate/hmac/0.13.0/source/src/block_api.rs),
[getrandom browser backend](https://docs.rs/crate/getrandom/0.4.3/source/src/backends/wasm_js.rs).
Evidence was obtained using Cargo downloads and local source inspection when
docs.rs fetches failed; links identify the corresponding immutable packages.

## Exact proposed Cargo entries

In `crates/crypto/Cargo.toml`:

```toml
[dependencies]
argon2 = { version = "=0.6.0", default-features = false, features = ["zeroize"] }
chacha20poly1305 = { version = "=0.11.0", default-features = false, features = ["zeroize"] }
hkdf = { version = "=0.13.0", default-features = false }
sha2 = { version = "=0.11.0", default-features = false, features = ["zeroize"] }
getrandom = { version = "=0.4.3", default-features = false }
zeroize = { version = "=1.8.2", default-features = false, features = ["alloc"] }
# Feature unification for upstream internal states, not new application primitives.
hmac = { version = "=0.13.0", default-features = false, features = ["zeroize"] }
poly1305 = { version = "=0.9.1", default-features = false, features = ["zeroize"] }
blake2 = { version = "=0.11.0", default-features = false, features = ["zeroize"] }
```

At the browser adapter boundary, alongside its existing path dependency:

```toml
wasm-bindgen = "=0.2.126"

[target.'cfg(all(target_arch = "wasm32", target_os = "unknown"))'.dependencies]
getrandom = { version = "=0.4.3", default-features = false, features = ["wasm_js"] }
```

Resolver 2 unifies browser entropy support into the browser-target core. Native
core/CLI builds retain OS entropy. Keep the binding package and generator CLI
exactly matched. A feature-forwarding adapter may be used only if the resulting
graphs match this selection; do not turn browser entropy on globally.

The isolated review manifest used the same entries, with wasm-bindgen itself
target-gated to distinguish native crypto from the browser adapter's host build.
The actual adapter's existing unconditional binding dependency also builds binding
support on host; that graph is the union of native crypto and binding support below.

Reject Argon2 defaults, PHC/password-hash interfaces, parallel/rayon, kdf/rand_core;
AEAD alloc/getrandom/rand_core/reduced-round APIs; HKDF's optional kdf; zeroize
derive/serde; WASM atomics/threads; custom or weak entropy backends; extra UUID,
Dalek or OPAQUE dependencies. Use caller-owned bounded in-place detached AEAD
buffers so allocator failure can be handled before encryption. Select full-round
XChaCha20Poly1305 explicitly, never a reduced-round type.

## Complete target graphs

The following adjacency list is complete for active normal/build dependencies
in the reviewed Windows x64 core and non-atomic wasm32 browser configurations.
Each package's exact version is in the inventory below. Repeated nodes are shared,
not additional copies. Feature unification is part of the selection above.

```text
core -> argon2, chacha20poly1305, hkdf, sha2, getrandom, zeroize,
        hmac, poly1305, blake2
argon2 -> base64ct, blake2, zeroize; [x86/x64 only] cpufeatures
blake2 -> digest
hkdf -> hmac
hmac -> digest
sha2 -> cfg-if, digest; [native accelerated targets] cpufeatures
digest -> block-buffer, crypto-common, ctutils, zeroize
block-buffer -> hybrid-array, zeroize
crypto-common -> hybrid-array
hybrid-array -> typenum
ctutils -> cmov
chacha20poly1305 -> aead, chacha20, cipher, poly1305, zeroize
aead -> crypto-common, inout
chacha20 -> cfg-if, cipher, zeroize; [native accelerated targets] cpufeatures
cipher -> block-buffer, crypto-common, inout
inout -> hybrid-array
poly1305 -> universal-hash, zeroize; [native accelerated targets] cpufeatures
universal-hash -> crypto-common, ctutils
getrandom -> cfg-if
getrandom [wasm_js/non-atomic] -> wasm-bindgen
browser adapter -> wasm-bindgen
wasm-bindgen -> cfg-if, once_cell, wasm-bindgen-macro, wasm-bindgen-shared
wasm-bindgen [build] -> rustversion (proc macro)
wasm-bindgen-macro (proc macro) -> quote, wasm-bindgen-macro-support
wasm-bindgen-macro-support -> bumpalo, proc-macro2, quote, syn, wasm-bindgen-shared
wasm-bindgen-shared -> unicode-ident
quote -> proc-macro2
proc-macro2 -> unicode-ident
syn -> proc-macro2, quote, unicode-ident
leaf nodes -> base64ct, zeroize, typenum, cmov, cfg-if, cpufeatures (Windows/x64),
              once_cell, bumpalo, rustversion, unicode-ident
```

Linux x86_64 graph was separately resolved: native graph above plus
`getrandom -> libc` (libc has its own build script). It was not cross-compiled.
Other native architectures/OSes require a new target graph check before shipping.
The lock also records inactive `r-efi` for UEFI and `js-sys` for WASM atomics;
neither is active on the reviewed targets. For completeness their resolved edges
are `r-efi -> none`, `js-sys -> cfg-if, wasm-bindgen`. No password-hash/phc
remains after removal of Argon2 alloc/defaults. No duplicate package versions or
duplicate dependency majors were reported by `cargo tree --target all -d`.
There is no rand_core/rand graph in this slice.

Effective crypto features include argon2 zeroize; AEAD zeroize; chacha20
cipher/stream support/xchacha/zeroize; poly1305 zeroize; SHA2/BLAKE2/HMAC zeroize;
digest block-api/mac/zeroize; block-buffer zeroize; zeroize alloc; hybrid-array
default and typenum const-generics/default. Standard binding defaults remain
enabled; no binding serde/debug-ABI/threads feature is introduced. Some upstream
edges activate defaults despite top-level default-features=false; inspect
`cargo tree -e features`, not just direct manifests.

## MSRV, licenses, package checksums and provenance

The final isolated lock contains 38 registry packages. All package archive SHA-256
hashes matched the Cargo sparse-index checksums; every selected registry record
had `yanked=false` in the refreshed index. No git/path source dependency was
introduced (the empty review root was the sole local package). This verifies
registry transport/archive identity, not author identity or a reproducible build.
No upstream signature/attestation for every crate archive was established.

All packages offer MIT OR Apache-2.0, except unicode-ident additionally requires
Unicode-3.0 and r-efi also offers LGPL-2.1-or-later as an alternative (choose its
MIT/Apache route). Preserve required notices at release. Highest declared MSRV
is 1.85; native/WASM checks used installed Rust 1.98.1, not an MSRV toolchain.
zeroize 1.8.2's actual package declares 1.60, correcting the 1.72 statement in 3A.
Binding library minimum is 1.77; separately reviewed CLI minimum is 1.86.

| Package | Declared Rust | Build surface | Archive SHA-256 |
| --- | --- | --- | --- |
| aead 0.6.1 | 1.85 | — | `1973cfbc1a2daf9cf550e74e1f088c28e7f7d8c1e1418fb6c9dc5184b7e84c99` |
| argon2 0.6.0 | 1.85 | — | `134c52ddac6d63c576bef8168db10c83c49c26444ecbc68060fef078925a901c` |
| base64ct 1.8.3 | 1.85 | — | `2af50177e190e07a26ab74f8b1efbfe2ef87da2116221318cb1c2e82baf7de06` |
| blake2 0.11.0 | 1.85 | — | `5b5d4d889834ee8ecfc0f8426ad30faf7cdcb10f741a8e6d7224d95325479f6f` |
| block-buffer 0.12.1 | 1.85 | — | `d2f6c7dbe95a6ed67ad9f18e57daf93a2f034c524b99fd2b76d18fdfeb6660aa` |
| bumpalo 3.20.3 | 1.71.1 | — | `72f5acc6cb2ba439de613abc23857ec3d78374d8ed5ac84e9d11336e87da8649` |
| cfg-if 1.0.4 | 1.32 | — | `9330f8b2ff13f34540b44e946ef35111825727b38d33286ef986142615121801` |
| chacha20 0.10.2 | 1.85 | — | `65c35e4b699c7e15ccbe7ee35c005e4fc0a278d22238a2857e6ce2dadeda1b06` |
| chacha20poly1305 0.11.0 | 1.85 | — | `9b89e1c441e926b9c82a8d023f6e1b7ae0adcfaa7d621814e4d60789bac751cb` |
| cipher 0.5.2 | 1.85 | — | `e8cf2a2c93cd704877c0858356ed03480ff301ee950b43f1cbe4573b088bfa6c` |
| cmov 0.5.4 | 1.85 | — | `0c9ea0ac24bc397ab3c98583a3c9ba74fa56b09a4449bbe172b9b1ddb016027a` |
| cpufeatures 0.3.1 | 1.85 | — | `5ca28b0ae3115b884660db4118d803791fd6756b6e88f39c0f3f7859060d7566` |
| crypto-common 0.2.2 | 1.85 | — | `ce6e4c961d6cd6c9a86db418387425e8bdeaf05b3c8bc1411e6dca4c252f1453` |
| ctutils 0.4.2 | 1.85 | — | `7d5515a3834141de9eafb9717ad39eea8247b5674e6066c404e8c4b365d2a29e` |
| digest 0.11.3 | 1.85 | — | `f1dd6dbb5841937940781866fa1281a1ff7bd3bf827091440879f9994983d5c2` |
| getrandom 0.4.3 | 1.85 | build script | `300e883d756b2e4ec94e02791f39b04b522276138852cfc41d9fb7e904106099` |
| hkdf 0.13.0 | 1.85 | — | `4aaa26c720c68b866f2c96ef5c1264b3e6f473fe5d4ce61cd44bbe913e553018` |
| hmac 0.13.0 | 1.85 | — | `6303bc9732ae41b04cb554b844a762b4115a61bfaa81e3e83050991eeb56863f` |
| hybrid-array 0.4.14 | 1.85 | — | `707114b52a152fa7bdb290cd7cd5912d9467273b6d74e21b8d81aca1f8533f6b` |
| inout 0.2.2 | 1.85 | — | `4250ce6452e92010fdf7268ccc5d14faa80bb12fc741938534c58f16804e03c7` |
| js-sys 0.3.103 | 1.77 | — | `53b44bfcdb3f8d5837a46dae1ca9660a837176eee74a28b229bc626816589102` |
| libc 0.2.189 | 1.65 | build script | `3eaf3ede3fee6db1a4c2ee091bf8a8b4dccdc6d17f656fb07896ee72867612f2` |
| once_cell 1.21.4 | 1.65 | — | `9f7c3e4beb33f85d45ae3e3a1792185706c8e16d043238c593331cc7cd313b50` |
| poly1305 0.9.1 | 1.85 | — | `6e2d0073b297041425c7c3df6eb4792d598a15323fe63346852b092eca02904c` |
| proc-macro2 1.0.107 | 1.71 | build script | `985e7ec9bb745e6ce6535b544d84d6cd6f7ad8bd711c398938ae983b91a766d9` |
| quote 1.0.47 | 1.71 | build script | `1fbf4db142a473a8d80c26bbf18454ed458bf8d26c8219c331daecfdbd079001` |
| r-efi 6.0.0 | 1.68 | — | `f8dcc9c7d52a811697d2151c701e0d08956f92b0e24136cf4cf27b57a6a0d9bf` |
| rustversion 1.0.23 | 1.31 | build script | `cf54715a573b99ac80df0bc206da022bcd442c974952c7b9720069370852e21f` |
| sha2 0.11.0 | 1.85 | — | `446ba717509524cb3f22f17ecc096f10f4822d76ab5c0b9822c5f9c284e825f4` |
| syn 2.0.119 | 1.71 | — | `872831b642d1a07999a962a351ed35b955ea2cfc8f3862091e2a240a84f17297` |
| typenum 1.20.1 | 1.41.0 | — | `b6f5e870be6c3b371b77fe0ee0bafb859fa4964b4404c27de1d380043c4dda20` |
| unicode-ident 1.0.24 | 1.71 | — | `e6e4313cd5fcd3dad5cafa179702e2b244f760991f45397d14d4ebf38247da75` |
| universal-hash 0.6.1 | 1.85 | — | `f4987bdc12753382e0bec4a65c50738ffaabc998b9cdd1f952fb5f39b0048a96` |
| wasm-bindgen 0.2.126 | 1.77 | build script | `4b067c0c11094aef6b7a801c1e34a26affafdf3d051dba08456b868789aaf9a4` |
| wasm-bindgen-macro 0.2.126 | 1.77 | proc macro | `167ce5e579f6bcf889c4f7175a8a5a585de84e8ff93976ce393efa5f2837aab1` |
| wasm-bindgen-macro-support 0.2.126 | 1.77 | — | `f3997c7839262f4ef12cf90b818d6340c18e80f263f1a94bf157d0ec4420380e` |
| wasm-bindgen-shared 0.2.126 | 1.77 | build script | `dc1b4cb0cc549fcf58d7dfc081778139b3d283a081644e833e84682ad71cea24` |
| zeroize 1.8.2 | 1.60 | — | `b97154e67e32c85465826e8bcc1c59429aaaf107c1e4a9e53c8d8ccd5eff88d0` |

The final isolated lock SHA-256 is
`c6cdf870c3e6e6a3bcc6ae1f3b3b348176432a377d96756845cdacbb4b2d044a`.
The inventory preserves the resolved pins after temporary files are removed.
When implementing, reproduce and compare every resolved package/checksum;
a fresh lock may otherwise advance transitives despite exact direct pins.

## Advisory and source-surface review

Fetched the primary [RustSec advisory database](https://github.com/RustSec/advisory-db)
at commit `faedffd5118c1835e13cca3babb6059afb1eb8d0`. Matched every package
name in the resolved graph, read every matching advisory, and compared its version
range. None affects the selected versions. Matches were BLAKE2 2019-0019,
bumpalo 2020-0006/2022-0078, ChaCha20 2019-0029, cmov 2026-0003,
once_cell 2019-0017 and SHA2 2021-0100; all selected versions are above their
patched minimum. In particular cmov 0.5.4 exceeds the 0.4.4 fix. This was a
manual exact-graph RustSec review; cargo-audit was not installed, so no
cargo-audit success is claimed. Recheck current advisories/yanks during integration.

Build scripts exist in getrandom, libc, proc-macro2, quote, rustversion,
wasm-bindgen and wasm-bindgen-shared. getrandom's script only configures memory
sanitizer support. Compiler probes/configuration/code generation in the binding
build chain execute on the build host and remain supply-chain trust surfaces.
The active proc macros are wasm-bindgen-macro and rustversion. No new C compiler,
OpenSSL build or zeroize derive appears in this graph.

A source search found unsafe tokens in Argon2, base64ct, BLAKE2, block-buffer,
bumpalo, ChaCha20, cmov, cpufeatures, ctutils, getrandom, hybrid-array, inout,
js-sys, libc, once_cell, Poly1305, proc-macro2, r-efi, rustversion, SHA2, syn,
unicode-ident, wasm-bindgen, wasm-bindgen-macro-support and zeroize. This is a
surface inventory (including comments/inactive backends), not an executable
unsafe count or line-by-line audit. Argon2 0.6 contains raw-pointer segment views
even without rayon. Native hashes/ciphers use SIMD/intrinsics; WASM uses portable
implementations but still includes memory/binding unsafe code. Workspace
forbid(unsafe_code) cannot ban dependency unsafe. No claim of constant-time JIT
execution or comprehensive unsafe review follows.

## Entropy, cleanup and audit limitations

getrandom 0.4.3 exposes fallible fill; browser backend calls
globalThis.crypto.getRandomValues through a catch-enabled wasm-bindgen import,
maps exceptions to its Web Crypto error, and chunks requests at 65,536 bytes.
Windows uses native OS entropy; Linux adds libc-backed OS calls. Check every
call, discard partially filled buffers, map errors to ENTROPY_UNAVAILABLE and
never fall back. A missing API, throwing API, worker realm, and failure after an
earlier success still need real-browser smoke in 3C. Compile success is not that
evidence. No atomics means the extra JS typed-array copying backend stays inactive.

Caller-owned Argon2 memory must be allocated with try_reserve_exact then bounded
initialization inside a zeroizing owner; never place 64 MiB on stack. Validate
ECF1 tuple/lengths first. Explicitly zeroize output buffers and HKDF PRK/key
outputs. SHA2/HMAC feature unification clears retained hash states/buffers on drop,
but HMAC source still has ordinary local pad/hash arrays; library internals and
compiler temporaries are not comprehensively erased. ECF1's operation-owned
intermediates must be cleared; do not expand this into a claim that every upstream
temporary or browser copy is erased. If total internal erasure is made mandatory,
this selection is NO-GO pending a separately reviewed upstream solution.

3A's historic AEAD audit does not cover all 0.11-era changes, Argon2 memory
refactoring, the new digest generation, feature composition or our bindings.
No current independent audit of this entire graph was established. Keep that
gap explicit. Reject substituting TypeScript merely to evade these checks; it
would require equivalent review and does not solve browser memory exposure.

## Binding reconciliation and reproducible evidence

0.2.126 resolves with getrandom 0.4.3 and compiles for wasm32. Registry currently
offers 0.2.128 (and js-sys 0.3.105), so the earlier report's "latest" statement is
stale; the already reviewed 0.2.126 remains the candidate here. Do not silently
upgrade again. CLI graph, installation, generated output and actual browser
fixture approval belong to the dedicated toolchain task, not this runtime review.

Commands used against an isolated empty library:

```text
cargo info argon2@0.6.0
cargo metadata --manifest-path <temp>/Cargo.toml --format-version 1
cargo generate-lockfile --manifest-path <temp>/Cargo.toml --offline
cargo tree --manifest-path <temp>/Cargo.toml --locked --offline --target x86_64-pc-windows-msvc -e features
cargo tree --manifest-path <temp>/Cargo.toml --locked --offline --target wasm32-unknown-unknown -e normal,build
cargo tree --manifest-path <temp>/Cargo.toml --locked --offline --target x86_64-unknown-linux-gnu -e normal,build
cargo tree --manifest-path <temp>/Cargo.toml --locked --offline --target all -d
cargo check --manifest-path <temp>/Cargo.toml --locked --offline
cargo check --manifest-path <temp>/Cargo.toml --locked --offline --target wasm32-unknown-unknown
```

Final native and WASM dependency checks passed. Initial network restrictions
required approved registry access. The initial allocating-feature candidate was
rejected after source inspection; final lock and inventory refer to the narrowed
selection. No crypto operation, browser test, unit test or deterministic vector
was implemented. The temporary manifest, lock, build outputs and advisory clone
were removed afterward; downloaded public Cargo cache packages remain reusable.
No central checkbox changed. Deferred 3C evidence remains round trips/tamper,
parser limits, entropy failures, owned-buffer cleanup, KDF performance/cancellation,
cross-instance handles, native/browser behavior and later independent vectors.
