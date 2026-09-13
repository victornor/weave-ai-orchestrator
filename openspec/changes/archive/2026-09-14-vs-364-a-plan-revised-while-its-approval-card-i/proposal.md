## Why

A worker woken to answer weaver `concerns` on a `proposed` plan edits its OpenSpec artifacts and
commits them, but ends its turn without transitioning. Nothing republishes the revised plan: the
approval card still shows revision 1, the concern-hold has no new revision to lift on, and a card
that should have been re-reviewed sits held. On 2026-09-13 (VS-353) it waited 1h37m until captain
noticed, and was released only by a hand-run `proposed → proposing → proposed`. The same silent gap
exists for any steering that arrives while a ticket is still `proposed`.

## What Changes

- **Republish a changed plan at the end of a worker's turn.** When a worker's run ends on a ticket
  that is `proposed` and carries an OpenSpec change, the daemon re-renders the plan from the worker's
  worktree and compares it with the current `plan` document. If it differs and `openspec validate
  --strict` passes, it publishes a new `plan` revision and raises a fresh `plan_approval` exactly as
  the `proposing → proposed` transition does — reusing that path — then records an activity event,
  posts a ticket status comment, and lets the fresh card wake the weaver for review.
- **A revised plan lifts the concern-hold.** Publishing the new revision supersedes the held card, so
  the fresh `plan_approval` starts unreviewed and un-held, and the human can approve it without an
  override.
- **Invalid artifacts publish nothing.** If validation fails, no revision and no card are created;
  the daemon comments the validation issues on the ticket and wakes the weaver.
- **Unchanged artifacts do nothing.** A turn that did not change the plan produces no revision, no
  card and no comment.
- **Guidance matches the semantics.** The worker skills state that a plan revised while the ticket is
  still `proposed`, in answer to weaver concerns or steering, needs no transition — the daemon
  republishes the changed plan at the end of the worker's turn — that the worker must never move the
  ticket back to `proposing` by hand, and that requesting `proposed` applies only when the ticket is
  already in `proposing` (the revise path). The `weave_decision_review` tool description, the
  weaver skill and the weaver instruction template state that `concerns` holds approval until a new
  plan revision (or a new commit on a merge) lands, so it is only for "the work must change before
  approval"; notes to apply while building belong in a `looked` note.

Explicitly unchanged: who owns plan approval and how an override works; `merge_approval` and
`action_approval` flows; the `proposing → proposed` gate itself.

## Capabilities

### New Capabilities
- `agent-prompts/worker-plan-revision`: what the shipped worker skills say about a plan revised while
  its approval card is still held.
- `agent-prompts/weaver-review-guidance`: what the shipped weaver guidance (`weave_decision_review`
  tool description, weaver skill, weaver instruction template) says about what `concerns` means and
  holds, and where build-time notes belong.

### Modified Capabilities
- `human-decisions/approval-integrity`: a `proposed` change ticket whose OpenSpec artifacts change
  during a worker turn gets a new `plan` revision and a fresh `plan_approval` at the turn's end,
  through the same publication path the `proposing → proposed` transition uses; invalid artifacts
  publish nothing and surface their issues.
- `human-decisions/conductor-review`: the concern-hold lifts when a revised plan is republished at
  turn end, and the review guidance reflects that `concerns` keeps holding until a revision lands.

## Impact

- `packages/core/src/openspec/index.ts`: a republish entry point (or a thin wrapper over
  `validateForProposed`) that re-renders and validates from the worker's worktree.
- `packages/core/src/tickets/service.ts`: extract the plan-publication-plus-fresh-approval block out
  of the `proposing → proposed` transition and reuse it; add the turn-end republish call, the
  unchanged no-op, and the invalid-artifacts comment/wake. `packages/core/src/api.ts` gains the
  method on `TicketsService`.
- `packages/core/src/runs/engine.ts`: invoke the republish when a worker run ends.
- `packages/server/src/tools.ts` (`weave_decision_review` description), `skills/weave-ai-worker/SKILL.md`,
  `skills/weave-ai-openspec/SKILL.md`, `skills/weave-ai-weaver/SKILL.md`,
  `templates/weaver.AGENTS.md.tmpl`: the guidance updates.
- Tests: a real temporary OpenSpec change in the core harness for revised / unchanged / invalid /
  not-`proposed` cases; the existing decision-hold tests stay green. No schema migration, no new
  route; `docs/API.md` and `docs/PLAN.md` are unaffected.
