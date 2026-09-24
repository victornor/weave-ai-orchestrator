# codex-runtime Specification

## Purpose
Defines how a Codex turn is executed and observed: text, reasoning and running tools reach the page as they happen, the turn keeps every guarantee it had under `codex exec --json` (permission postures, session resume, cancel, usage, error classification), and a turn never fails merely because the streaming transport is unavailable.

## Requirements

### Requirement: A Codex turn is driven through the app-server
The Codex adapter SHALL run a turn by starting `codex app-server` over stdio under the same containment, environment, working directory, model, effort and MCP configuration as an `exec` turn, starting or resuming the thread, sending the prompt with `turn/start`, and translating the server's notifications until `turn/completed`. It SHALL report the thread id as the session reference, and the turn's token usage from the server's usage notifications on the same basis as today.

#### Scenario: New turn streams
- **WHEN** a Codex worker turn runs and the model produces text and a command
- **THEN** the run emits a partial for each text and command-output delta, a `tool.call` when the command starts, and the same completed events an `exec` turn produces

#### Scenario: Resume
- **WHEN** a run resumes a session that holds a Codex thread id
- **THEN** the turn continues that thread and the session reference keeps the same thread id

### Requirement: A tool shows as running from its start
The adapter SHALL emit `tool.call` when a command execution, file change or MCP tool call item starts, carrying the command, path or arguments, and SHALL emit its result when the item completes. A completed event SHALL carry the id of the item its partials belonged to.

#### Scenario: Long command
- **WHEN** a command runs for several seconds
- **THEN** the page shows it as running with its output so far, and completes it in place

### Requirement: Approvals follow the permission mode
The adapter SHALL answer every server-initiated approval request without a human: `bypass` runs with approval policy `never` and no sandbox; `restricted` uses a read-only sandbox and declines every request; `auto` uses a workspace-write sandbox with policy `on-request` and declines command, file-change and permission escalations while accepting the run-scoped MCP server's tool calls. A request the adapter does not recognise SHALL be declined, never left unanswered.

#### Scenario: Escalation in auto mode
- **WHEN** the model asks to run a command outside the sandbox in `auto` mode
- **THEN** the request is declined and the turn continues

#### Scenario: Unknown request
- **WHEN** the server sends a request method the adapter does not know
- **THEN** it is answered with a decline or an error response and the turn does not hang

### Requirement: Cancel and cut-off streams are safe
Cancelling a turn SHALL interrupt the turn, then terminate the app-server process. If the server exits or its stream ends before `turn/completed`, the turn SHALL fail with the runtime's stderr reason, the run's outcome SHALL be decided as for an `exec` turn that ended early, and partials SHALL be dropped.

#### Scenario: Cancel mid-stream
- **WHEN** a run is cancelled while agent text is streaming
- **THEN** the turn is interrupted, the process stops, and the page shows no partial after the cancellation

#### Scenario: Server dies mid-turn
- **WHEN** the app-server exits after some deltas and before `turn/completed`
- **THEN** the turn is failed with a reason and is not reported as completed

### Requirement: The exec path remains the fallback
If the app-server cannot be started, does not answer `initialize` or `thread/start`/`thread/resume` within ten seconds, or rejects the thread request before a turn is under way, the adapter SHALL run the turn through `codex exec --json` exactly as before, including startup-failure reasons taken from stderr. Setting `options.appServer` to `false` SHALL select `exec` directly. A failure after `turn/start` was accepted SHALL NOT fall back, so a prompt is never run twice.

#### Scenario: Server does not start
- **WHEN** `codex app-server` exits before answering `initialize`
- **THEN** the turn runs through `codex exec --json`, completes normally, and shows whole steps only

### Requirement: Partial output is redacted like persisted events
Every partial frame SHALL pass through the same secret redaction as persisted events before it is broadcast.

#### Scenario: Secret in command output
- **WHEN** a command prints a registered secret while streaming
- **THEN** the partial frame carries the redacted text

### Requirement: A workspace-write Codex turn can write its worktree's git metadata

When a Codex turn runs under the `workspace-write` sandbox (permission mode `auto`), the adapter
SHALL add the checkout's git common directory as an additional sandbox writable root, so the
per-worktree metadata a git worktree stores under the main clone's `.git/worktrees/<name>/`
(such as `index.lock` and `HEAD`) is writable. The adapter SHALL resolve that directory from the
run's checkout: a `.git` directory is itself the common directory; a linked worktree's `.git`
file (`gitdir: <gitdir>`) resolves through `<gitdir>/commondir`. When the checkout lies outside
the turn's working directory, the adapter SHALL add the checkout as a writable root too. The
adapter SHALL add roots only to a `workspace-write` turn: `restricted` stays `read-only` and
`bypass` stays unsandboxed. A checkout whose git directory cannot be resolved SHALL NOT fail the
turn.

#### Scenario: A Codex worker commits from its worktree checkout

- **WHEN** a Codex worker in `auto` mode runs in a git worktree whose common dir is outside its working directory
- **THEN** its invocation carries the git common directory among `sandbox_workspace_write.writable_roots`
- **AND** `git add` and `git commit` inside the checkout succeed instead of failing with a read-only filesystem error

#### Scenario: A resumed or forked worker keeps the writable root

- **WHEN** an `auto` Codex worker resumes or forks a session in the same worktree
- **THEN** that invocation carries the git common directory among its writable roots as well

#### Scenario: Read-only and bypass turns gain no root

- **WHEN** a Codex turn runs in `restricted` or `bypass` mode
- **THEN** its invocation carries no `sandbox_workspace_write.writable_roots`

#### Scenario: An unresolvable checkout does not fail the turn

- **WHEN** the run's checkout has no readable `.git` file or directory
- **THEN** the turn runs with the same sandbox it has today and is not failed by the missing root
