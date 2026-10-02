# Repository hygiene review

Status: bounded static review completed on 2026-09-07.

## Scope

This review covers only Git exclusions and the server image build context. It does not inspect secret values, build an image, start containers, install dependencies, or assess runtime secret handling.

## Checks performed

- Read `.gitignore` and `.dockerignore` and compared their coverage.
- Used `git check-ignore --no-index` with synthetic paths representing environment files, local tools, generated WASM, Node and Rust output, IDE files, logs, database files, backup artifacts, signing keys, certificates, and operating-system metadata.
- Repeated the synthetic-path check after updating the exclusions.
- Reviewed `.dockerignore` statically; no Docker or Podman command was run.
- Ran `git diff --check` for whitespace and patch-format errors.

## Gaps fixed

- Ignore nested Cargo `target` directories rather than only the workspace-root directory.
- Ignore generated `dist`, coverage, and Turborepo output.
- Ignore log files without excluding source or documentation files.
- Ignore common PostgreSQL/database dump and backup artifacts while leaving checked-in SQL migrations visible.
- Ignore common private-key, signing-store, and certificate filename extensions, plus standard SSH private-key filenames.
- Ignore Windows metadata in addition to the existing macOS metadata rule.
- Bring Docker build-context exclusions in line with the repository exclusions for generated output, local databases, backups, credentials, IDE state, and OS metadata.
- Preserve `.env.example` as an allowed repository and build-context input.

## Limitations

- Filename exclusions reduce accidental inclusion but cannot detect secrets stored under unexpected names or embedded in source files.
- Public certificates may not be confidential, but certificate artifacts are excluded to avoid accidentally packaging deployment-specific identity material.
- Generic archives are not globally ignored because they may be intentional source fixtures; backup directories and conventional database-backup suffixes are excluded instead.
- Docker exclusion behavior was reviewed from patterns only because this task intentionally did not invoke a container engine or inspect an assembled build context.
- Secret scanning, commit-history scanning, image-layer inspection, and runtime mount validation remain separate release-gate work.

## Files changed

- `.gitignore`
- `.dockerignore`
- `docs/release/repository-hygiene.md`
