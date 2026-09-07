## Context

See `proposal.md` — Why, for the outage and the racing-copies cause. The constraints that shape the
approach:

- `CLAUDE_CONFIG_DIR` is the *whole* config home, not a credential path. It also holds settings,
  session history and project state, which we deliberately keep per workspace
  (`packages/core/src/context.ts:26`, `runtimesHome`). Pointing it at `~/.claude` would share all of
  that, and would make `conductor runtime login`'s isolation meaningless in a second, larger way.
- The daemon may not launch a runtime CLI to *find out* things it can read from a file. The account
  probe (`packages/runtimes/claude/src/account.ts`) does launch the CLI, and that is fine and stays;
  a credential's expiry is in the file and needs no launch.
- **The real Claude CLI must not be run against live credentials from inside this ticket** (the
  conductor's rule of 2026-09-07, added after this same outage). So the CLI's credential-write
  behaviour cannot be observed here. The design must therefore be correct without knowing it, and is
  — see Decision 2.
- Adding a member to `CoreServices` makes every unstubbed test harness throw
  (`packages/core/src/testing/context.ts`, `packages/server/test/fakes.ts`), so new behaviour goes
  onto an existing service.
- The dispatcher is the single place a turn is started (`packages/core/src/runs/dispatcher.ts:83`),
  and it already reads the DB directly. That makes it the natural gate.

## Goals / Non-Goals

**Goals:**

- One credential file per runtime per host, correct under either style of credential write by the
  CLI, with no knowledge of which style it uses.
- A repair rule that is monotonic in something the credential asserts about itself, so no ordering
  of events can lose a good login.
- One failure, one gate, one card, automatic recovery — with the human reachable on a path the
  outage cannot block.

**Non-Goals:**

- Refreshing the OAuth token ourselves. The CLI owns refresh; we only stop fighting it over which
  copy it refreshes.
- Detecting *why* a login expired (revoked, rotated out, password change). The remedy is the same.
- Any credential storage of our own — no keyring, no encryption at rest, no daemon-held token. The
  file stays where the CLI put it, with its own permissions.

## Decisions

### Decision 1 — Share by symlinking the credential file, not the config home

`seedRuntimeCredentials(runtimeId, home)` becomes `linkRuntimeCredentials`: for each
`[hostPath, workspacePath]` pair it already knows (`loader.ts:272-277`), it makes `workspacePath` a
symlink to `hostPath`. The config home stays per workspace; only the credential file within it is
shared.

*Why over the alternatives:*

- **Symlink the whole config home to `~/.claude`** — shares settings, session state and project
  history too. That is a much larger behaviour change than the ticket asks for, and it makes every
  agent's session index collide with the owner's.
- **Set `CLAUDE_CONFIG_DIR=~/.claude` for turns** — same objection, plus every agent would write its
  sessions into the owner's home.
- **Keep copying but copy back after a refresh** — a bidirectional copy, which is exactly the class
  of design that produced the outage. Ruled out by the ticket ("one-directional").
- **Have the daemon own the credential and point the owner's CLI at it** — requires the owner to
  change their own environment permanently and breaks any tool that reads `~/.claude` directly.
  The symlink achieves the same single-file invariant with the host path staying canonical.

`conductor runtime login` (`packages/cli/src/commands/runtime.ts`) spawns the CLI with the config
home; its credential write now lands on the host file through the link. That is the **BREAKING**
consequence stated in the proposal, and it is the same invariant the ticket asks for.

### Decision 2 — Reconcile on the credential's own expiry, so the CLI's write style does not matter

Two write styles are possible and we cannot observe which the CLI uses:

- **Write through the symlink** (`open`/truncate) — the host file is updated. Nothing to do.
- **Write to a temp file and rename over the path** — the *symlink itself* is replaced by a regular
  file, and the credential has forked again.

`reconcileRuntimeCredential(runtimeId, home)` runs before each turn and after each turn and probe:

1. If `workspacePath` is a symlink resolving to `hostPath`, done.
2. If it is a regular file, parse both it and `hostPath` for the credential's own expiry
   (`claudeAiOauth.expiresAt` for claude; per-runtime, in the adapter).
3. Keep the one with the **later expiry**; if only one parses, keep that one; if neither parses,
   keep the host's.
4. Write the winner to `hostPath` (mode 0600), then replace `workspacePath` with a symlink to it.

Expiry — not mtime — is the criterion the ticket demands, and it is the right one: it is what the
credential asserts about itself, it is monotonic across a refresh, and it is unaffected by a
`copyFileSync` that resets mtime. The worst case is one turn's window of divergence, closed before
the next turn starts, with the newer credential always the survivor.

This is testable end-to-end with a fake CLI that does each write style; no real credential and no
real CLI are involved.

### Decision 3 — The gate lives in a new table and is read by the dispatcher

A new migration `0012_runtime_credentials.sql`:

```
runtime_credentials(workspace_id, runtime_id, present, expires_at, last_verified_at,
                    refresh_failed_at, needs_login, detail, updated_at)
PRIMARY KEY (workspace_id, runtime_id)
```

*Why not reuse `runtime_accounts`* — that row is a usage snapshot, deleted and re-inserted on every
probe (`accounts.ts:82-84`). A gate must not be destroyed by a probe. Separate lifetimes, separate
tables.

The read/write API goes on `AccountsService` (`packages/core/src/api.ts:318` already lists it), as
`credentials()`, `credential(runtimeId)`, `noteAuthFailure(runtimeId, detail)` and
`noteVerified(runtimeId)` — no new `CoreServices` member, so no harness breakage.

The dispatcher's candidate query gains `AND a.runtime_id NOT IN (SELECT runtime_id FROM
runtime_credentials WHERE workspace_id = ? AND needs_login = 1)`. Filtering before `claim()` means
the wakeups are never claimed, so they stay `queued` and the work is preserved by construction
rather than by a compensating re-enqueue.

### Decision 4 — The engine routes `auth` to the gate, and stops rewriting credentials

In `finalizeRun` (`engine.ts:376-397`):

- Delete the `seedRuntimeCredentials(..., {force:true})` call at line 377.
- Remove `errorFamily === 'auth'` from the retry branch and from the `agentStatus` expression at
  line 339 (`countRetries(...) < 1`).
- Add: on `errorFamily === 'auth'`, call `gateRuntimeForLogin(ctx, deps, runtimeId, message)`, and
  do **not** call `parkForHuman`.

`gateRuntimeForLogin` is idempotent and does each step under its own guard, in the style of
`parkForHuman` (VS-49's lesson — one failing step must not take the others with it):

1. `accounts.noteAuthFailure(runtimeId, detail)` — sets `needs_login`, `refresh_failed_at`.
2. Pause every non-retired agent in the workspace on that runtime whose status is not already
   paused, with `pauseReason` naming the login and `pauseDetailJson.family = 'auth'`. Their queued
   wakeups are untouched.
3. `decisions.create` with `kind: 'gate_finding'`, `owner: 'human'`, `ticketId: null`,
   `correlationKey: 'runtime-login:<runtimeId>'` — the correlation key is what makes a second
   failure join the card instead of adding one.
4. `threads.notifyHuman` with the outage text. This is the channel path
   (`packages/core/src/api.ts:278`), independent of any conductor turn.

Step 3 uses `ticketId: null` deliberately: the outage is not about one ticket, and attaching it to
one would block that ticket alone while the others sit silently.

### Decision 5 — Recovery is the existing probe, on a faster clock while gated

`packages/core/src/supervisor/index.ts:507` already calls `accounts.refresh()` on
`ACCOUNTS_EVERY_MS`. Add: when any runtime has `needs_login = 1`, probe *those* runtimes every
60 s. Success is `describeAccount` returning a `billingType` other than `unknown` — conservative,
because `unknown` also covers a missing binary, and treating that as recovery would un-gate into a
second outage.

On success, `ungateRuntime`: clear `needs_login`, set `last_verified_at`, un-pause every agent
paused with the login reason (back to `active`, `pauseReason`/`pauseDetailJson` cleared), and
withdraw the decision by its correlation key. The queued wakeups then fire on the next dispatcher
tick with no re-enqueue needed.

A cheap pre-check avoids most probes: if the credential file's expiry is unchanged since
`refresh_failed_at`, the human has not logged in yet, so skip the probe this tick.

### Decision 6 — Expiry is read by an adapter hook, never by launching the CLI

`RuntimeAdapter` gains `readCredential?(input: { configHome: string }): CredentialFacts`, returning
`{ present, expiresAt }` and nothing else — never the token, so a token cannot leak by accident
through a field that never carries one. `claude` implements it against
`claudeAiOauth.expiresAt`. `codex`, `gemini` and `opencode` move to the shared link but do not
implement the hook yet, so they report present with an unknown expiry — honest, and exactly what
the spec requires for an uninterpretable credential.

## Risks / Trade-offs

- **The CLI writes credentials in a way neither branch of Decision 2 covers** (a hard link, a
  directory, a lock file it refuses to cross a symlink for) → reconciliation always leaves *a*
  valid credential at the host path and never destroys the newer one, so the worst case degrades to
  today's behaviour minus the destructive re-copy. The account probe verifies the result each cycle,
  and the gate raises one card rather than N if it is wrong.
- **The symlink is not verifiable against the real CLI in this ticket** (the conductor's rule) → the
  tests pin both write styles with a fake CLI, and the PR states plainly that the real CLI's write
  style is unverified and why. If the owner wants it confirmed, that is one manual run on their side,
  outside a ticket.
- **A gated runtime stops the conductor too** → intended, and the reason `threads.notifyHuman`
  replaces a conductor turn. The trade-off is that a runtime outage now visibly stops the workspace
  instead of half-working; that is the point of the ticket.
- **A false-positive gate stops everything** → the gate is only set by a real `auth` family failure
  from the runtime, and it clears itself within 60 s of the credential working again. The blast
  radius is one runtime in one workspace; other runtimes keep running.
- **`conductor runtime login` no longer isolates per workspace** → stated as BREAKING in the
  proposal; it is the direct consequence of "one credential per runtime per host", which the ticket
  asks for. Multi-account is explicitly out of scope.
- **A symlink under `.agent-conductor/` pointing into `$HOME`** → it is a link to a file the same
  user already owns and already reads; it grants nothing that copying did not. Anything that
  archives or copies a workspace must not dereference it; the portable-workspace path
  (`workspace/portable.test.ts`) is checked in the tasks.

## Migration Plan

1. The migration creates the table only; no data backfill — a missing row means "no failure
   recorded", which is the correct initial state.
2. On the first workspace load after the upgrade, `linkRuntimeCredentials` finds a regular file at
   the workspace path and runs the reconcile of Decision 2 once per runtime: the later-expiring
   credential is adopted to the host path and the workspace path becomes a link. A workspace with
   its own separate login keeps whichever credential is live; no one is signed out.
3. Rollback is a daemon downgrade: the old `seedRuntimeCredentials` copies over the symlink with a
   regular file again, which is the pre-change state. No data is lost, and the host credential is
   the newer of the two by construction.

## Open Questions

None that change the specs, the approach or the tasks. The one unknown — the real CLI's
credential-write style — is deliberately designed around rather than resolved, per Decision 2, and
cannot be resolved from inside a ticket under the conductor's rule.
