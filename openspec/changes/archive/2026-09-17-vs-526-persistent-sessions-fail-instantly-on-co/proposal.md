## Why

A persistent role session backed by codex fails on its first message with a bare
`failed · codex · 0 tok · $0.00` and no reason shown anywhere, and a session is stuck on whatever
worker option its role happened to be created with. Diagnosed from the real run
`01M2RKMW3ZK3YMRQ9JTBHMBF7V` (agent `01M2RKMSA99DR2MJBRHWZX5XVZ`, Fernwood Full-stack Engineer
session, 2026-09-17):

- The run lasted **32 ms**, exited 1, produced **no runtime output at all** — its `events.jsonl`
  holds only the seven system events (`run.started` … `run.finalized` with
  `{"status":"failed","liveness":"failed"}`), and codex wrote no rollout.
- The ticket's stated diagnosis ("codex refuses to run outside a git repository because
  `--skip-git-repo-check` was not passed") is **not what the code does**: the codex adapter has
  passed `--skip-git-repo-check` since 2026-09-04, in both deployed revisions of the daemon that
  served the session (`fd96fea4` and its predecessor). With the flag, codex 0.154.0 runs fine in a
  non-git directory: re-running the adapter's exact invocation from that session's own home
  directory succeeds (`turn.completed`, exit 0). What is certain is the observability failure: the
  engine discards the runtime's raw stream (`engine.ts:557`), the codex parser emits no typed
  `error` for a startup failure, so the reason is thrown away and the run records `exit_1` with an
  empty message.
- Separately, a ticketless session's home is not a git checkout and carries none of the project's
  code, so a session that is asked to *look at* the project (the point of chatting with an engineer
  role) has nothing to look at — and a runtime that enforces a git-repo precondition has no repo.

## What Changes

- **A persistent session is given a project workspace.** A ticketless session's turn runs with a
  real, readable checkout of its project as its working directory, so the runtime has a git
  repository and the session can inspect the project's code. The session home keeps the rendered
  instructions (and its `.agents`/`.claude` instructions, which the runtimes read from `CODEX_HOME`
  / cwd). The workspace is the project's registered clone path, which the daemon already keeps
  fetched; if a project has no clone the session's directory is initialised as a git repository
  instead, so codex can still start.
- **A runtime's startup failure names its cause.** When a turn fails with no structured runtime
  error, the runtime's captured stderr is recorded on the run and surfaced where the failure is
  shown (session/agent UI + run detail) instead of a bare `failed`. Codex's parser emits a typed
  `error` for a non-zero exit with no `turn.*` output, carrying the first meaningful stderr line.
- **A session's worker option is selectable and changeable.** A persistent session runs on a worker
  option from the effective catalog (`quick`/`standard`/`deep`…), chosen when the session is opened
  and changeable at any time from the session's own surface; the option resolves the turn's runtime,
  model and effort exactly as it does for a ticket.
- **Changing the runtime visibly restarts the conversation.** A model/effort change within one
  runtime keeps the session; a change that moves the session to a different runtime starts a fresh
  conversation on the new runtime (a session handle belongs to the CLI that issued it — VS-77). The
  UI states, at the moment of the change, which of the two is about to happen before it is applied.
- **The same class of assumption is checked for every runtime.** Each configured runtime is
  exercised (or named with a reason it cannot be) for a ticketless session start.
- The ticketless session surface shows its current option, and exposes the change control.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `persistent-sessions`: add requirements for a session workspace every runtime can start in, a
  session option that is chosen when the session is opened and changeable afterwards with a stated
  effect on the conversation, and a runtime startup failure that names its cause.
- `model-selection/turn-resolution`: a persistent session's runtime and model come from its own
  chosen option rather than the workers setting; the existing "changing the runtime starts a new
  session" behaviour gains the session-option transition and what the UI must state about it.

## Impact

- `packages/core/src/runs/engine.ts` — session turn cwd/workspace; runtime stderr capture on a
  missing structured error.
- `packages/core/src/workers/index.ts`, `packages/core/src/sessions/index.ts`,
  `packages/core/src/models/resolve.ts` — session option storage/resolution and session retirement
  on a runtime change.
- `packages/runtimes/codex/src/*`, and a per-runtime audit of the ticketless-session start.
- `packages/server/src/routes/workers.ts`, `packages/ui/src/v2/RolesPage.tsx`,
  `packages/ui/src/v2/WorkerPage.tsx`, `packages/ui/src/api/*` — option selection, change control
  and the history effect shown before applying.
- Evidence: the failing session's agent/report rows (read-only), plus a fake-codex regression test
  for the silent-failure path. Rendered light/dark, desktop/phone captures for the UI.
