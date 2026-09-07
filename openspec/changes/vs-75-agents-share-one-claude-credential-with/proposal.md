## Why

Every agent in the workspace runs against a *copy* of the owner's coding-CLI credentials:
`seedRuntimeCredentials` (`packages/core/src/workspace/loader.ts:270`) copies
`~/.claude/.credentials.json` into `.agent-conductor/runtimes/claude/.credentials.json`, which each
turn uses via `CLAUDE_CONFIG_DIR` (`packages/core/src/runs/engine.ts:236`). Claude's OAuth rotates
the refresh token on every refresh, so two live copies of one rotating credential race: whichever
side refreshes first — an agent turn, the account probe, the owner's own `claude` session — silently
invalidates the other. The copy is then re-taken on mtime (`loader.ts:282`), which can overwrite a
*working* credential with a *dead* one, and an `auth` failure force-copies again
(`engine.ts:377`), pushing the dead credential back over the good one.

That is what happened on 2026-09-07 from 09:07 UTC: every agent including the conductor failed with
`OAuth session expired and could not be refreshed`, the owner's own CLI needed a fresh `/login`,
three workers were parked with one retry card each, the conductor was paused twice, and an approved
merge was dropped back to the queue. The design fails on any rotation; the trigger only decides when.

The failure handling made it worse rather than surfacing it: an `auth` failure is retried once per
worker and then parked per worker, so a single expired login becomes N cards that each say something
different, none of which says "your Claude login expired, run `claude /login`".

## What Changes

**One credential per runtime per host.**

- **BREAKING** `seedRuntimeCredentials` becomes a *link*, not a copy: the workspace runtime home's
  credential path becomes a symlink to the host CLI's own credential file. There is then exactly one
  credential file per runtime per host, and a rotation on any side is a rotation for everyone.
- A reconcile step repairs the link if a CLI replaces it (a write-to-temp-then-rename replaces a
  symlink rather than following it). Reconciliation is content-based and monotonic: the credential
  carrying the **later expiry** wins, never the later mtime, and never the older over the newer.
- The engine's force re-copy after an `auth` failure is **removed**. It cannot help — there is only
  one file — and it was a way to overwrite a good credential with a stale one.
- The same copy pattern applies to `codex`, `gemini` and `opencode`, so all four move to linking.
- **BREAKING** a per-workspace *independent* login is no longer supported: `conductor runtime login`
  now logs in the one host credential for that runtime. This follows directly from "exactly one live
  credential per runtime per host"; multi-account is explicitly out of scope for this change.

**One card for one outage, and automatic resume.**

- **BREAKING** an `auth` failure leaves the automatic retry ladder entirely. It is neither retried
  nor parked per worker.
- The first `auth` failure for a runtime marks that runtime's credential `needs_login` and gates the
  dispatcher: no further turn is started for any agent on that runtime, so nothing is spent
  re-failing. Agents waiting on the gate are paused with that reason and keep their queued wakes.
- Exactly one human decision is raised per runtime outage, correlated so a second failure joins it
  rather than raising a second card: *"Claude login expired; run `claude /login`, then work
  resumes."*
- The daemon tells the human over the channel path directly (`threads.notifyHuman`), not by waking
  the conductor — the conductor is gated by the same outage, so an outage can no longer hide behind
  a conductor that cannot take a turn.
- The gate clears on its own: the supervisor re-probes the runtime account on a fast cadence while a
  runtime is gated, and a probe that describes the account un-pauses every agent paused for it,
  withdraws the card and lets the queued wakes run. No per-worker action.

**Seeing the credential's state.**

- A new per-runtime credential state — present, expiry, last verified, refresh failed at, whether a
  login is needed — read from the credential file without launching the CLI and **never** carrying
  the token or any part of it.
- The Usage view and `conductor doctor` show it.

**Documentation.**

- The credential model goes into `docs/OPERATIONS.md`.
- The worker skill gains the rule that a ticket never launches the real CLI against live
  credentials.

## Capabilities

### New Capabilities

- `runtime-credentials/single-credential`: there is one credential file per runtime per host, shared
  with the owner's CLI rather than copied; any repair is monotonic in the credential's own expiry.
- `runtime-credentials/login-outage`: an expired login stops the runtime once, raises exactly one
  human decision, reaches the human off the conductor's path, and resumes every waiting agent by
  itself when the login is restored.
- `runtime-credentials/credential-visibility`: the credential's state is legible on the usage
  surfaces and in `conductor doctor`, and never exposes the token.

### Modified Capabilities

- `run-recovery/retry-ladder`: the ladder's bound no longer carries an authentication special case —
  an authentication failure is not retried automatically at all.
- `run-recovery/stuck-worker-parking`: a worker is not parked for the human on an authentication
  failure; that failure is handled once for the runtime instead of once per worker.
- `run-recovery/paused-worker-visibility`: a worker paused because its runtime's login expired
  records that reason, is shown with it, and is resumed by the system rather than by a human.

## Impact

- `packages/core/src/workspace/loader.ts` — `seedRuntimeCredentials` → link + reconcile.
- `packages/core/src/runs/engine.ts` — remove the auth force re-seed and the auth rung of the ladder;
  route an `auth` failure to the runtime gate instead of `parkForHuman`.
- `packages/core/src/runs/dispatcher.ts` — skip candidates whose runtime is gated.
- `packages/core/src/usage/accounts.ts`, `packages/core/src/api.ts` — credential state read/write on
  `AccountsService` (not a new `CoreServices` member, which would break every test harness).
- `packages/core/src/supervisor/index.ts` — fast re-probe and un-gate while a runtime is gated.
- `packages/runtime-sdk/src/index.ts`, `packages/runtimes/*/src` — an optional `readCredential`
  adapter hook (file read only, no spawn).
- `packages/db/src/migrations/` — a new table for the per-runtime credential state.
- `packages/server/src/routes/`, `packages/ui/src/routes/Usage.tsx`,
  `packages/cli/src/commands/doctor.ts` — the surfaces.
- `docs/OPERATIONS.md`, `.claude/skills/agent-conductor-worker/` — documentation.
- Operator-visible: after the upgrade the workspace credential file is a symlink; a workspace that
  had its own separate login for a runtime adopts the newer of the two credentials once, and is
  shared from then on.
