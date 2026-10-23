# CLI browsing development verification — 2026-10-23

Implemented CLI-011 and index-based item filtering. This is a local development
change, not a package publication or a supported-release acceptance record.

## Behavior

- `vault list --format table` shows names, stable vault codes and active/archive status.
- `item list --format table` shows titles, sites, stable item codes and item types.
  `--all` adds the stable vault code for unambiguous subsequent selection.
- `--search`, `--favorites` and `--type` compose in both table and JSON output.
  Search covers only title and website. Legacy unmarked items count as logins.
- Default JSON output retains the prior shape, order and pretty serialization.
- Tables detect terminal width, support an explicit width from 24 to 240 columns,
  and switch to labeled records when columns cannot fit. Selection codes remain
  complete. Redirected output stays JSON unless table output is explicitly chosen;
  redirected tables default to a deterministic 100 columns.
- Rendering uses an explicit metadata allowlist and suppresses terminal controls,
  line separators and bidirectional formatting controls. No password-class field
  is added to list output.

## Reproducible checks

Run from the repository root:

```powershell
node scripts/check-cli.mjs --receipt target/cli-browsing-windows.json
```

The same script runs on Linux. In the available Ubuntu 24.04 WSL environment,
the run used its existing native Linux build cache:

```sh
CARGO_TARGET_DIR=/home/vaults-dev/projects/127Vaults/target \
  node scripts/check-cli.mjs --receipt target/cli-browsing-linux.json
```

Both runs passed formatting, CLI linting with warnings denied, all 121 active CLI
tests (one pre-existing live TLS/PostgreSQL ceremony test remains ignored), binary
builds, executable help/flag checks and expected invalid-argument exit codes.
Receipts retain source-file SHA-256 fingerprints, the base Git revision, platform,
check commands, durations and output hashes. Each receipt has a sibling
`.preview.txt` containing rendered fictional vault/item examples. These generated
receipts remain local under `target/`.

The tests cover every width from 24 through 240, complete item/vault codes,
Unicode display widths, empty results, archive labels, combined filters,
unchanged/default JSON, unsupported options, and control-sequence suppression.
A real Rust encrypted-replica fixture queues an offline favorite Wi-Fi edit,
reopens its index from disk with the item body deliberately unavailable, filters
and renders the item, and verifies that browsing does not mutate ciphertext or
the pending queue. Restoring the body confirms that the displayed I/V codes work
with the existing item and vault selectors. All-vault browsing excludes an
archived replica.

Packaged physical-terminal acceptance is still pending. No installer was built,
no package/site was published, and the public Product preview continues to show
the existing shipped JSON default. See the [CLI guide](../product/cli-mvp.md#browse-from-a-terminal)
for usage.
