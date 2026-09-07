## Why

Claude's OAuth credential rotates its refresh token on every refresh: the CLI reads the current
refresh token, exchanges it for a new access token and a new refresh token, and the old refresh
token is dead the moment the exchange succeeds. VS-75 made every agent on a host read and write the
**same** credential file (a symlink to the owner's own `~/.claude/.credentials.json`) instead of a
diverging copy, which fixed two files disagreeing about which token was live. It added no locking
around that one file, so nothing stops several `claude` subprocesses from refreshing at the same
moment against the same starting refresh token.

That is exactly what happened on 2026-09-07, twice: 7 runs spawned within the same second at
09:25–09:26, and 4 paused workers all resumed within a second of each other at 18:00 after a
session-limit reset. Both clusters produced `auth`-family failures and nowhere else in the day did.
Every `claude` process launched in that window that needed to refresh raced the others: the first
exchange won, and every other process was left holding an already-invalidated refresh token, so the
credential file's next writer left the owner's whole login in a dead state — theirs included.

The daemon itself never refreshes an OAuth token: it has no HTTP call to Anthropic's token endpoint
anywhere, and reads a credential's `expiresAt` only to reconcile which of two file copies is newer
(VS-75). Refreshing is entirely the `claude` subprocess's own doing, invisibly, whenever it is
spawned with a near-expired access token. The daemon's only lever today is **when** it spawns that
subprocess and **how many** it spawns at once — which is exactly the lever this change pulls.

## What Changes

**A host-wide credential-freshness gate, ahead of every turn.**

- Before the daemon spawns a turn's coding-CLI process for a runtime that can report its own
  credential state, it checks whether that credential is fresh enough to outlast the whole turn. If
  it is, the turn spawns exactly as it does today — no lock, no extra call, the common case is free.
- If it is not, the daemon runs **one** lightweight, already-existing account probe for that runtime
  (the same call the usage panel already makes) to let the CLI refresh on its own terms, and every
  other agent that needed the same runtime at the same moment waits on that single probe's result
  instead of starting a probe or a turn of its own. This is a process-wide singleflight keyed by the
  runtime, not per workspace — the credential it protects is already shared per host, not per
  workspace.
- The daemon still never performs the OAuth exchange itself; the CLI subprocess does, unchanged. The
  change is only that at most one such subprocess is ever mid-refresh for a given runtime at a time,
  and every agent that would otherwise have raced it now waits for and reuses its outcome.
- When that one probe cannot restore a working credential, every agent waiting on it is treated
  exactly as if its own turn had failed to authenticate: the existing runtime-login gate fires once
  (unchanged from VS-75 — one decision, one channel message, every agent on the runtime paused with
  its wake-ups intact), rather than each of them separately spawning a turn that fails the same way.
- VS-75's reconcile-by-expiry repair (never by modification time, never overwriting a credential that
  expires later) is unchanged and still runs before and after every credential-touching call,
  including the new probe.

## Capabilities

### New Capabilities

- `runtime-credentials/serialized-refresh`: at most one credential refresh is in flight per runtime
  per host at any time, every agent that needs a fresh credential waits on and reuses that one
  outcome rather than causing its own, and a turn only spawns once the credential is confirmed fresh
  for the turn's full expected duration.

### Modified Capabilities

(none — `runtime-credentials/login-outage` and `runtime-credentials/single-credential` already
describe the gate and the reconcile rule this change reuses unchanged; a credential-freshness failure
detected by the new probe is routed through the exact same "first authentication failure stops the
runtime" behavior those specs already require.)

## Impact

- `packages/core/src/runs/credentialFreshness.ts` (new) — the process-wide singleflight and the
  freshness check.
- `packages/core/src/runs/engine.ts` — call the freshness check immediately before `runtime.runTurn`,
  and route a freshness failure through the existing `gateRuntimeForLogin` path used for an `auth`
  turn failure.
- `packages/runtime-sdk/src/index.ts` — no interface change; reuses the existing optional
  `readCredential` and `describeAccount` adapter methods.
- `docs/OPERATIONS.md` §7 — document the pre-spawn freshness check and the singleflight.
- No database migration, no API route change, no UI change: this is entirely inside the run engine's
  spawn path.
