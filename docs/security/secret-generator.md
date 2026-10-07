# Password, passphrase and PIN generation

Desktop, web and CLI use `vaults-crypto::generator`. Generation stays on the
device: native apps use OS entropy through `getrandom`, and the existing WASM
bridge uses `getrandom`'s `wasm_js` backend (browser Web Crypto). Entropy errors
stop generation; there is no insecure fallback or server generator.

Random indexes use rejection sampling of 32-bit values, avoiding modulo bias.
Passwords are uniformly sampled from the enabled character sets, rejecting whole
candidates until every enabled set appears. Settings permit 4–128 characters,
with a default of 20 and optional exclusion of `Il1O0o`.

Passphrases independently sample 3–20 words, defaulting to six, with spaces,
another separator (up to eight printable characters), or no separator. Optional
capitalization is deterministic; an optional trailing digit is independently
random. Words may repeat. The full 7,776-entry dictionary includes four
hyphenated words, so a hyphen can also appear inside a word.

PINs independently sample 4–32 digits, defaulting to six. Leading zeroes are
preserved. Short PINs provide limited strength despite secure randomness and
should be used where a numeric code is required.

The shared desktop/web dialog previews a masked value, offers reveal and
regenerate, and inserts only after **Use**. Changing options invalidates the
preview. Closing or locking clears it, and late async results are ignored.
Generated values are not logged or saved as generator history. JavaScript
strings cannot be reliably zeroized; they are released when the dialog closes.

CLI generation works offline without login or a profile and prints only the
generated value to stdout:

```sh
127vaults generate password --length 24 --exclude-ambiguous
127vaults generate password --no-symbols
127vaults generate passphrase --words 6 --separator "-" --capitalize --number
127vaults generate pin --length 6
```

## Word-list attribution

`crates/crypto/src/eff_large_wordlist.txt` is the unmodified
[EFF large word list](https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt)
by Joseph Bonneau for the Electronic Frontier Foundation, distributed under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
per [EFF's copyright policy](https://www.eff.org/copyright). See
[EFF's description](https://www.eff.org/dice). No changes were made to the list.

## Verification

Run `cargo test --workspace`, `node scripts/build-fixture.mjs`, and the UI,
web and desktop package checks/tests. The web generator tests exercise the actual
WASM export when the browser fixture is built. Rust tests cover rejected random
values, entropy failure, required character classes, dictionary integrity,
passphrase options, PIN leading zeroes and invalid settings.
