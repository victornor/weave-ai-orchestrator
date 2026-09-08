## Context

Everything below is read from the current code, not from the incident's own account of it — the
incident report says a worker was left `active` with a stray `errorText`; the current
`finalize()`/`gateRuntimeForLogin` pairing (`packages/core/src/runs/engine.ts:393-404`,
`packages/core/src/runs/authgate.ts:77-92`) should already leave such a worker `paused` with
`pauseDetail.code === LOGIN_PAUSE_CODE`, and `engine.test.ts:767-785` pins exactly that. The
`runtime-credentials/login-outage` and `run-recovery/paused-worker-visibility` capabilities are
already archived, shipped specs — this change does not invent the pause/release mechanism, it closes
four gaps in it that hold even when it works exactly as specified. Two are read from the outage path
itself; two are read from the surfaces that are supposed to show its result. See proposal.md — Why
for the four in one paragraph each.

Key facts this design leans on, each verified in code rather than assumed:

- `finalize()` marks every wake a turn was answering as `'failed'` (terminal) in the same transaction
  that records the run's outcome (`engine.ts:406-408`), **before** the `errorFamily === 'auth'` branch
  even runs (`engine.ts:434`). `gateRuntimeForLogin`'s release comment says pending wake-ups are "left
  alone" (`authgate.ts:74-76`) — true for every *other* agent on the runtime, whose wake was never
  claimed because the dispatcher skips a gated runtime before claiming anything. It is not true for
  the triggering agent: its wake was claimed to run the very turn that just failed, and `finalize`
  has already closed it out by the time the pause happens.
- The dispatcher only claims wakes for agents in `active`/`error` (`dispatcher.ts:13`); a `paused`
  agent is skipped regardless of what wakes it holds. So once the triggering agent is paused, nothing
  will look at its wakes again unless something either re-queues the original wake or creates a new
  one — and `ungateRuntime` (`authgate.ts:140-149`) does neither; it only flips status back to
  `active` and relies on a wake already sitting `queued`.
- `engine.test.ts:632-638` and `:784` already pin, deliberately, that an auth failure creates **no**
  `source: 'retry'` wake. Any fix here must not create one — the fix is to stop discarding the
  existing wake, not to schedule a new kind of retry.
- The board's and the project overview's paused-reason lookup is built from
  `liveWorkersByTicket()` (`packages/ui/src/lib/board.ts:51-59`), which is filtered to
  `LIVE_AGENT_STATUSES = ['provisioning','active','running']` (`board.ts:41`) — `'paused'` is
  excluded by definition. `TicketCard`/`TicketRow` already render a `workerPausedFor` badge
  (`packages/ui/src/components/TicketCard.tsx:65-69,100`); `Board.tsx:87-90` and `WorkSection.tsx`
  simply never pass it a worker to describe, because the lookup they use cannot contain a paused one.
  `TicketPage.tsx:106` reads the ticket's worker directly (not through the live map) and is correct
  today — it is the one surface the incident's "every view we looked at" claim doesn't actually cover.
- `briefing/service.ts`'s `underway()` (`:46-59`) joins every non-retired worker to its ticket but
  selects only `t.status` and the ticket's latest status *comment* — never `a.status` or
  `a.pause_reason`. `warnings()` (`:83-86`) only fires for `status='error'`, which a correctly-paused
  auth-outage worker never is.
- `credentialFreshness.ts`'s `refresh()` (`:49-60`) calls `describeAccount()`, then — regardless of
  whether that call succeeded or what it reported — checks `isCurrentlyValid(readCredential())` and,
  if false, returns `{ok:false, message: description?.note}`. For a metered/API-key account,
  `describeAccount` succeeds and reports `billingType: 'metered_api'` with the informational note
  "this account is billed per token; it has no plan limits" (`packages/runtimes/claude/src/
  account.ts:71-72`); `readCredential` only ever reads an OAuth `expiresAt`
  (`packages/runtimes/claude/src/credential.ts:40-48`), which such an account has none of, so
  `isCurrentlyValid` is always false for it. The success note is handed back as if it explained a
  failure.

