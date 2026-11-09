# Cloud family pilot backlog

Progress is **41 of 52**. The original 39 items remain numbered, with 13 follow-up items for the shared-host handoff. Items 32–39 require the hosted environment or the approved family handoff.

Target one deployment in one location with private PostgreSQL. Use `https://cloud.127vaults.com/` for the public invitation-only landing page and `/t/<slug>/` for each family. Use `admin.127vaults.com` for platform operations, `manage.127vaults.com` for customer accounts, and local `/admin` for self-hosted administration. The deployment initializes the database inside the hosting environment. Public signup and Cloud checkout stay closed.

- [x] **01. Record the pilot backlog.** Define the target, completion criteria, and progress count in this file.
- [x] **02. Enforce fixed enrollment seats.** Verified owner enrollment, invitation creation and redemption, over-cap rejection, and scoped seat lookup in the disposable PostgreSQL rehearsal.
- [x] **03. Compose the Cloud runtime.** Verified the standalone HTTPS listener against disposable PostgreSQL for active, prepared and unknown tenant paths, and mismatched TLS names. The transport rehearsal uses stub OPAQUE. The image check below verifies the real bridge loads.
- [x] **04. Package the Cloud runtime.** Built the internal image with `pnpm cloud:build` and the default self-hosted target with Podman. Verified the packaged web vault and real OPAQUE setup/public-key generation in the Cloud image, and exclusion of Cloud code from the self-hosted image.
- [x] **05. Script first deployment.** Verified `cli.mjs deploy` initializes an empty database, creates and verifies the restricted login, and succeeds a second time without changing either. The HTTPS rehearsal uses that login.

## Code that can land before hosting

- [x] **06. Provision a tenant atomically.** Store the slug, seat limit, linked control owner, and OPAQUE setup in one transaction. Identical retries reuse the prepared tenant.
- [x] **07. Read the tenant directory.** List or inspect tenants with control owner, state, seat usage, and readiness to activate.
- [x] **08. Issue and replace owner setup links.** Generate a one-time capability on the canonical tenant path and allow operator reissue before owner enrollment. The browser reads the capability from the fragment.
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
- [x] **21. Build the family entry page.** The Cloud runtime serves invitation-only guidance at `/`. Setup and invitation links go directly to the canonical tenant path. HTTPS routing checks cover the landing assets, the host boundary, and denial of vault API routes at the root.
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

Local rehearsals cover the database and role setup for step 32, the HTTPS and management boundaries for steps 33–34, the scheduled backup entry point for step 35, and the two-family operator and browser journeys for steps 36–37. The Admin browser rehearsal uses a locally signed Access assertion, the real Worker handler, and a separate HTTPS management listener. A live Access policy, deployed Worker, and packaged Desktop enrollment still need hosted verification. Keep the hosted checkboxes open until those actions happen in the pilot environment.

- [ ] **32. Provision the single hosting location and private PostgreSQL.** Record the deployment identity and configure production secrets.
- [ ] **33. Configure DNS and HTTPS.** Route one public vault hostname and certificate to the deployment. Keep the platform management route independently protected. Cloudflare Tunnel is optional for vault ingress.
- [ ] **34. Deploy the runtime and Admin Worker configuration.** Initialize production and register the Cloud deployment in the admin backend.
- [ ] **35. Enable production backup scheduling.** Configure the encrypted destination and run schedule.
- [ ] **36. Verify hosted operator provisioning.** Create and activate two synthetic tenants from the production portal.
- [ ] **37. Verify hosted family enrollment and sync.** Exercise real owner and member enrollment, tenant separation, and sync.
- [ ] **38. Prepare the approved family tenants.** Set the real tenant URLs, control owners, and seat allowances.
- [ ] **39. Hand off the pilot.** Share setup details privately with the approved family leads and record the handoff without posting credentials.

## Shared-host handoff

- [x] **40. Replace tenant subdomains with tenant paths.** Route `/t/<slug>/` through the standalone HTTPS server. Keep the root invitation-only.
- [x] **41. Keep tenant identity stable.** The slug resolves to an immutable tenant UUID for authorization, PostgreSQL scoping, browser identities and replicas. The overlay requires a fresh database for the first hosted deployment. A database made by the earlier hostname prototype fails the checksum check and must be preserved separately.
- [x] **42. Carry the tenant URL through provisioning and clients.** Operator actions use slugs, setup and invitation links contain the path, and discovery and Desktop trust preserve it.
- [x] **43. Enforce same-origin tenant boundaries.** Keep server sessions and enrollment scoped to the tenant UUID. Scope the PWA shell to its tenant path and keep API responses out of that cache.
- [x] **44. Support one active Cloud tenant per browser profile.** Changing tenants locks other tenant tabs. Browser device identity and queued operations stay associated with their tenant UUID.
- [x] **45. Record simultaneous sessions as future work.** Independent sessions and an explicit tenant switcher are outside the two-family pilot.
- [x] **46. Put Cloud family administration inside the vault.** Settings → Family members shows the roster, invitations, seat usage and vault-owner controls.
- [ ] **47. Complete Cloud account and billing in Manage.** Read-only tenant state, allocated seats and the family settings link are implemented. A Cloud-only control owner can use the operator-assisted sign-in flow when enabled. Connect live directory ingress and add billing records for a future paid offering. Customer checkout and seat purchases stay deferred.
- [x] **48. Show self-hosted license and seats in local Admin.** The server overview reports the installed license and links to Manage subscriptions.
- [x] **49. Preserve local Admin.** Keep the installation-specific operator login, health and administration.
- [ ] **50. Reuse People, Invitations and Seats presentation.** Cloud and local Admin share the seat summary. People and invitation presentation still use their existing separate UI.
- [x] **51. Keep central Admin for platform operators.** Use it to provision, activate, suspend and resume tenants and set pilot seat limits.
- [ ] **52. Finish end-to-end pilot verification.** Local two-family checks cover real OPAQUE enrollment and sync, cross-path rejection, tab locking, replay of a queued write only after returning to its original tenant, and customer-directory credential separation. Finish packaged Desktop enrollment and sync against the deployed HTTPS hostname and verify hosted Manage.
