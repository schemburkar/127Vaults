# First public beta procedure

This is a release design checklist, not an executable script.

## Private-repository freeze

1. Select and sign the exact beta commit in the private repository.
2. Freeze changes while the snapshot is reviewed.
3. Run tests, dependency-license checks, secret scanning, generated-file review,
   threat-model review, and release artifact reproducibility checks.
4. Confirm Shubhan Chemburkar owns or has adequate relicensing rights to every
   first-party file.

## License preparation

1. Choose the immutable beta identifier, such as `0.1.0-beta.1`.
2. Record its actual first-public-distribution date.
3. Calculate the fixed Change Date exactly four years later.
4. Include the verbatim BSL 1.1 text and parameter block naming Shubhan Chemburkar,
   the exact Licensed Work, `Additional Use Grant: None`, the Change Date, and
   `GNU Affero General Public License Version 3` as Change License.
5. Include required AGPL text/reference, commercial-license contact, copyright
   notices, trademark policy, security disclaimer, and beta/EOL status.
6. Obtain qualified legal review before publication.

## Clean publication

1. Export only tracked files from the approved beta commit into a fresh temporary
   directory; do not copy `.git`.
2. Add the finalized license and public release documents.
3. Re-run secret scanning, file-inventory comparison, tests, and artifact builds
   from the exported tree.
4. Initialize a brand-new Git repository and create one signed root commit.
5. Create a new empty public GitHub repository and push only that branch and the
   signed beta tag. Do not mirror-push private refs.
6. Confirm public branches, tags, releases, actions logs, packages, and downloadable
   artifacts contain only intended licensed material.

The private development repository remains private. After publication, choose and
document whether ongoing development occurs publicly or is periodically exported
as later licensed snapshots; do not silently mix the two histories.