## Goals / Non-Goals

**Goals:**
- Close the four gaps above with the smallest change that makes each one testable, reusing the
  mechanisms the codebase already has for the adjacent case (the empty-turns `gate_finding`, the
  existing `workerPausedFor` rendering, the existing per-worker `parkForHuman` decision).
- Keep every existing, already-tested invariant intact: no `source: 'retry'` wake for an auth
  failure, no ticket-blocking for an auth failure, one card per outage.

**Non-Goals:**
- Deciding whether a metered/API-key account should skip the freshness check entirely. Fixing the
  message it produces is unambiguously correct; changing *whether* such an account ever gates the
  runtime is a behavior change this change cannot verify from static code, and the credential refresh
  mechanism itself is explicitly out of scope (VS-105). See Open Questions.
- Re-deriving why the two real incident runs recorded `active`/no-pause when the current code, read
  today, should produce `paused`. Either that code postdates the incident (plausible — VS-75's own
  comment cites "the outage of 2026-09-07") or something else entirely swallowed it; nothing here
  chases that further, because the four gaps this change closes hold on their own even when the
  pause/release mechanism works exactly as specified.

## Decisions

**1. Preserve the triggering agent's wake by requeuing it, not by scheduling a new retry.**
`finalize()`'s wake-status write (`engine.ts:406-408`) becomes family-aware: for `errorFamily ===
'auth'`, the wakes are reset to `'queued'` with `runId`/`claimedAt` cleared, instead of `'failed'`.
This is the same state every other waiting agent's wake is already in when the gate lifts, so
`ungateRuntime` needs no change at all — the dispatcher picks the requeued wake up the moment it
reclassifies the agent as `active`. Alternative considered: enqueue a fresh `source: 'retry'` wake
the way the ladder does. Rejected — it would create the exact wake shape `engine.test.ts:632-638`
and `:784` already assert does not exist for an auth failure, and it would double-count in
`countRetries()` for no benefit, since the retry ladder deliberately excludes `auth` already.

**2. Cap consecutive same-worker auth failures at three, checked before the wake is preserved.**
Before deciding how to record the wake, `finalize` counts how many of this agent's last two runs
(plus this one) all carry `errorFamily === 'auth'`. At three in a row with no success between them,
it takes the existing "spent" path — `parkForHuman`, the per-worker human decision, wake marked
`failed` as normal — instead of preserving the wake and calling `gateRuntimeForLogin`. This reuses
`parkForHuman` exactly as the retry ladder does when its own attempts are spent
(`engine.ts:452-455`), rather than inventing a second escalation shape. Three was chosen to match the
ladder's own bound elsewhere in this file, not derived from anything specific to auth; it only needs
to be small and stated, per the ticket's own ask. Alternative considered: reuse `countRetries()`'s
`retry_of_run_id` chain. Rejected — that chain is written by the dispatcher only when a wake's
payload carries `retryOfRunId` (`dispatcher.ts:20-38`), which a requeued *original* wake never does,
so the chain would never link these runs together at all; counting consecutive `errorFamily` values
directly on `runs` is simpler and does not depend on a mechanism built for a different case.

**3. The per-ticket conductor notice is a `gate_finding`, raised from `gateRuntimeForLogin`, not a
new decision kind or a new wake path.** `gateRuntimeForLogin` gains the ticket id and, inside its
existing `step()` guard pattern, raises a `gate_finding` owned by `conductor` (VS-127's
`defaultOwner` already routes that kind there unconditionally) with `correlationKey:
"auth-outage:<ticketId>"`, mirroring the existing per-runtime `correlationKey` idiom one line above
it. It is withdrawn from the same place the ladder already withdraws a `retry_approval` on success
(`engine.ts:465-471`), widened to also withdraw an open `gate_finding` with this ticket's
correlationKey. This is deliberately a second, additional decision alongside the existing
per-runtime, human-owned one (`authgate.ts:98-113`) rather than a change to it: that one is
workspace-scoped by design ("not attached to a ticket," `authgate.ts:105-106`) so that one outage
does not read as N per-ticket problems for the human; the conductor, unlike the human, is exactly who
should see it per affected ticket, because VS-127 already made per-ticket conductor attention cheap
and immediate.

**4. Fix the board/overview lookup by adding a second, non-live-filtered map, not by widening
`LIVE_AGENT_STATUSES`.** `board.ts` gains `pausedWorkersByTicket()`, built the same way as
`liveWorkersByTicket()` but keyed on `status === 'paused'` instead of the live set. `Board.tsx` and
`WorkSection.tsx` look a ticket up in this map (falling back to the live map's entry when present) to
compute `workerPausedFor`. Alternative considered: include `'paused'` in `LIVE_AGENT_STATUSES`.
Rejected outright — that constant also drives column placement and the "working" pulse
(`ticketBoardStatus`, `columnFor`), and a paused ticket must keep reading as paused/stalled there,
not as live work in progress; conflating the two would reintroduce the exact confusion this change
exists to remove.

**5. The digest gains columns, not a new section.** `underway()`'s query adds `a.status AS
workerStatus` and `a.pause_reason AS workerPauseReason` to its `SELECT`; the mapped row carries them
alongside the existing `status`/`lastStatus`. No new `Briefing` section, no new decision — a stalled
ticket becomes visible in the section that already lists it, which is both the minimal change and
consistent with the ticket's acceptance criteria treating the digest as one of several acceptable
surfacing points, not a mandated new one.

**6. The freshness-check message is derived from what was actually checked, not from
`description.note` unconditionally.** `refresh()`'s message-building takes both `description` and
`facts` (the local `readCredential()` result) into account: `description === null` or `billingType
=== 'unknown'` keeps using the description's own note (it is already framed as a problem in that
case — see `account.ts`'s `unknownAccount` callers); any other `billingType` builds a message stating
that the account was described successfully and what the local credential shows, and does not repeat
the account's own note. This is the minimal fix that makes the recorded text never lie about what
failed, without changing whether the check treats the account as needing a login — see Open
Questions for why that second question is left alone.

## Risks / Trade-offs

- **[Requeuing a wake instead of failing it changes what a wake's terminal states mean for this one
  case]** → The wake ends up back in `'queued'`, indistinguishable in that column from a wake that
  was never claimed. Mitigate by keeping the change scoped to exactly the `auth` family (every other
  family's wakes are untouched) and by testing that the requeued wake still shows a claim history via
  the run it was briefly attached to (the failed run row itself, not the wake, carries the
  `errorCode`/`errorFamily` a human or the conductor would want to see).
- **[The three-strikes cap and the per-ticket `gate_finding` both key off the ticket/agent, so a
  ticket reassigned to a new worker mid-outage starts its own count and its own card]** → This is the
  same boundary `parkForHuman` and the empty-turns gate finding already accept (both are per-agent);
  not treated as a new risk this change introduces.
- **[A ticket with no `ticketId` on its agent — a conductor or an interactive session's first
  turn — cannot get a per-ticket `gate_finding`]** → `gateRuntimeForLogin` already tolerates
  `agentId`/`runId` being absent; the new `ticketId` parameter is optional the same way, and the step
  is simply skipped when there is no ticket to attach it to, exactly as the runtime-wide decision
  already handles `ticketId: null`.

## Open Questions

- Should a metered/API-key account (no OAuth subscription) skip the freshness check entirely,
  since it structurally has no OAuth credential to expire? The fix in this change makes the recorded
  message honest either way; whether the check should even run for such an account is left to the
  owner to confirm once real evidence (a live capture, per the project's own convention for
  device/environment-specific bugs) shows whether `describeAccount` reporting `metered_api` during a
  genuine outage was itself correct, stale, or a degraded answer from a CLI that could not fully
  authenticate. Does not change the specs, the approach, or the tasks in this change — the message is
  fixed regardless of the answer.
