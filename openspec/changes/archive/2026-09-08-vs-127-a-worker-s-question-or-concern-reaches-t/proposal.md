## Why

A worker's `ac_ask` defaults to `kind: 'question'`, which the daemon owns by the human — so the
easiest thing a worker can do when it needs help lands in the human's queue, not the conductor's,
even though the conductor is who should triage a worker's questions and findings. Separately, a
ticket blocked with an unblock action owned by the conductor is not woken at all when it enters
`blocked`; it only surfaces once the periodic conductor digest happens to fire, up to two minutes
later, rather than immediately the way a gate finding already is. Both leave a stuck worker waiting
on nobody in particular.

## What Changes

- `ac_ask`'s decision owner is now resolved from **who is asking**, not from the `kind` the caller
  picked: any decision a worker raises — `question`, `concern` or `gate_finding` — resolves to the
  conductor. The conductor's own use of `ac_ask` is unchanged: it still reaches the human.
- `ac_ask` can no longer construct `plan_approval`, `merge_approval`, `hire_approval`,
  `discard_approval`, `retry_approval` or the generic `approval` kind. Those stay exclusively
  system-raised (the ticket, role and run-engine code that already creates them directly), closing
  a path where a worker's ask could collide on a real approval's correlation key and supersede it.
- A new `concern` decision kind gives a worker a cheap way to say "I'm stuck, here's what I tried,
  here's what would help" without inventing options for a decision it isn't actually making. It
  behaves like `question` — free text, no forced buttons — and, raised by a worker, is
  conductor-owned like every other worker ask.
- A ticket transitioned to `blocked` with `unblock.owner: 'conductor'` now wakes the conductor
  immediately in the same turn, instead of waiting for the next digest sweep.
- Worker- and conductor-facing skills and templates say plainly: a worker asks the conductor, never
  the human; the conductor answers what it can and escalates the rest to the human with its own
  `ac_ask`, telling the worker where things stand with `ac_worker_message` rather than leaving its
  decision open with no signal.

**BREAKING**: none of this changes a human-facing surface's shape — `plan_approval`,
`merge_approval`, `hire_approval`, `discard_approval` keep their owners and their cards exactly as
they are. A worker that was (incorrectly) relying on a `question` reaching the human directly now
finds it reaches the conductor instead; nothing in the accepted design ever documented that as
intended behavior (`docs/SCENARIOS.md`'s own worked example has a worker's `ac_ask` land on the
conductor as a `gate_finding`).

## Capabilities

### New Capabilities

- `worker-escalation`: how a worker's `ac_ask` decision is owned, how a worker raises a concern
  without inventing a decision, and how a ticket blocked on the conductor is surfaced to it
  immediately rather than at the next digest.

### Modified Capabilities

(none — this is additive; no existing requirement's behavior changes)

## Impact

- `packages/shared/src/enums.ts` — `DECISION_KINDS` gains `concern`; a new `ASKABLE_DECISION_KINDS`
  names what `ac_ask` may construct; `WAKE_SOURCES` gains `ticket_blocked`.
- `packages/db/src/migrations/` — a new migration rebuilds `decisions.kind`'s CHECK to admit
  `concern` (SQLite has no `ALTER ... DROP CONSTRAINT`; `0010_decision_kinds.sql` is the precedent).
- `packages/core/src/decisions/service.ts` — `defaultOwner` resolves `question`/`concern` by the
  asking agent's kind instead of always defaulting to `human`.
- `packages/core/src/tickets/service.ts` — `transition()` wakes the conductor immediately when a
  ticket enters `blocked` with `unblock.owner: 'conductor'`.
- `packages/server/src/tools.ts` — `ac_ask`'s `kind` schema narrows to `ASKABLE_DECISION_KINDS`; the
  handler stops hard-coding `owner` and lets the service resolve it; the tool description is
  rewritten.
- `packages/render/src/types.ts`, `packages/render/src/decision.ts`,
  `packages/ui/src/components/DecisionCard.tsx` — render `concern` like `question` (free text, no
  forced buttons) instead of falling back to the generic approve/reject card.
- `templates/worker.AGENTS.md.tmpl`, `templates/conductor.AGENTS.md.tmpl`,
  `skills/agent-conductor-worker/SKILL.md`, `skills/agent-conductor-conductor/SKILL.md`,
  `docs/PLAN.md`, `docs/SCENARIOS.md` — worker- and conductor-facing guidance, and the plan's own
  account of the decisions table and ownership policy.
