# Repository workflow

The user wants completed changes committed to local Git `main`, including existing uncommitted work they explicitly ask to preserve. Finish relevant checks and commit before handing work back. Do not push unless requested. Preserve unrelated work and never reset or discard it.

Keep intermediate package builds internal. Test the relevant fixes before publishing one combined release to the public site/private R2 catalogue; do not publish each intermediate build.

Use existing repository scripts for recurring operational work, including builds,
installer generation, verification and Cloudflare publication. If a repeated task
is missing from those scripts, extend and test the scripts rather than repeat a
manual workaround. Run the scripted workflow and retain its verification receipts.

# Public security copy

Describe the implemented encryption, storage model and trust boundaries in public
security pages and policies. Keep experimental/private-test status and audit-status
disclaimers in internal documentation, not public-facing copy. Do not imply an
audit or certification that has not occurred. Preserve accurate technical limits.
