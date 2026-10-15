# Windows launch policy investigation — October 15, 2026

The earlier checkpoint's attribution to **automatic approval review** was too
specific. The original retained tool output proves a command-execution rejection,
not which component or rule made it. It does not establish a policy configured by
the user or a rejection by Windows itself.

The October 13 14:53:12 UTC output in the October 12 retained rollout records
`exec_command failed: CreateProcess` and `rejected: blocked by policy` for the
PowerShell command that set the fictitious Desktop profile/WebView2 inspector,
started its extracted executable and drove its GUI fixture. The same attempted
command was rejected again at 15:12:34 UTC. Neither error names a rule, gives a
review rationale or establishes that the executable ever ran. The evidence is
local session history, not a product log from 127Vaults. No raw session history
or unrelated task data is copied into the repository.

Current read-only inspection of the user's Codex configuration found:

- `approval_policy = "never"`
- `approvals_reviewer = "user"`
- `sandbox_mode = "danger-full-access"`

The current task's execution instructions also specify no sandbox and approvals
never. These are today's settings; they do not prove what generated the original
rejection. No settings, execution rules or managed requirements were modified.

Official [Auto-review documentation](https://learn.chatgpt.com/docs/sandboxing/auto-review)
says automatic review handles eligible interactive sandbox escalations and is
not used when approval policy is never. Official
[agent approvals documentation](https://learn.chatgpt.com/docs/agent-approvals-security)
distinguishes sandbox, approval, execution and managed controls. The generic
error alone is insufficient to choose among those layers or establish its exact
cause. Current config therefore gives no basis to tell the user to disable a
policy they configured, or to claim that automatic review is currently enabled.

## Remaining action

The actual denying rule/reason remains unavailable in the inspected evidence.
If the client exposes details for the original denied action, inspect those or
collect a narrowly scoped client diagnostic/support report. Do not modify security
controls or retry the blocked launch through another executable or launcher.
Static Windows artifact preparation and existing Linux DOM/native acceptance can
continue. Latest Windows GUI acceptance remains unproven until an authorized
supported launch is available; this investigation does not waive that gate.
