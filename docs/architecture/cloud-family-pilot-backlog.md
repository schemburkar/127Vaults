# Cloud family pilot backlog

Progress is the number of checked items out of 20. Keep the item numbers stable and record verification alongside the item when closing it.

Target one shared deployment in one location with private PostgreSQL. Use `cloud.127vaults.com` as the family-facing entry point and separate canonical origins for the family vaults. Use `admin.127vaults.com` for routine operator actions. The deployment initializes the database from within the hosting environment. The operator uses a browser. Public signup and checkout stay closed.

- [x] **01. Record the pilot backlog.** Define the target, completion criteria, and progress count in this file.
- [x] **02. Enforce fixed enrollment seats.** Verified owner enrollment, invitation creation and redemption, over-cap rejection, and scoped seat lookup in the disposable PostgreSQL rehearsal.
- [x] **03. Compose the Cloud runtime.** Verified the standalone HTTPS listener against disposable PostgreSQL for active and prepared hosts, unknown hosts, and mismatched TLS names. The transport rehearsal uses stub OPAQUE. The image check below verifies the real bridge loads.
- [x] **04. Package the Cloud runtime.** Built the internal image with `pnpm cloud:build` and the default self-hosted target with Podman. Verified the packaged web vault and real OPAQUE setup/public-key generation in the Cloud image, and exclusion of Cloud code from the self-hosted image.
- [x] **05. Script first deployment.** Verified `cli.mjs deploy` initializes an empty database, creates and verifies the restricted login, and succeeds a second time without changing either. The HTTPS rehearsal uses that login.
- [ ] **06. Connect hosting and HTTPS.** Choose the hosting location and private PostgreSQL service. Configure Cloudflare DNS, edge and origin certificates, canonical host routing, and trusted ingress. Register the production deployment explicitly.
- [ ] **07. Complete operator lifecycle operations.** List and inspect tenants, prepare a tenant with a fixed seat limit and linked control owner, issue or reissue owner setup, report readiness, and activate, suspend, or resume.
- [ ] **08. Add the protected management API.** Expose typed lifecycle commands and status with dedicated privileges and audit records. Keep management credentials and traffic separate from the family vault API.
- [ ] **09. Authorize named Cloud operators.** Add named sign-in, MFA, and a Cloud management permission for production actions in the central admin portal.
- [ ] **10. Connect the Admin Worker.** Configure the deployment endpoint and scoped service identity server-side. Pass authenticated operator identity to the management API and return errors the portal can act on.
- [ ] **11. Add the Cloud tenants page.** Show deployment, tenant hostname, control owner, lifecycle state, and seat usage. Make create, reissue, activate, suspend, and resume available from the browser.
- [ ] **12. Add the family entry point.** Serve invite-only guidance at `cloud.127vaults.com` and take owners and members to the canonical tenant origin from their setup or invitation link.
- [ ] **13. Complete owner setup.** Let the family lead create their own vault credentials with a one-time setup capability and show the operator when the tenant is ready to activate.
- [ ] **14. Complete member invitations.** Let owners create and revoke tenant-scoped invitations and members redeem them. Provide a private verification delivery path and local capture for verification runs.
- [ ] **15. Add family management.** Show owners their members, pending invitations, and seats. Let them suspend or reactivate a member within their tenant.
- [ ] **16. Support seat changes.** Let authorized operators update a tenant's seat allowance with consistent accounting for enrolled members and reserved invitations.
- [ ] **17. Complete client enrollment and sync.** Verify supported web and desktop paths use the canonical origin and tenant identity and can sync a newly enrolled vault. Document pilot client coverage.
- [ ] **18. Establish pilot operations.** Document restart and rollback, capture minimal service and error status, and configure private encrypted backups of PostgreSQL and required key material.
- [ ] **19. Verify the hosted flow.** From the production admin portal, provision two separate tenant spaces and confirm real owner login, member enrollment, tenant separation, and sync with synthetic data.
- [ ] **20. Hand off the two family tenants.** Privately provide the approved family leads their setup details, confirm that each can manage its tenant, and record the operator and family handoff in this chat without posting credentials.
