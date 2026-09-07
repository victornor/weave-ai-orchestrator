## Context

See `proposal.md` — Why, for the outage and the mechanism. The facts that shape this design, checked
against the running code rather than assumed:

- **The daemon never calls Anthropic's OAuth endpoint itself, anywhere.** There is no HTTP client for
  a token endpoint in `packages/core`, `packages/runtimes/claude` or `packages/runtime-sdk`. The only
  fields ever read from the credential are `claudeAiOauth.expiresAt` (for reconciliation and display)
  and, by the `claude` subprocess itself, `accessToken`/`refreshToken` — the daemon process never
  touches those two. Refreshing is entirely the CLI's own behaviour when it is launched with a
  near-expired access token.
- `refreshTokenExpiresAt`, named in the ticket, does not exist in this codebase or in the credential
  fixtures (`packages/runtimes/claude/test/credential.test.ts`, `packages/core/src/workspace/
  credentials.test.ts`); the file's shape is `{ claudeAiOauth: { accessToken, refreshToken,
  expiresAt, scopes, subscriptionType } }`. Nothing here changes that shape.
- `CredentialFacts` (`packages/runtime-sdk/src/index.ts`) is deliberately typed with no field that
  could carry a token — "the type is the guarantee" (VS-75). This design adds no field to it and
  reads nothing from the file that this type does not already expose.
- **One daemon process per host** (`docs/PLAN.md` §7.2, enforced by `daemon.pid`;
  `packages/cli/src/commands/daemon.ts` refuses a second start). One process may hold many
  `WorkspaceContext`s, one per registered workspace, all in the same event loop. A lock that must
  hold across every workspace on the host — which is what a credential shared by symlink demands
  (VS-75) — is therefore a plain in-process data structure; nothing here needs a file lock, an
  advisory DB lock or cross-process coordination, and nothing in the codebase already provides one
  (grepped: no `mutex`, `singleflight`, `withLock` or advisory-lock idiom exists anywhere in `core`,
  `server` or `db`).
- The closest existing idiom is `packages/core/src/runs/active.ts`'s `runState`, a `WeakMap` keyed
  **per `WorkspaceContext`**. That scope is wrong for this lock: the credential a Claude turn reads is
  the same file for every workspace on the host (VS-75's `credentialPaths()` reads `process.env.HOME`
  directly), so a lock scoped per workspace would let workspace A's agent race workspace B's agent on
  the exact file this change exists to protect. The new lock is therefore a bare module-level map,
  keyed by `runtimeId` alone (not by workspace, not by host — `HOME` is one value per process).
- The account probe already run by `AccountsService.probe()` (`packages/core/src/usage/accounts.ts`)
  spawns the CLI for a `get_usage` control request, taking "well under a second" per its own comment,
  and — as a side effect of the CLI starting up — is the one thing already in this codebase that
  causes the CLI to look at its own credential and refresh it if it judges that necessary. It is
  already reconciled before every call (`reconcileRuntimeCredential`) and already exercised by tests
  with a fake `claude` binary, never a real one.
- The rule that a ticket may not launch the real Claude CLI against live credentials (added after
  this same class of outage) applies to *this worker's own verification*, not to the shipped feature:
  the daemon legitimately spawns `claude` today for turns and for account probes, and this change
  does not add a new class of subprocess — it adds a lock around when an existing one may be spawned.
  Every test for this change uses a fake CLI binary or a fake `RuntimeAdapter`, never the real one.

## Goals / Non-Goals

**Goals:**

- Whatever a burst of simultaneous spawns looks like — 7 at once, 4 paused workers resuming together,
  a mix of workspaces on the same host — at most one credential-refreshing subprocess for a given
  runtime is ever in flight, and every other agent that needed the same thing waits on and reuses its
  outcome rather than causing its own.
- A turn only spawns once its credential is confirmed valid for the turn's own expected duration, not
  merely valid "right now" — a token that expires four minutes into a 45-minute turn is exactly the
  failure this exists to prevent.
- No new class of failure, no new gate mechanism: a credential that cannot be made fresh is handled
  by the exact `login-outage` gate VS-75 already built and already specifies.

**Non-Goals (unchanged from VS-75, restated because this change could be mistaken for reopening them):**

- **Refreshing the OAuth token ourselves.** The CLI owns the exchange with Anthropic; this change
  only ever gets one CLI invocation to do it at a time. The daemon still never holds, inspects or
  transmits an access or refresh token.
- **Changing where the credential lives** (VS-75's symlink) or **per-workspace credentials** — both
  explicitly out of scope on the ticket.
- Detecting *why* a refresh failed (revoked vs. genuinely expired vs. network). The existing
  `login-outage` gate already treats every such failure identically, correctly.

## Decisions

### Decision 1 — Daemon-ahead check with a singleflight probe, not a lock around the turn itself

The ticket asks which of two shapes this takes: "daemon-ahead refresh" (ensure freshness before
spawning, so agents never race) or "in-process lock" (serialize the refreshing operation itself). The
answer is both, in this order, because they solve different halves of the problem:

1. **Daemon-ahead check.** Before spawning a turn, the engine asks whether the runtime's credential
   is already valid for at least the turn's own timeout from now (`ctx.config.defaults.turnTimeoutSec`
   — the same number the turn itself will be killed at, so "valid for the whole expected turn" per
   the acceptance criteria is exactly this bound). `readCredential` is synchronous and spawn-free
   (VS-75), so this check costs nothing and is the path every turn takes when nothing is near expiry
   — the overwhelmingly common case, unaffected by this change.
2. **Singleflight probe** for the case the check fails. Rather than have the daemon reimplement
   Anthropic's OAuth exchange (undocumented, security-sensitive, and explicitly a non-goal), it gets
   one already-existing, already-tested CLI invocation — the same `describeAccount` probe the usage
   panel calls — to refresh the credential on the CLI's own terms. A module-level
   `Map<runtimeId, Promise<FreshResult>>` ensures only the first caller for a given runtime actually
   starts that probe; every concurrent caller for the same runtime receives the same promise and
   therefore the same, single outcome, and performs no probe and no turn spawn of its own.

This is "daemon-ahead" in the sense the acceptance criteria ask for — the daemon ensures freshness
*before* spawning, agents never independently refresh — implemented via a singleflight lock rather
than a direct OAuth call, because the direct call is the riskier, larger, and explicitly out-of-scope
alternative.

*Alternatives considered:*

- **The daemon performs the OAuth token exchange itself**, calling Anthropic's refresh endpoint
  directly with the stored `refreshToken`. This is the most literal reading of "daemon-ahead
  refresh," but: the endpoint, its client id and its exact contract are undocumented and would have
  to be reverse-engineered from the CLI binary without ever exercising it against a live credential
  (the same constraint that makes this whole class of bug hard to test); VS-75 already decided
  "refreshing the OAuth token ourselves" is a non-goal; and it adds a second, independent
  implementation of a security-sensitive protocol that must never drift from the CLI's own. Rejected.
- **A lock around every `runTurn` call for the runtime, held for the turn's whole duration.** This
  would serialize far more than the refresh — it would make every turn on a runtime run one at a
  time, which defeats the entire point of concurrent agents and is not what any acceptance criterion
  asks for. Rejected.
- **Do nothing before spawning; only serialize the CLI processes' own internal refresh.** Not
  possible from outside the subprocess — the daemon has no hook into the CLI's internal refresh
  timing, only into when it decides to spawn the CLI at all. This is why the check has to happen
  *before* spawning, not around it.

### Decision 2 — Lock scope: per `runtimeId`, process-wide, not per `WorkspaceContext`

The map lives at module scope in the new `credentialFreshness.ts`, keyed only by `runtimeId`, and is
shared by every `WorkspaceContext` in the process. This matches the credential's own scope (one file
per runtime per host, VS-75) rather than the dispatcher's existing per-workspace `runState`. A lock
scoped per workspace would satisfy acceptance criterion 3 for a single-workspace burst but not for
the documented cause of both 2026-09-07 outages, which spanned every workspace sharing the host.

### Decision 3 — A freshness failure is a synthesized `auth` failure, not a new gate

When the singleflight probe cannot restore a valid credential, every agent waiting on it fails its
*current run* with `{ family: 'auth', code: 'credential_refresh_failed' }` — thrown the same way an
unknown runtime is already reported in `engine.ts` (`Object.assign(new Error(...), { ocFamily,
ocCode })`), before `runTurn` is ever called. This flows through the finalize logic already in place
for a turn that failed with `errorFamily === 'auth'`: `gateRuntimeForLogin` fires once per workspace
(the correlation key already dedupes further failures while the decision is open, per
`login-outage`), the run is not retried, and the agent's wake-ups are preserved.

*Why not a new mechanism:* the `login-outage` capability already specifies exactly the behavior this
failure needs — one card, no per-agent spam, automatic resume when the runtime probes healthy again.
Building a second gate for "freshness check failed" versus "turn's own auth failure" would be two
paths to the same outcome, and the spec would have to describe both. Routing through the same failure
family keeps `login-outage` untouched by this change entirely.

### Decision 4 — Reconciliation still wraps every credential-touching call

The new probe path calls `reconcileRuntimeCredential` before invoking `describeAccount`, exactly as
`AccountsService.probe()` already does, and the engine's existing reconcile-before-`runTurn` call
(`engine.ts`, immediately before building `TurnInput.configHome`) is unchanged and still runs after
the freshness check resolves. This is what makes acceptance criterion 4 hold even in the residual
case this change cannot fully close (see Risks): if some other process on the host writes a
newer-expiring credential while the singleflight probe is in flight, reconciliation's expiry-wins
rule (never mtime, VS-75) still prevents the probe's own write from clobbering it.

## Risks / Trade-offs

- **A turn that runs longer than `turnTimeoutSec` from the moment freshness was confirmed is not
  covered** if its own internal refresh happens to race a *different* agent's freshness check that
  started after it. This is strictly better than today (zero serialization) and matches the
  acceptance criteria's own framing ("valid for the whole expected turn"), but is not a proof that no
  race can ever occur — VS-75's monotonic-by-expiry reconciliation is the backstop for that residual
  case, unchanged by this design.
- **The probe adds one CLI spawn per burst** (not per agent) whenever the check finds the credential
  within its buffer of expiring — a small, bounded cost, and strictly cheaper than today's behavior
  of every agent in the burst spawning a full turn that then fails.
- **An adapter without `readCredential`/`describeAccount`** (any runtime besides Claude today) is
  unaffected: the freshness check is a no-op when either method is absent from the adapter, exactly
  mirroring how VS-75's own credential-state features degrade for such runtimes.

## Migration Plan

None. No schema change, no config change, no operator action. The behavior is active as soon as the
change ships; a host with no runtime near its credential's expiry sees no behavioral difference at
all until the first time a check would have failed under the old code.
