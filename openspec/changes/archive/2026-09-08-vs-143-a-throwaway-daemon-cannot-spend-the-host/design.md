## Context

Two independent bugs combined into the incident described in `proposal.md`:

1. `credentialPaths()` (`packages/core/src/workspace/loader.ts:326`) builds the *host* side of the
   credential symlink from `process.env.HOME` unconditionally. `linkRuntimeCredentials()` then
   symlinks each workspace's `.agent-conductor/runtimes/<runtimeId>/.credentials.json` to that fixed
   path. A daemon's `--config-dir` (`packages/server/src/daemon.ts:58`) controls where the *daemon's
   own* state lives (`daemon.yaml`, `workspaces.yaml`, `daemon.sqlite`) but never reaches
   `credentialPaths()`, so every daemon on a host — however isolated its own config — still symlinks
   to the same real `~/.claude/.credentials.json`.
2. `packages/core/src/runs/dispatcher.ts:92` (`tick()`) claims any agent's queued wake and spawns a
   run for it, filtered only by concurrency caps and `needs_login`. There is no notion of "a human
   asked for this." `conductor project add` (`packages/core/src/projects/index.ts` `describeTicket()`)
   creates a scout ticket and wakes the conductor as a normal, desired side effect
   (`workspace-setup/setup-jobs` already specs this sub-step) — it is the *automatic dispatch* of that
   wake and of the ticket once assigned, not its creation, that is the hazard.

`WorkspaceContext` (`packages/core/src/context.ts`) already carries a `daemon: DaemonConfig` — the
parsed `daemon.yaml` — but nothing about *how* the daemon was started (its `configDir`, or whether a
flag overrode it). That has to be added.

## Goals / Non-Goals

- Goal: a daemon started the way `CLAUDE.md` documents today (`--config-dir <tmp>`) is safe by
  default against both hazards, with no new flag required to get that safety.
- Goal: an operator who deliberately wants a second real daemon on the host — sharing the login and
  dispatching autonomously — can still get that, but only by saying so explicitly.
- Goal: `conductor project add`'s scout ticket keeps being created in every mode; only its autonomous
  execution is gated.
- Non-goal: distinguishing "isolated" from "not isolated" for anything other than credential
  resolution and run dispatch. No other subsystem reads this flag.
- Non-goal: a new API/CLI surface for "dispatch this one run." A human's existing paths — sending a
  chat message, answering a decision, or any other action that enqueues a wake with
  `requestedBy: {kind: 'human'}` — already are the explicit ask; nothing new needs to be built for a
  human to use an isolated daemon interactively.
- Non-goal: touching `workspace-setup/setup-jobs` or the scout ticket's creation path. Untouched by
  design, confirmed by the modified-capabilities list (empty for that spec).

## Decisions

### D1 — Isolation is derived from the resolved config directory, not a new required flag

`startDaemon()` already receives `opts.configDir` (`packages/server/src/daemon.ts:41`) and falls back
to `workspaceLoader.configDir()` — the default resolution
(`AC_CONFIG_HOME` → `XDG_CONFIG_HOME/agent-conductor` → `~/.config/agent-conductor`,
`packages/core/src/workspace/loader.ts:29`) when nothing was passed. Add a sibling function,
`workspaceLoader.isDefaultConfigDir(resolved: string): boolean`, comparing the resolved directory
against that same default resolution computed with no overrides considered. `startDaemon()` computes
`isolated = !isDefaultConfigDir(configDir) && !opts.shareHostCredentials` once, at startup.

Alternatives considered:
- **A required new flag to opt into isolation** (e.g. `--isolated`) — rejected: the whole point is
  that today's documented practice, with no new flag, must become safe. Requiring a new flag leaves
  the unsafe default in place for anyone who has not yet learned about it — exactly the hazard this
  change exists to close.
