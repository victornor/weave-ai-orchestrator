## Context

See `proposal.md` for the incident. Three facts in the current code combine:

1. `tickets.transition` to `approved` always calls `wake(workerId, 'ticket_assigned', 'plan approved …')` (`packages/core/src/tickets/service.ts`).
2. `wake.enqueue` Gate 2 writes `status: 'skipped', skipReason: 'role_paused', finishedAt` when the worker's role is paused (`packages/core/src/wake/index.ts`). A skipped row is terminal.
3. Gate 0 returns any existing row for the same `idempotencyKey` regardless of status. The supervisor's liveness repair uses `idempotencyKey: liveness:<ticketId>:<status>` (`packages/core/src/supervisor/index.ts`). After a skipped repair wake, later scans return that skipped row and never queue.

`roles.resume` (`packages/core/src/roles/index.ts`) only flips `roles.status` to `active` and emits `role.resumed`. The dispatcher (`packages/core/src/runs/dispatcher.ts`) already leaves wakes queued when the runtime needs a login; it does not currently look at the role.

A runtime/model change is not the swallow path: `sessions.forTurn` already retires a session whose `runtimeId` does not match the workers setting (`packages/core/src/sessions/index.ts`). The apply turn simply never starts if no wake is queued.

## Goals / Non-Goals

**Goals:**

- Make "role paused" hold the *turn*, not drop the *wake* — same as the login gate.
- Make an idempotency key on a skipped/cancelled/failed row not block a later real enqueue, so liveness (and any other keyed wake) can recover after a skip that already happened.
- Pin the two acceptance journeys with tests: pause → approve → resume → apply starts; propose on A → switch to B → approve → apply starts on B.

**Non-Goals:**

- Replaying or backfilling wakes already skipped before this ships (the Gate 0 change is enough for keyed ones; unkeyed skipped plan-approval wakes from the incident were already relaunched).
- Changing `roles.resume` to enumerate workers and enqueue extra wakes.
- Changing Gate 2 for `agent_paused` / `agent_retired` / `agent_done` / `role_retired` / workspace-not-active.
- Auto-approving plans, or changing how a session persists on the same runtime.
- A new wake status.

## Decisions

### 1. Queue, do not skip, when the role is paused

**Chosen.** Drop the `role_paused` skip in Gate 2. The wake stays `queued`. The dispatcher candidate query (or a check inside `tick` before `claim`) skips a worker whose role is not `active`, the same way it already skips `runtime_credentials.needs_login = 1`. On `roles.resume`, the next 1 s dispatcher tick claims the waiting wake. No resume-side replay, no new event consumer.

**Rejected: skip as today, replay on `roles.resume`.** Would have to copy source/reason/payload/idempotencyKey off skipped rows, decide which agents, and still lose if resume ran before the skip was committed. Reconstructing a terminal row is the wrong primitive; the login gate already shows that "not yet" is `queued`.

**Rejected: skip as today, rely on liveness after fixing Gate 0.** Fixes the incident only after up to 60 s, and only for tickets that `livenessViolations` sees. A queued wake is an action path (`livenessViolations` already treats `queued` as live), so pause-then-approve would not even look stalled. Waiting on resume is the correct action path; inventing a 60 s repair is not.

### 2. Idempotency ignores skipped / cancelled / failed

**Chosen.** Gate 0 looks up by `(agent_id, idempotency_key)` only among rows whose status is `queued`, `claimed`, `coalesced`, or `completed`. A skipped repair wake from before this ships (or from any remaining skip reason) no longer poisons the key.

**Rejected: delete skipped rows.** They are the audit of a suppressed wake (PLAN §7.1). Keep writing them for the skip reasons that remain.

`coalesced` still wins: the work was absorbed into another queued wake.

### 3. Runtime-change coverage is a regression test, not a session-layer change

`model-selection/turn-resolution` already requires the next turn to launch on the setting in force and to retire the old session when the runtime differs. This change adds the missing guarantee that the apply *turn happens*. The test drives: workers setting A → propose (or seed a worker that has taken a turn on A) → setting B → `approved` → a queued `ticket_assigned` wake → dispatcher/session resolve to B. No new session policy.

### 4. PLAN §7.1 Gate 2 text

Update the paused-role clause from "skip (`role_paused`)" to "leave queued; the dispatcher does not claim while the role is paused." The remaining skip reasons stay.

## Risks / Trade-offs

- **Queued wakes accumulate for the whole pause.** A paused role that keeps receiving comments/approvals will have those wakes claimed in one bundled turn on resume (Gate 3 coalesces into the existing queued wake). That is the intended coalesce behaviour, not a thundering herd of runs. → Accept; one run per worker, payloads in `bundle`.
- **Dispatcher now joins `roles` (or a per-candidate lookup).** Cheap; one extra filter next to `needs_login`. Do not claim then abort — that would mark wakes `claimed` and lose them. → Filter before `claim`, same as login.
- **Tickets already `approved` with a skipped plan-approval wake at upgrade time.** Unkeyed, so Gate 0 does not help. Liveness will enqueue `liveness_repair` (now able to queue because the role is active and skipped keys no longer win). Worst case: one extra 60 s. No backfill job. → Accept.
- **A paused role with a queued wake is not a liveness violation.** Correct: the action path is "wait for resume". Surfaces already show the role as paused.

## Migration Plan

Code-only. No schema. Deploy with the usual daemon upgrade; in-flight skipped rows stay as history. Rollback is reverting the three code sites (wake Gate 2, wake Gate 0, dispatcher filter).
