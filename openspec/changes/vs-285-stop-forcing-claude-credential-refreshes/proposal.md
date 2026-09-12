## Why

The daemon forces an OAuth token rotation on the machine owner's own coding-CLI login, then writes
the result back over the file that owner's own CLI reads and writes. Because Claude's OAuth rotates
its refresh token on every refresh, doing this from inside AgentConductor invalidates a refresh
token the owner's own already-running CLI still holds — which is why captain only ever sees a
surprise logout while AgentConductor is running. This is damage to state that belongs to the human
and lives outside this product.

## What Changes

- **BREAKING (behavioral): remove the pre-spawn credential-freshness probe.** `ensureFreshCredential`
  (`packages/core/src/runs/credentialFreshness.ts`, VS-105) calls `adapter.describeAccount` purely to
  provoke a rotation whenever the credential looks like it might not outlast the turn
  (`minValidMs = turnTimeoutMs`, 45 minutes) — which is most of the time, since an access token's
  natural lifetime is commonly shorter than that margin. This module and its call sites are deleted.
  A turn simply spawns; the CLI refreshes on its own terms if it needs to, exactly as it does for the
  owner's own interactive session, and reports its own authentication failure
  (`packages/runtime-sdk/src/process.ts`'s existing output classifier) if that genuinely fails. No
  new pre-spawn check replaces it — a failed turn is cheap; a forced rotation is not undoable.
- **Stop reconciling (writing) the credential from the account/usage probe; keep it on the turn-spawn
  path.** `reconcileRuntimeCredential` / `linkRuntimeCredentials` (VS-75,
  `packages/core/src/workspace/loader.ts`) already only opens the credential path for writing when it
  finds an actual fork — an intact symlink returns immediately after one `lstat`, no write. That write
  is what heals captain's own session when a worker's CLI has already forked the shared credential by
  refreshing mid-turn (its own natural behavior, not something the daemon provoked); removing it from
  the turn-spawn path would leave that fork unrepaired until the next daemon restart, which is a
  regression on the exact symptom this ticket exists to fix, not an improvement. It stays on
  `packages/core/src/runs/engine.ts`'s turn-spawn path, called once per spawn as it is today, entirely
  independent of the deleted freshness probe. It is removed from
  `packages/core/src/usage/accounts.ts`'s account probe: a billing/plan probe has no business
  repairing a credential, and that call site never needed to.
- **Removed capability:** `runtime-credentials/serialized-refresh` (VS-105) is retired outright — its
  entire purpose was coordinating the forced probe this change deletes. `minValidMs` and the
  process-wide singleflight (`inFlight`) go with it; there is nothing left for either to protect once
  nothing triggers a refresh on the daemon's own initiative.
- **Modified capability:** `runtime-credentials/single-credential` — the "repair a forked credential"
  requirement is unchanged for a turn spawn (it stays exactly as it works today) and is dropped as
  something an account/usage probe can trigger.
- **Modified capability:** `runtime-credentials/login-outage` — gains an explicit scenario stating
  that its trigger is exclusively the runtime's own turn reporting an authentication failure; there
  is no longer a separate "shared probe" trigger, because that mechanism no longer exists.
- Applies uniformly to every runtime the write-based mechanism covers (`claude`, `codex`, `gemini`,
  `opencode`, `cursor`); the forced-refresh probe itself only ever affected `claude` and `cursor` (the
  only two adapters implementing `readCredential`, the hook `ensureFreshCredential` requires) — see
  `design.md` for the investigation that established this.
- The account/usage probe (`usage/accounts.ts`) keeps calling `describeAccount` for billing/plan
  reporting — that stays legitimate per the ticket's own scope — but drops the reconcile write that
  currently precedes it.
- Read-only credential reporting (`packages/runtimes/*/src/credential.ts`, the credential-visibility
  surfaces) is unchanged: it already only reads a file and spawns nothing.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `runtime-credentials/single-credential`: the fork-repair requirement stays in force on a turn spawn
  (unchanged from today) and is dropped from the account/usage probe, which never needed it.
- `runtime-credentials/login-outage`: clarifies that an authentication failure is only ever the
  runtime's own turn failing to authenticate — there is no longer a separate proactive-refresh
  trigger feeding into the same gate.

### Removed Capabilities
- `runtime-credentials/serialized-refresh`: the forced pre-spawn refresh probe it coordinated no
  longer exists, so there is nothing left to serialize.

## Impact

- `packages/core/src/runs/credentialFreshness.ts`, `credentialFreshness.test.ts` — deleted.
- `packages/core/src/runs/engine.ts` — remove the `ensureFreshCredential` call from the turn-spawn
  path (and everything it did: the pre/post-probe reconcile calls that belonged to it). The existing,
  independent `reconcileCredential()` call that already runs once per spawn stays exactly as it is
  today.
- `packages/core/src/runs/engine.test.ts` — tests exercising the freshness gate updated or removed.
- `packages/core/src/usage/accounts.ts` — drop the `reconcileRuntimeCredential` call inside `probe()`.
- `packages/core/src/workspace/loader.ts` — `linkRuntimeCredentials` / `reconcileRuntimeCredential`
  are unchanged: same definitions, same turn-spawn call site (`engine.ts`), same one-time bootstrap
  call in `loadWorkspace`. Only the account/usage-probe call site (`accounts.ts`) goes away.
- `packages/core/src/workspace/credentials.test.ts` — new coverage proving a turn spawn against an
  intact symlink writes nothing (one `lstat`, no write), a turn spawn against a genuine fork still
  repairs it exactly as today, and nothing spawns a process for the purpose of causing a refresh.
- `openspec/specs/runtime-credentials/serialized-refresh/` — removed.
- `openspec/specs/runtime-credentials/single-credential/`, `.../login-outage/` — delta specs.
- `docs/OPERATIONS.md` §7 — updated to describe the passive posture and remove the freshness-gate
  description VS-105 added.