- **Refuse to start a runtime whose credential resolves outside the config dir** (the ticket's second
  option) — rejected as the *sole* mechanism: it would only be caught the first time a turn tries to
  spawn, not at daemon startup, and does nothing about dispatch (AC2). Isolating the credential home
  up front is strictly earlier and is also what makes "no login available" the natural, harmless
  failure mode for a runtime nobody explicitly logged in.

### D2 — `isolated` lives on `WorkspaceContext`, computed once at daemon startup

Add `isolated: boolean` to `WorkspaceContext` (`packages/core/src/context.ts`), populated when each
workspace's context is constructed in `daemon.ts`, from the single value computed in D1. Every
workspace a daemon serves gets the same value — isolation is a property of the daemon process, not of
an individual workspace.

`loader.ts`'s credential-linking functions and `dispatcher.ts`'s `tick()` both already receive
`ctx: WorkspaceContext` (or can); no new plumbing beyond this one field is needed.

Alternative considered: a new `DaemonConfig` field parsed from `daemon.yaml`. Rejected — isolation is
a fact about *how the process was started*, not a persisted setting; putting it in `daemon.yaml` would
let a throwaway config dir's own file silently declare itself un-isolated, defeating the point.

### D3 — Isolated credential home: real file inside the config dir, not merely "no symlink"

`credentialPaths()` currently returns `[hostPath, workspacePath]` pairs. Change its signature to take
the daemon's resolved `configDir` and `isolated` instead of reading `process.env.HOME` directly:

- Not isolated (today's behavior, unchanged): `hostPath` = `~/.claude/.credentials.json` (etc, per
  runtime) — the owner's real CLI file.
- Isolated: `hostPath` = `<configDir>/credentials/<runtimeId>/.credentials.json` — a plain file
  scoped to this daemon's own config directory, shared across every workspace *this daemon* serves
  (so two workspaces on the same throwaway daemon still share one credential with each other, for the
  same anti-rotation reason VS-75 shares one across workspaces on the real host), but never linked to
  the real file.

`linkRuntimeCredentials()`'s behavior (symlink workspace path → host path, reconcile by expiry) is
otherwise unchanged; only what `hostPath` resolves to changes. A freshly isolated daemon's
`<configDir>/credentials/` starts empty, so every runtime reports "needs a login" until someone
explicitly logs that daemon in — which is the safe, obviously-inert state a throwaway daemon should
start in.

Alternative considered: give each *workspace* its own isolated credential home instead of one per
daemon. Rejected — it would reintroduce the pre-VS-75 multi-copy rotation hazard for anyone running
two workspaces on one throwaway daemon, for no isolation benefit (the daemon is already the isolation
boundary from the real host).

### D4 — Dispatch gate keyed on `requestedBy`, not a new "explicit dispatch" mechanism

`dispatcher.ts`'s `claim()` already reads every queued `Wakeup` row for an agent, including each row's
`requestedByKind`/`requestedById` and any bundled entries coalesced into it
(`wake/index.ts` Gate 3). Add a helper — reusing the flattening `flattenWakes` already exports from
`@agent-conductor/core` (recorded in project knowledge, used by VS-134 for the same
top-level-vs-bundle problem) — that answers "does this candidate set of wake-ups include at least one
requested by a human." `tick()`'s candidate query (or a post-filter over its results, whichever
reads more clearly against the existing SQL) skips an agent when `ctx.isolated` is true and that
answer is false, leaving its wake-ups `queued` rather than claiming them.

This makes the *existing* human-initiated paths (a chat message, answering a decision — anything that
already calls `wake.enqueue` with `requestedBy: { kind: 'human', ... }`) the "explicit ask" the
acceptance criteria describe, with no new endpoint. A human using an isolated daemon interactively
(the actual VS-141 use case — poking at the UI) is unaffected; only wakes nobody asked for
(`project_added`, `ticket_assigned` produced by an automatic hire-approval, retries, timers) stay
parked.

Alternatives considered:
- **Gate on `WakeSource` instead of `requestedByKind`** — rejected: sources like `ticket_assigned` are
  ambiguous (a human can assign a ticket by hand, or the system can auto-assign one after a hire
  approval); `requestedBy.kind` already carries the distinction the gate needs directly.
