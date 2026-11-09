# Cloud family pilot backlog

Progress is **31 of 39**. The local implementation steps are complete. Items 32–39 require the hosted environment or the approved family handoff.

Target one shared deployment in one location with private PostgreSQL. Use `cloud.127vaults.com` as the family-facing entry point and separate canonical origins for the family vaults. Use `admin.127vaults.com` for routine operator actions. The deployment initializes the database from within the hosting environment. The operator uses a browser. Public signup and checkout stay closed.

- [x] **01. Record the pilot backlog.** Define the target, completion criteria, and progress count in this file.
- [x] **02. Enforce fixed enrollment seats.** Verified owner enrollment, invitation creation and redemption, over-cap rejection, and scoped seat lookup in the disposable PostgreSQL rehearsal.
- [x] **03. Compose the Cloud runtime.** Verified the standalone HTTPS listener against disposable PostgreSQL for active and prepared hosts, unknown hosts, and mismatched TLS names. The transport rehearsal uses stub OPAQUE. The image check below verifies the real bridge loads.
- [x] **04. Package the Cloud runtime.** Built the internal image with `pnpm cloud:build` and the default self-hosted target with Podman. Verified the packaged web vault and real OPAQUE setup/public-key generation in the Cloud image, and exclusion of Cloud code from the self-hosted image.
- [x] **05. Script first deployment.** Verified `cli.mjs deploy` initializes an empty database, creates and verifies the restricted login, and succeeds a second time without changing either. The HTTPS rehearsal uses that login.

## Code that can land before hosting

- [x] **06. Provision a tenant atomically.** Store the canonical host, seat limit, linked control owner, and OPAQUE setup in one transaction. Identical retries reuse the prepared tenant.
- [x] **07. Read the tenant directory.** List or inspect tenants with control owner, state, seat usage, and readiness to activate.
- [x] **08. Issue and replace owner setup links.** Generate a one-time capability on the tenant origin and allow operator reissue before owner enrollment. The browser reads the capability from the fragment.
- [x] **09. Activate, suspend, and resume tenants.** Activation requires completed owner enrollment. Suspension blocks new tenant requests and resumption restores routing.
- [x] **10. Change a tenant seat cap.** Serialize with enrollment and reject reductions below active users plus reserved invitation seats.
- [x] **11. Finish the browser owner setup handoff.** Open the Cloud setup form from the capability link and explain the pending activation state after registration.
- [x] **12. Define management API commands and errors.** The private command API implements list, provision, issue setup link, activate, suspend, resume, and seat changes with bounded JSON and stable error codes.
- [x] **13. Isolate the management service.** A separate HTTPS entry point uses a dedicated PostgreSQL login. The local rehearsal exercised all commands under that login and confirmed it cannot read OPAQUE setup bytes.
- [x] **14. Implement management service authentication.** The listener requires a dedicated service token and operator identifier and rejects browser-origin requests. Steps 16–17 cover authenticating the operator and wiring the Admin Worker.
- [x] **15. Record operator actions.** The management API records successful mutations in the same transaction as the change. The audit table contains action, tenant, actor, and timestamp. The family runtime cannot read it.
- [x] **16. Authorize named operators.** The Admin Worker requires a signed Access application token with the dedicated audience, an allowlisted named operator, and a signed IdP MFA claim. Live Access and IdP configuration belongs to step 33.
- [x] **17. Connect the Admin Worker.** The configured deployment receives only allowlisted commands, the verified operator subject, and server-side service credentials. Live deployment registration belongs to step 34.
- [x] **18. Build the Cloud tenant directory page.** The portal shows deployment, tenant URL, owner, lifecycle state, activation readiness, and seat usage.
- [x] **19. Build the tenant creation and setup actions.** The portal creates a tenant for an already verified control owner and lets the operator issue, replace, and copy an owner setup link.
- [x] **20. Build tenant lifecycle controls.** The portal exposes state-appropriate activation, suspension, resumption, and seat-cap actions.
- [x] **21. Build the family entry page.** The Cloud runtime serves invitation-only guidance on the reserved `cloud.127vaults.com` hostname. Setup and invitation links go directly to the tenant origin. HTTPS routing checks cover the landing assets, the host boundary, and the absence of vault API routes on the landing host.
- [x] **22. Build member invitation creation and revocation.** Owners create, copy, and revoke private tenant invitations from the web vault.
- [x] **23. Complete browser member enrollment.** A real OPAQUE browser rehearsal enrolled the first owner and an invited member using captured verification mail.
- [x] **24. Wire the invitation verification transport.** The runtime supports explicit private SMTP and loopback file capture. The local rehearsal reads a captured code without calling an email provider.
- [x] **25. Build the family roster.** Owners see tenant members, invitation state, and seat usage. The local PostgreSQL rehearsal rejects cross-tenant access.
- [x] **26. Implement family member suspension and reactivation.** The PostgreSQL rehearsal verifies session invalidation, seat enforcement, and that a revoked session stays revoked after reactivation.
- [x] **27. Complete web client tenant binding.** Browser enrollment and unlock pin the canonical origin, tenant, and authentication identity. Sync checks the pinned checkpoint key. The local browser rehearsal covers sign-in and a persisted vault item.
- [x] **28. Complete desktop client tenant binding.** Desktop connects to a tenant through HTTPS discovery, then enrolls through the existing trusted-device approval flow. The native client pins tenant and protocol keys. Local native tests and the Desktop build passed. Hosted native enrollment remains part of step 37.
- [x] **29. Implement trusted Cloudflare ingress handling.** The optional loopback Tunnel adapter preserves Host and TLS SNI and validates client source metadata. Hosted certificate and route configuration belongs to step 33.
- [x] **30. Add deployment status and restart procedures.** `/healthz` checks readiness on the Cloud landing host. The Cloud runbook documents restart and rollback.
- [x] **31. Script encrypted pilot backups.** A disposable Linux/PostgreSQL rehearsal restored the authenticated database dump and both runtime keys. Live backup scheduling belongs to step 35.

## Hosted environment and handoff

- [ ] **32. Provision the single hosting location and private PostgreSQL.** Record the deployment identity and configure production secrets.
- [ ] **33. Configure Cloudflare DNS and HTTPS.** Set up the landing and tenant routes, edge and origin certificates, and the protected management route.
- [ ] **34. Deploy the runtime and Admin Worker configuration.** Initialize production and register the Cloud deployment in the admin backend.
- [ ] **35. Enable production backup scheduling.** Configure the encrypted destination and run schedule.
- [ ] **36. Verify hosted operator provisioning.** Create and activate two synthetic tenants from the production portal.
- [ ] **37. Verify hosted family enrollment and sync.** Exercise real owner and member enrollment, tenant separation, and sync.
- [ ] **38. Prepare the approved family tenants.** Set the real tenant URLs, control owners, and seat allowances.
- [ ] **39. Hand off the pilot.** Share setup details privately with the approved family leads and record the handoff without posting credentials.
