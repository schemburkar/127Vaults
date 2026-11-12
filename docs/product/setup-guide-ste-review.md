# Setup guide: simplified technical English review

Review date: 2026-11-12. Original source baseline: `979c368`.

## Review files

- [STE-style HTML draft](../../public-website/setup-guide-ste-review.html)
- [Current HTML guide](../../public-website/setup-guide.html)

Run `node scripts/sites/setup-guide-review.mjs` from the repository to open a read-only local preview. The command prints its loopback URL. Open that URL in a browser. Stop the command to stop the preview. No server account, certificate change or production service is needed.

The draft uses the existing CSS, branding, seven-step sidebar, disclosures, command blocks and navigation. Its progress key is separate from the current guide. It is not in the public/customer publication allowlists. This review does not replace or publish the current guide.

## Recommendation

Use simplified technical English for the procedures, with a small software-specific vocabulary. It makes the sequence and actor clearer. Strict dictionary substitutions can make UI instructions less recognizable, so preserve actual product labels and command names.

The revised draft uses complete sentences, clear actions and consistent technical terms. Sentence length is a guide, not a pass/fail limit: do not remove necessary words or split connected explanations into fragments. The draft is **STE-style**, not a claim of formal ASD-STE100 conformance. Editorial qualifications belong in this memo, never in the customer-facing HTML.

The [official Issue 9 specification](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf) and [official FAQs](https://www.asd-ste100.org/faq.html) are the language references. Final adoption needs a dictionary/approved-meaning pass and review of the software technical vocabulary.

## Wording changes

- The original page structure, paragraph grouping and visible manual procedures are retained.
- The first step starts with computer requirements, Node.js and the container engine, as in the original.
- Connected explanations stay in paragraphs. Short sentences must still read as natural, complete English.
- Commands, options, filenames and actual UI labels remain recognizable.
- The review retains every original command block. A source comparison found no missing original command block.
- Removed the extra role selector, installer-first introduction, comparison control and all rendered review metadata after user feedback.

## Content changes that need review

These are intentional corrections or additions, not just language substitutions:

1. Preserve the existing seven-step sequence and disclosure placement.
2. Keep the combined installer's optional certificate-trust help in the existing browser-trust section.
3. Change “Activate your trial” to “Install the license.” Paid orders and trials have different instructions.
4. Explain that Manage handles orders and downloads while vault accounts belong to the private server.
5. Explain approval from a trusted browser session on the same computer. A second physical device is not always necessary.
6. Explain the public connection file, account invitation and device approval as separate steps.
7. Preserve the separate Windows current-user trust confirmation and per-computer browser trust instructions.
8. Correct the license limitation: locked/revoked status can block vault reads and writes, not only writes. Current `license-write-guard.mjs` permits vault reads for active/read-only status and rejects locked/revoked status. Keep ordinary expiry's 30-day read-only period separate from those states. The draft does not promise universal access or data recovery while locked.

## Proposed software vocabulary

This list records intended meanings; it does not establish that every term is an approved STE dictionary word.

| Term | Meaning in this guide |
| --- | --- |
| Server operator | Person who installs and maintains the private server. |
| Local operator account | Account for the server administration console. It does not unlock a user's vault. |
| Vault owner account | First owner account created on the private server. |
| Manage account | Account used for orders, downloads and subscriptions. |
| Client | Software that connects to the server, such as Desktop or CLI. |
| Device approval | Verification that permits a new client device for the user's account. |
| Public CA certificate | Public certificate used to verify certificates signed by the server's CA. Never its private key. |
| Connection file | Public `.127vaults-server` file with server connection and CA information. |
| Account invitation | Private capability for a new user's account registration. |
| Unlock | Open the user's encrypted vault in the applicable client. |
| Sync | Transfer and verify encrypted changes between a client and server. |
| Read-only | License state that permits reads but prevents licensed writes during the applicable grace period. |

## Reviewer checklist

- [ ] The wording feels clear without sounding mechanical.
- [ ] The first step matches the original layout and keeps its main instructions visible.
- [ ] Actual screen labels agree with the distributed product version.
- [ ] Paid and trial instructions describe the supported flow accurately.
- [ ] Every platform-specific trust instruction is understandable before the browser can load the server.
- [ ] The license-state correction agrees with the intended product policy as well as implementation.
- [ ] The software vocabulary has completed its approved-word/technical-term review.
- [ ] A new user can complete a packaged setup without additional developer explanation.

After review, update the canonical guide and its existing script/tests in one change. Remove or archive the temporary draft when it is no longer needed. Publish only through the normal release workflow.