- **A dedicated "run this now" API/CLI command** — rejected as unnecessary: it would duplicate what
  sending the agent a message already achieves, and adds a surface nobody asked for.
- **Gate at `spawnPending()` instead of/in addition to `dispatcher.tick()`** — rejected: `spawnPending`
  only starts a *worker process* for a ticket already in a dispatchable status; the run itself is
  still spawned through the same `dispatcher.tick()` claim path once the worker agent exists, so
  gating there alone would leave the agent creation itself as visible side effect with nothing to show
  for it, and would miss the conductor's own `project_added` wake entirely (the conductor is not
  spawned by `spawnPending`). Gating the one funnel both paths share is simpler and complete.

### D5 — The opt-in is one pair of switches, not two

A single opt-in (`--share-host-credentials` flag on `bin.ts`, or `AC_SHARE_HOST_CREDENTIALS=1`)
sets `shareHostCredentials`, which both disables isolation's credential behavior (D3) and its dispatch
gate (D4) together — see `daemon-isolation/dispatch-gate`'s "sharing also enables dispatch"
requirement. A daemon that has opted into sharing the real login has already accepted the
consequences of being a second real daemon; withholding dispatch from it too would just be a second,
redundant switch to remember.

## AC3 — other host-scoped state (documented finding, no code change)

A sweep of `process.env.HOME`/`homedir()` across the repo (excluding tests) found no other sibling of
the credential-symlink bug:

- `packages/core/src/projects/index.ts:48` — `~` expansion for local git clone URLs a human typed;
  not a shared-state concern.
- `packages/server/src/routes/daemon.ts:23-24,57` — `homedir()` for `~` display expansion and the
  `host.home`/`defaultWorkspaceRoot` info field; read-only, informational.
- `packages/runtime-sdk/src/launch.ts:16,67` — `fallbackBinDirs(home = homedir())`, used only to
  *locate an installed CLI binary* on `PATH` fallback, not to read or write any credential or session
  state.
- `packages/cli/src/contexts.ts`, `packages/cli/src/daemon.ts`, `packages/server/src/upgrade.ts:483`,
  `packages/release/src/index.ts:20` — the daemon's own config/state/release directories, which
  already honor `--config-dir`/`AC_CONFIG_HOME`/`XDG_*` overrides; these are the daemon's own
  isolation boundary working correctly, not a leak across it.

Nothing here needs a code change; this section is the record the acceptance criteria ask for.

## Risks / Trade-offs

- [An isolated daemon with an existing workspace copied from a real one may have roles pre-hired and
  ready to auto-assign a ticket the moment it is created] → the dispatch gate (D4) still holds: the
  ticket gets assigned, but no run is spawned for it until a human's own wake makes that agent
  eligible. The surprise autonomy this ticket is about is closed regardless of what the workspace was
  copied from.
- [`<configDir>/credentials/` is a new location an operator has to know about to log an isolated
  daemon in] → `CLAUDE.md`'s corrected guidance (tasks.md) names it; `conductor doctor`/`runtime login`
  already report "needs a login" against whatever path `credentialPaths()` resolves, so the existing
  diagnostic path surfaces it without new code.
- [Determining `isDefaultConfigDir` has to match `workspaceLoader.configDir()`'s own precedence
  exactly, or the two could disagree] → implement it as "resolve with the same precedence, then
  compare," not a re-implementation of the precedence rules, so there is exactly one place that
  encodes them.

## Migration Plan

No data migration. Existing non-isolated daemons (the real host install, per `CLAUDE.md`: "never
touch the live install") are unaffected — `isDefaultConfigDir` is true for them today and stays true.
An isolated daemon that was previously (incorrectly) sharing the host credential starts fresh in its
own `<configDir>/credentials/`; nothing is deleted from the host's real credential file. No rollback
concern beyond reverting the change.

## Open Questions

None — the mechanism, its default, and its opt-in are decided above; nothing here would change the
specs or the task breakdown if answered later.
