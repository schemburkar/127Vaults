# Agent credential access: research and integration choices

Researched 2026-10-07. This is decision support, not an accepted design or a live backlog. No agent-access feature is implemented by this document.

## Finding

Agent credential access has several different consumers. A browser needs a signed-in session; a deployment executable needs runtime authentication; an API connector needs a token; an SSH client needs a signing operation. MCP can expose discovery and access requests, but it does not determine where plaintext must exist or who can inspect it.

The evidence below combines official implementation documentation with a small qualitative sample of public developer discussions. Vendor statements describe intended behavior, not independently verified guarantees. Community discussions show individual problems, not prevalence or market size. Mutable repository documentation and preview features need version-specific verification before implementation.

## Where credentials are needed

| Workflow | Actual consumer | Integration worth evaluating | Plaintext boundary |
| --- | --- | --- | --- |
| Website login, including OTP | Browser login executor | Extension or browser-runtime adapter | Destination page and browser runtime see the credential during login |
| Deployment, database access, scripts | CLI executable or SDK | Scoped run wrapper or credential-provider hook | Child process receives plaintext unless a separate proxy substitutes it |
| SaaS actions through tools | API connector | Credential broker, OAuth connection, or constrained request proxy | Connector or proxy authenticates the downstream call |
| Git/SSH authentication | SSH client requesting a signature | SSH-agent interface | Broker can sign without exporting the private key |
| Unattended remote work | Worker, container, or hosted tool runtime | Enrolled workload identity plus nearby broker | Depends on delivery mode and worker isolation |

### Browser access

[1Password's Claude security documentation](https://support.1password.com/1password-claude-security/) describes paired applications, authenticated sessions, user-approved items, and metadata-only agent responses. Its extension fills and submits while the agent stops observing the page; failed submission clears fields before observation resumes. It explicitly distinguishes credential protection from actions taken after login and acknowledges same-user or administrative compromise.

[Browser Use's official example](https://github.com/browser-use/browser-use/blob/main/examples/features/sensitive_data.py) supplies placeholder names with domain-specific values that the runtime resolves. Its [implementation](https://github.com/browser-use/browser-use/blob/main/browser_use/agent/service.py) warns about sensitive-data use without allowed domains. This is a browser-runtime integration, not proof that every screenshot, history file, or arbitrary page-inspection tool is safe.

Implication for 127Vaults: our existing human-triggered extension is a useful foundation, but agent-safe login would require cooperation from the browser agent to pause observations and prevent alternative inspection during credential delivery. Password masking alone is insufficient. Cookies and persistent authenticated contexts are also credentials.

### Executables and MCP backends

[1Password CLI](https://www.1password.dev/cli/secrets-scripts) supports secret references, runtime environment injection, and subprocess execution. [Bitwarden Agent Access](https://github.com/bitwarden/agent-access) is an early-preview protocol, CLI, and SDK; examples include injecting PostgreSQL credentials into `psql`, feeding Docker login, and requesting credential values directly through an SDK.

Implication: preventing a secret from appearing in a tool response is different from preventing the agent-controlled executable from reading it. A wrapper around arbitrary scripts cannot promise that the secret stays inaccessible to the agent. Fixed operations, isolated executables, and credential scope materially affect that boundary.

[Bitwarden's separate MCP server](https://github.com/bitwarden/mcp-server/blob/main/README.md) documents a native password dialog for unlock, but also explicitly permits reading vault passwords and warns that AI responses can expose them. A credential-access protocol and a vault-management MCP server therefore serve different purposes and provide different protections.

### API connectors and network brokers

[Composio authentication](https://docs.composio.dev/docs/authentication) uses user-specific connected accounts, user-facing connection links, and managed token refresh. The tool requests connection; the user authenticates outside the model; the connector uses stored credentials.

[NVIDIA OpenShell provider documentation](https://docs.nvidia.com/openshell/latest/how-it-works/providers/overview) describes opaque values inside a sandbox and a proxy that resolves them before forwarding permitted HTTP requests. Network permission and credential destination bindings are separate checks. The documentation currently identifies v0.1.2; exact support must be verified against the release selected for integration.

Implication: a broker outside the agent runtime can preserve API-key secrecy while permitting authorized operations. It needs strict destination and operation policy, careful redirects, authentication and output handling. It is more involved than environment injection and does not automatically cover every protocol or browser login.

### SSH and Git

[1Password SSH-agent security](https://www.1password.dev/ssh/agent/security) describes per-key application or session approval and signing without exporting private keys. This is a concrete example of credential use that does not require credential retrieval. It still grants the approved client the ability to authenticate and act remotely.

## What developers ask for

Three sampled discussions expose useful product requirements:

- [Repeated MCP authorization prompts](https://www.reddit.com/r/1Password/comments/1q4q0xc/global_authorization_grace_period_for_1password/): users want fewer prompts across repeated calls. The design question is a bounded grant per client/task, rather than blanket authorization for unrelated tools.
- [Remote coding-agent credential access](https://www.reddit.com/r/1Password/comments/1rmhq7e/i_built_a_tool_that_lets_ai_coding_agents_access/): remote machines and containers make local interactive authentication inconvenient; users want request/approve flows and narrow credential selection.
- [Secrets with shell access](https://www.reddit.com/r/AI_Agents/comments/1vc9iu3/how_are_you_handling_secrets_when_an_agent_has/): users distinguish allowing commands to authenticate from allowing secret export, and discuss short-lived credentials, audit, offline access, and brokers.

These are qualitative signals. We have not established which workflow dominates among prospective 127Vaults users.

## Proposed direction, subject to product choice

Build a reusable grant and credential-use layer in the native client engine, then adapters for actual consumers. MCP would expose requests, approved metadata, status, and constrained operations. It should not be the only place enforcing permissions. The requesting client, granted vault/items, destination, permitted operation, expiry, and offline policy must be checked at the credential-use boundary.

For a developer-focused first version, evaluate CLI execution and MCP-backend authentication, with an accurately stated child-process exposure boundary. For browser-focused users, evaluate an extension/browser-runtime login adapter first. For a strong claim that agent-controlled code cannot inspect API secrets, evaluate an isolated request broker. These are separate engineering scopes.

Keep human unlock separate from agent authorization. The master password stays in the trusted desktop or terminal UI. Remote unattended access needs explicit enrollment and scoped machine authority; it cannot depend indefinitely on an unlocked personal desktop. Offline grants cannot instantly receive remote revocations, and grant expiry cannot revoke credentials already copied by an authorized consumer.

Next validation should use three concrete workflows: a browser login, a database/deployment command, and an authenticated API/MCP call. Identify the executable, extension, or connector that actually consumes each credential and what the agent can inspect. Choose the first supported workflow from those results rather than selecting MCP hosting in isolation.
