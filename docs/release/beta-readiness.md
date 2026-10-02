# Release readiness

Updated 2026-10-02. The [product work index](../product/README.md) links the only live backlogs and active waves for web, CLI, desktop, and server. This page defines the release decision; it is not another task list.

## Current decision

The narrow fictitious-data server and browser flow are an **internal experimental MVP**. The offline server bundle is an operator-led test distribution. There is no supported first release or public beta for real credentials yet. The [server backlog](../product/server-backlog.md) records each remaining server acceptance condition, and the [selected real-data pilot gate](selected-real-data-pilot.md) governs any user-selected live credential.

## First supported release gate

A release candidate needs a repeatable installation and upgrade path, tested recovery of database and installation identity, a second-host deployment, client reconnection, complete operator guidance, and reviewed build provenance. The exact client surface being shipped must meet its own [web](../product/web-backlog.md), [CLI](../product/cli-backlog.md), or [desktop](../product/desktop-backlog.md) acceptance conditions.

## Real-secret public beta gate

Before inviting real-secret use, freeze versioned cryptographic and protocol formats with deterministic vectors and compatibility rules; obtain independent cryptographic and application review; exercise authentication, device lifecycle, authorization, sync replay/fork/rollback, backup, restore, and upgrade under adverse conditions; finish dependency, image, secret-history, signing, and legal review. Verify external SMTP if invited-user email is included. Keep the distribution explicitly experimental until these conditions are accepted.

The [server installation runbook](server-test-install.md) contains current operator commands. The [S1 evidence](server-wave-s1-evidence.md) records local Podman results with fictitious data. Manual second-container, Docker, private-LAN browser, and SMTP tests are deferred at the user's request and remain open in the server backlog.