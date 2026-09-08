## Why

Two runs failed this morning with `credential_refresh_failed` during a real Claude login outage.
Six other agents on the same runtime were correctly paused and released automatically when the
login was restored; these two were not — their runs read `failed` but their workers stayed `active`
with a stray `errorText`, and their tickets read as ordinary in-flight work. One sat dead for two and
a half hours, the other for four and a half, until a human happened to look. Reading the actual
`finalize()`/`gateRuntimeForLogin`/board code (not the incident's own account of it) turns up four
concrete, fixable gaps behind that symptom, detailed in `design.md`:

1. The one wake that discovers a runtime outage is the one wake the recovery path cannot resume,
   because `finalize()` marks it `failed` (terminal) before the outage is even recorded — every
   *other* agent on the runtime keeps its still-queued wake and resumes correctly; the triggering
   agent does not.
2. The board and the project overview compute "why is this worker paused" from a lookup that
   deliberately excludes paused workers, so the one state this whole mechanism produces is
   invisible on the two surfaces a human scans first. The ticket detail page and the worker's own
   page are unaffected.
3. The conductor's own digest lists every ticket with a live-ish worker but carries neither the
   worker's status nor its pause reason, so a stalled ticket reads exactly like a moving one there
   too — and nothing wakes the conductor about it at all.
4. The credential-freshness check reuses an account descriptor's informational billing note as if it
   were the reason a refresh failed, whenever `describeAccount` succeeds but the local credential has
   no OAuth expiry to check — producing exactly the "billed per token; no plan limits" text tagged as
   `credential_refresh_failed` that both real failures recorded.

## What Changes

- A run that fails because its runtime could not authenticate no longer discards the wake that
  discovered the outage: it is left queued (not marked `failed`) so the same recovery path that
  already resumes every other waiting agent on the runtime resumes this one too, on the same ticket,
  without a new "retry" wake and without touching the ladder that already excludes auth failures.
- Three consecutive authentication failures on the same worker stop being auto-resumed: the third one
  is put to the human as the per-worker decision the runtime-outage path otherwise skips, on the
  theory that a runtime confirmed healthy twice in a row and still failing the same worker is a fact
  about that worker, not the runtime.
- A ticket whose worker pauses for a runtime login outage raises a `gate_finding` owned by the
  conductor (VS-127's existing worker-escalation routing, not a new path), named per ticket so a
  second failure on the same ticket during the same outage does not raise a second one; it is
  withdrawn the next time that ticket's worker completes a turn.
- The board (kanban and phone row) and the project overview's work section show a paused worker's
  reason on its ticket card. Today they look it up through a live-workers-only map that structurally
  excludes `paused`, so the "paused · reason" badge that already exists in `TicketCard`/`TicketRow`
  never renders for this case.
- The conductor's briefing digest names a ticket's worker status and pause reason in its "under way"
  section, so a stalled ticket is visible there without a separate decision existing for it.
- The credential-freshness check's failure message no longer reuses a successful `describeAccount`
  response's billing note as the reason a refresh failed. It states plainly what did and did not
  check out: whether the account could be described at all, and whether the local credential has a
  confirmed session — never dressing up "this account has no plan limits" as a credential problem.

## Capabilities

### Modified Capabilities

- `runtime-credentials/login-outage`: the triggering agent's own consumed wake is preserved across
  the pause exactly as every other waiting agent's already-queued wake is, so it resumes when the
  runtime recovers; three consecutive authentication failures on one worker stop resuming
  automatically and raise the per-worker decision instead; a ticket whose worker pauses for this
  reason raises a conductor-owned `gate_finding`, withdrawn on the worker's next successful turn.
- `run-recovery/paused-worker-visibility`: the requirement that every surface naming a paused
  worker's reason names it names the board, the project overview and the conductor's digest
  explicitly, closing the gap where two of those surfaces look it up through a live-only map that
  cannot show a paused worker at all.
- `runtime-credentials/serialized-refresh`: a refresh failure's recorded message states what the
  freshness check actually found, and never repeats an account descriptor's own informational note
  as if it were the reason the refresh failed.

## Impact

- `packages/core/src/runs/engine.ts`: `finalize()`'s wake-status write is family-aware (auth ⇒
  requeue, not fail); the auth branch counts consecutive same-agent auth failures and calls
  `parkForHuman` instead of `gateRuntimeForLogin` on the third.
- `packages/core/src/runs/authgate.ts`: `gateRuntimeForLogin` takes the ticket id and raises/keeps a
  per-ticket `gate_finding`; `ungateRuntime`/the success path withdraws it.
- `packages/core/src/runs/credentialFreshness.ts`: `refresh()`'s failure message is built from what
  `describeAccount` and `readCredential` actually reported, not from the description's `note` alone.
- `packages/core/src/briefing/service.ts`: `underway()` selects and returns the worker's status and
  pause reason.
- `packages/ui/src/lib/board.ts`: a paused-worker-by-ticket lookup independent of
  `liveWorkersByTicket`'s live-only filter.
- `packages/ui/src/routes/Board.tsx`, `packages/ui/src/routes/project/WorkSection.tsx`: use the new
  lookup to compute `workerPausedFor` instead of the live-only map.
- Tests alongside each: `engine.test.ts`, `authgate.test.ts`, `credentialFreshness.test.ts`,
  `briefing.test.ts`, `packages/ui/src/test/board.test.tsx`.

## Out of scope

- Whether a metered/API-key account (no OAuth subscription) should skip the freshness check
  entirely rather than fail it with an honest message. The evidence here shows the message is wrong,
  not conclusively why `describeAccount` reported a metered account's shape for a credential that
  (per the six other agents paused at the same moment) was genuinely mid-outage; that needs a live
  capture, not a guess, and is called out as an open question in `design.md`.
- The credential refresh mechanism itself (VS-105) and anything in the retry ladder unrelated to the
  `auth` family (VS-56/VS-75 already cover it).
