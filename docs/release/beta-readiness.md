# Release readiness

Reviewed 2026-10-18. The [product work index](../product/README.md) links the only live component backlogs for web, browser extension, CLI, desktop, and server. This page defines the release decision; it is not another task list.

## Current decision

The 2026-10-12 user-selected cut requires Windows and Linux desktop/CLI,
web/PWA, server, extension and admin writes. The
internal candidate evidence (internal record retained outside Git)
records implemented management writes, schema-7 recovery and native backend
checks, with the installed-extension/GUI/human acceptance still open. This
internal decision does not waive the supported-release or real-secret gates.

The fictitious-data server, browser/PWA and installed-client flows remain an **internal experimental release**. The offline server bundle is an operator-led test distribution. There is no supported first release or public beta for real credentials yet. The [server backlog](../product/server-backlog.md) records each remaining server acceptance condition, and the [selected real-data pilot gate](selected-real-data-pilot.md) governs any user-selected live credential.

## First supported release gate

A release candidate needs a repeatable installation and upgrade path, tested recovery of database and installation identity, a second-host deployment, client reconnection, complete operator guidance, and reviewed build provenance. The exact client surface being shipped must meet its own [web](../product/web-backlog.md), [CLI](../product/cli-backlog.md), or [desktop](../product/desktop-backlog.md) acceptance conditions.

## Real-secret public beta gate

Before inviting real-secret use, freeze versioned cryptographic and protocol formats with deterministic vectors and compatibility rules; obtain independent cryptographic and application review; exercise authentication, device lifecycle, authorization, sync replay/fork/rollback, backup, restore, and upgrade under adverse conditions; finish dependency, image, secret-history, signing, and legal review. Verify external SMTP if invited-user email is included. Keep the distribution explicitly experimental until these conditions are accepted.

The [server installation runbook](server-test-install.md) contains current operator commands. The S1 evidence (internal record retained outside Git) records local Podman results with fictitious data. Manual second-container, Docker, private-LAN browser, and SMTP tests are deferred at the user's request and remain open in the server backlog.
