## Why

Some work cannot be delegated — live device debugging, for instance — and the fastest route to a
CLI as fluent as the human's own is to hand over the actual CLI process rather than approximate it
through attach. The daemon already computes everything a resume needs (the worktree path, the
stored session ref, the runtime's env overlay); it just never offers it, and offering a bare command
without a real ownership handoff would let the daemon and the human write to the same session and
worktree at once.

## What Changes

- A worker whose runtime can resume a session (checked via the runtime's own capability, not a
  hard-coded list) gets a "take this session" action that returns one paste-ready shell command:
  `cd` into the worktree, the runtime's own env-overlay variable(s) set inline, and the runtime's
  own resume invocation built from the same argument-building and binary-resolution code the daemon
  itself uses for a turn — never a hand-rolled copy of those flags.
- Taking a session pauses the worker with a distinct, structured reason and opens a handover
  record; while a handover is open the daemon SHALL NOT dispatch a turn to that agent (this already
  falls out of the dispatcher's existing exclusion of `paused` agents — a test makes the exclusion
  explicit for this new reason rather than relying on it by accident).
- Returning the session (`handback`) is a distinct action from an ordinary resume: it requires the
  human to leave a note, reconciles the worktree (new commits, dirty state) and the stored session
  ref against what they were when the handover started, posts a ticket comment recording what
  changed, and only then puts the worker back to `active`.
- A handover left open past a timeout is reconciled and closed automatically by the supervisor, the
  same way an idle interactive session already retires itself — no manual database repair is ever
  required to recover a worker whose human forgot to hand it back.
- The same "take this session" affordance is offered on a decision card raised for a worker, for the
  case captain described: a card whose real answer is "I need to do this myself."
- A runtime that cannot resume a session, or a worker with no session yet, offers no command and
  states why instead.

**BREAKING**: none — this adds new worker states and endpoints; it does not change how existing
pause/resume, attach, or session storage behave for the paths that do not opt into handover.

## Capabilities

### New Capabilities

- `session-handover/command`: computing and offering the one resume command for a worker's runtime
  and stored session, including the "no command, and why" cases.
- `session-handover/lease`: taking a session marks the worker held by a human and excludes it from
  dispatch until it is given back; an abandoned hold is reconciled and closed automatically past a
  timeout.
- `session-handover/handback`: giving a session back requires a note, reconciles worktree and
  session state against what they were at handover time, and records what changed.

### Modified Capabilities

- `run-recovery/paused-worker-visibility`: a worker paused because a human holds its session is a
  second exception (alongside the existing login-outage exception) to "resume is offered wherever a
  paused worker is shown" — it offers handback, not plain resume, because a plain resume would skip
  reconciliation.

## Impact

- `packages/db`: new migration adding a `agent_handovers` table (one row per hold: agent, runtime,
  session-ref and worktree-head snapshots at start, status, started/returned timestamps,
  reconciliation and note) and a new supervisor config default for the abandonment timeout.
- `packages/shared`: a new structured pause-detail code for "held by a human", alongside the
  existing `LOGIN_PAUSE_CODE` precedent.
- `packages/core`: `WorkersService` gains `startHandover`/`endHandover`; the supervisor gains an
  abandoned-handover sweep modeled on `retireIdleSessions()`. No change to `SessionsService`, the
  dispatcher's candidate query, or any adapter's `send`/live-input support.
- `packages/server`: new `POST /workers/:id/handover` and `POST /workers/:id/handback` routes,
  `routetable.ts` and `docs/API.md` entries.
- `packages/cli`: mirror verbs on `conductor worker`.
- `packages/ui`: a "take this session" action on the worker page and on a decision card raised for a
  worker, each showing the copyable command or the stated reason there is none; a handback form that
  requires the note.
- `packages/render`, `packages/tui`, session storage and the runtime adapters' `buildArgs`/session
  logic are read, not modified — this change reuses their existing pure functions rather than adding
  new ones that could drift from them.
