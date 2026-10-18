# Git history credential review — 2026-10-18

The initial post-scrub review covered 2711 main-reachable text blobs up to 2 MiB, excluding
binary assets. Checked private-key blocks, recognized provider credential shapes,
private invitation links, credential-bearing database URIs, environment files,
profile files, and exact copies of the known historical environment credentials.

Two historical environment versions contained populated random database passwords
and readiness tokens. Their values appeared only in the environment-file blobs.
The environment file, machine-profile directories and active-profile pointer were
removed throughout main history. Nonsensitive dated evidence remains in history.

Follow-up review found zero environment/profile files and zero copies of those
known credential values reachable from main. Three database-URI pattern matches
were inspected and identified as disposable synthetic test credentials in the
admin-directory and device-management harnesses, not deployment credentials.

This supports uploading the reviewed main to the intended private repository.
Do not upload other branches, stashes, checkpoint refs or mirror the repository;
those and private local backup bundles preserve the original history. Commit
IDs changed. Artifact manifests retain their original provenance; local mapping
records and the release history identify the equivalent sanitized commits.

This is a bounded pattern and known-value review, not proof against arbitrary
unknown secrets, secrets encoded in binary assets or third-party dependency risks.
The reviewed changes after the scan are source/test fixes and maintained docs;
repeat the local audit after final changes. Public publication still requires
license adoption and the other release checks. No repository push was performed.
