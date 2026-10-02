# TypeScript `EPERM` diagnosis

## Outcome

The `pnpm check:contracts` failure is caused by Windows file ACLs on the installed pnpm package files, not by TypeScript, pnpm's link layout, an active file lock, or antivirus behavior.

The affected `tsc` file has a file-level ACL that grants access only to the interactive user, Administrators, and SYSTEM. The Codex sandbox identity is therefore unable to open it. The parent `typescript` directory does grant inherited modify access to `CodexSandboxUsers`, but that directory permission does not repair the more restrictive ACL already present on the individual file.

This appears to affect package-store files beyond TypeScript as well: read-only probes against several unrelated `.pnpm` package `package.json` files failed with the same access-denied result. Replacing only the `tsc` launcher would therefore be incomplete.

## Evidence

Read-only inspection produced the following results:

- `node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc` exists as an ordinary 45-byte file, not a junction or symbolic link.
- The pnpm top-level `node_modules/typescript` entry is a normal junction into the `.pnpm` package layout; this is expected pnpm behavior.
- Sandboxed `File.OpenRead` calls failed for `tsc`, `tsserver`, TypeScript's `package.json`, and several unrelated pnpm package manifests.
- The same sandbox could read the repository-root `package.json`, so file reads are not generally broken.
- Sandboxed `Get-Acl`, `icacls`, and direct `node .../bin/tsc --version` access to the file failed with access denied or `EPERM`.
- A read-only unsandboxed comparison successfully read the launcher and ran it, returning `Version 5.9.3`.
- The unsandboxed file ACL contained full-control entries for SYSTEM, Administrators, and the interactive user, but no readable entry for `CodexSandboxUsers`, `Users`, or `Authenticated Users`.

The successful unsandboxed run rules out a corrupt launcher and strongly argues against a transient lock or antivirus quarantine. The fact that the target is an ordinary file behind an otherwise valid pnpm junction rules out link-layout failure.

## Minimal remediation

Perform remediation from an elevated Windows terminal outside Codex, after taking a copy of the current repository if desired. Do not grant broad permissions outside this repository.

Preferred approach:

1. Correct inherited permissions recursively on `C:\Projects\127Vaults\node_modules` so `CodexSandboxUsers` has read and execute access to existing package files and directories.
2. Confirm that inheritance is enabled on the files, rather than only adding a permission to the top-level directory.
3. Re-run `pnpm check:contracts` from Codex.

An administrator can use Windows Security's Advanced Security UI to enable inheritance on `node_modules` descendants and grant `CodexSandboxUsers` **Read & execute**, **List folder contents**, and **Read** for this directory, subdirectories, and files. This is safer than granting Full Control and avoids changing permissions elsewhere.

If the dependency tree is disposable, an alternative is to remove and reinstall `node_modules` from the interactive user's terminal after first ensuring the repository directory inherits a readable entry for `CodexSandboxUsers`. Merely reinstalling without correcting inheritance may reproduce the problem.

Avoid changing ownership: ownership is not required when the needed read/execute ACL exists. Also avoid treating this as a reason to run routine checks as Administrator; the package tree should be readable by the sandbox under normal operation.

## Commands used

All diagnostic commands were read-only:

```powershell
Get-Item -LiteralPath $target -Force
Get-Acl -LiteralPath $target
cmd /d /c icacls $target
[System.IO.File]::OpenRead($target)
node $target --version
```

The final `icacls`, content-read, and Node invocation were repeated outside the sandbox solely to compare access behavior. No ACL, dependency, manifest, lockfile, or source change was made.
