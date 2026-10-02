# Candidate format and version registry

Status: **candidate interoperability evidence only; prohibited for real secrets**.

This registry freezes names and byte meanings for repeatable native/browser tests. It does not
approve a production cryptographic format. `SUPPORTED_CRYPTO_FORMATS` remains empty, so every
format fails the real-secret admission check.

| Registry | Identifier | Status | Meaning |
| --- | ---: | --- | --- |
| Core interface | 1 | candidate | Rust/WASM boundary revision |
| Content crypto | 1 (`ECF1`) | experimental | Disposable fixture described in `experimental-crypto-format.md` |
| Protocol | 1 | candidate | Initial private-beta protocol type revision |

Unknown, zero, and future identifiers are rejected. An experimental identifier being known is
not sufficient for production admission. Promotion requires an independent security review,
accepted dependency/parameter inventory, independent vectors, migration rules, and an explicit
change to `SUPPORTED_CRYPTO_FORMATS`.

## Frozen ECF1 interoperability vector

Both native Rust and the WASM bridge call the same deterministic vector function. Inputs are
fictitious constants: purpose 3, UUID fixtures 1/3/4/5, epoch 1, schema 1, 32 bytes of `07` as
IKM, 24 bytes of `06` as nonce, and ASCII plaintext `vector`. The expected envelope is:

```text
313237564558500000010103010101010101400180010101010101010000000000000000000000000000000003030303030340038003030303030303040404040404400480040404040404040505050505054005800505050505050500000001000000000000000100000000000000000000000000000000000000000000000000060606060606060606060606060606060606060606060606000000162aa12cd9f1af16180a40d607836b6a66b9528de3c2ae
```

This vector freezes serialization, HKDF labels, XChaCha20-Poly1305 nonce handling, AAD, and tag
output for the disposable item fixture. It intentionally does not exercise password derivation.
The Argon2id parameters remain those documented for ECF1 and need separate independent vectors
and review before any promotion.
