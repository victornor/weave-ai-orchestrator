## Context

A worker stopped by an unretryable failure is parked by `parkForHuman`
(`packages/core/src/runs/engine.ts:1239`): it pauses the agent, raises a human-owned
`retry_approval` decision (`correlationKey: retry:<agentId>`, `target.agentId`), and blocks the
ticket. The only things that ever close that card are the engine's success path ("the worker
recovered", `engine.ts:1097`) and the human answering it. Putting the worker back to work — the
human's resume, the weaver's `weave_worker_relaunch` (which resumes a parked worker,
`workers/index.ts:716`), or the automatic resume after a daemon restart — never touches the card, so
it stays in Needs you while the worker runs.

Answering it is not harmless. `applyRetryApproval` (`decisions/service.ts:388`) handles `retry` by
calling `workers.relaunch`. On a parked worker that is a resume; on an already-resumed worker the
agent is no longer `paused`, so `relaunch` takes its full path — bump brief, re-render home, enqueue
another wake — a second turn on top of a healthy one. `retry_1h`/`retry_at_reset` book a further
wake; `switch:` changes the ticket's option. All are stale.

## Decisions

### D1: Close as `superseded`, with the reason recorded in `answerText`

The ticket names "superseded" and the superseded status already carries the right client behavior:
`decision.superseded` is patched into every cached decisions list synchronously (VS-140,
`packages/ui/src/lib/*` and `api/events.ts`), so a card under an open-filtered Needs you query leaves
without a refetch. The existing `supersedeOpen` records no reason, and the existing `withdraw`
records a reason but sets a different status and emits `decision.answered` (which is a lie — nobody
answered). So this adds one small method, `supersede(actor, id, reason)`, that sets
`status: 'superseded'`, writes the reason to `answerText`, records a `decision.superseded` activity
and emits `decision.superseded`. It refuses a decision that is not `open`, so an answered card can
never be rewritten.

### D2: One helper closes the worker's stop cards; every resume path calls it

A new `supersedeWorkerStopCards(actor, workerId, reason)` on the decisions service finds the open
decisions that describe *this worker being stopped* and supersedes each with the reason:

- a `retry_approval` whose `target.agentId` is the worker (the parking card), and
- a `gate_finding` whose `correlationKey` is `stalled-worker:<workerId>` (the supervisor's
  escalation).

It matches on the worker, not on the ticket or the correlation key alone, so it closes exactly the
cards about this worker and nothing else.

Callers, covering every named path:

- `workers.resume()` — the human's resume, the weaver's relaunch of a parked worker, and the
  `switch:` answer all funnel here. Called after the agent is cleared to `active`, guarded so a
  failure to close never blocks the resume.
- `workers.relaunch()`, non-paused branch — a relaunch of a worker that failed without being parked
  (belt and braces; a parked worker took the resume branch above).
- `supervisor.bootRecovery()` — the automatic resume of a turn a daemon restart interrupted, per
  recovered agent.

The reason names the actor and the instant, e.g. `the worker was resumed by the weaver at
2026-09-20T04:52:11.000Z`, `…relaunched by the human at …`, or `…resumed after a daemon restart at …`.

The handover path (`endHandover`, the supervisor's abandoned-hold sweep) and `ungateRuntime` set a
worker `active` directly without going through `resume`. Neither can produce the gap this change
fixes: a held or login-paused worker is not parked by `parkForHuman`, so it has no parking card, and
the login gate's own cards are withdrawn by its existing machinery. They are recorded here rather
than changed.

### D3: A stale answer is a no-op, recorded where the human reads it

`applyRetryApproval` gains a guard: resolve the worker's current status first; if it is not `paused`
and the answer is not the one exception below, do nothing that starts work — no `relaunch`, no retry
wake, no model switch — and record why. The clear message goes on the ticket as a `status` comment
(and a `decision.retry_stale` activity), because `answerText` is the human's own words and must not
be overwritten with a system note.

Every answer on a stale card is a no-op, `cancel` included: the card describes a worker that has
already stopped being stopped, so acting on any of its options would act on a state that no longer
holds. Cancelling a running worker is still available from the worker's page and the ticket, which
are never stale.

### D4: The four other worker-failure/stall decisions

| Decision | Raised by | Describes | Shares the resume mechanism? | Disposition |
|---|---|---|---|---|
| `retry_approval` (`retry:<agentId>`, owner human) | `parkForHuman` | worker failed/parked | Yes | Fixed (D2) |
| `gate_finding` (`stalled-worker:<agentId>`, owner weaver) | `stallRecoveryScan` | worker stalled with no future wake | Yes — a resume/relaunch is the card's own offered remedy | Fixed (D2) |
| `gate_finding` (`empty-turns:<agentId>`, owner weaver) | engine `finalize` | worker produced three empty turns in a row | No — it goes stale when a later turn produces evidence, not when the worker is resumed; and it is never withdrawn at all today | Reported, not fixed here |
| `gate_finding` (`auth-outage:<ticketId>`, owner weaver) | `gateRuntimeForLogin` | worker paused for the runtime's expired login | No — resume is refused while the runtime is gated; the worker is released by the runtime ungate and the card is withdrawn on its next completed non-auth turn | Reported, not fixed here |
| `question` (`runtime-login:<runtimeId>`, owner human) | `gateRuntimeForLogin` | a runtime's credential, not a worker | No — it is about the runtime and is withdrawn by `ungateRuntime` | Not applicable |

The empty-turns finding is a real, separate gap (a stale card that no code ever closes) worth its own
ticket; it is out of scope here because resuming does not resolve it.

### D5: Verification without a live CLI

The behavior is tested in core against the fake runtime and scratch DB (no coding CLI, no live
credentials). The UI consequence is verified two ways: the existing VS-140 test proves a
`decision.superseded` event removes the card from a `status: 'open'` query without a refetch, and the
Needs you screen reads exactly that query (`NeedsYouPage.tsx:106`) so the count is its length; a
`retry_approval` case is added beside it. If a scratch daemon and the built UI can be served without
touching the live install, a before/after screenshot of Needs you is attached to the ticket; the core
and UI tests are the evidence if not.

## Non-goals

- No change to which failures park a worker, the ladder, or the card's options.
- No new decision kind, no schema migration, no route, no UI design change.
- Not fixing the empty-turns finding or the login-outage withdrawal timing (D4).
