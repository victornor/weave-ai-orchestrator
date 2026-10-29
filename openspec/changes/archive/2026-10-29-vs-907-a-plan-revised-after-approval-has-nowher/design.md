## Context
`republishRevisedPlan` (VS-364) already re-renders the plan at the end of a worker turn, writes a new `plan` revision (which supersedes the open card via `supersedeForTarget`) and raises a fresh card, but only for `proposed`. `approved` has no edge to `proposed`/`proposing`.

## Decision
Of the ticket's options, take a variant of (2), re-pointing approval at the new revision by raising a new card, with the daemon (not the worker) moving the status.
- Option 1 (allow `approved → proposing`) lets a worker un-approve itself on request; rejected.
- Option 3 (attested "scope-reducing, no re-approval") relies on a claim nobody can verify and leaves the card pointing at a plan not built; rejected. The weaver can still reach the same end by approving the fresh card, which is recorded.
- Chosen: reuse the existing republish path. Status moves `approved → proposed` inside the same write transaction that stores the revision, re-checking inside it that the ticket is still `approved` (a delivery or transition mid-validation must win). Not an entry in `TRANSITIONS`, so the tool surface is unchanged. Activity `ticket.plan_republished` carries `fromStatus: 'approved'` and both revisions; a status comment records it.
- Approval of the new card goes through the normal `proposed → approved` path, so YOLO, ownership and the "worker woken on approval" behaviour need no new code.

## What counts as "the plan differs"
`renderPlan` inlines proposal, `tasks.md` and design verbatim. Proposal and design change only when the worker decides something; `tasks.md` also changes when it does work (ticking boxes). Whole-string comparison was harmless while republish ran only on `proposed`, but on `approved` it would silently un-approve a ticket on the first ticked task. The comparison therefore normalises `- [x]`/`- [X]` to `- [ ]` (line-start task markers, any indentation) on both the stored and the new body, keeping every other character significant, so any change to task text, order or count is a revision. A structural task diff was considered and rejected: it adds a parser for no gain. Checked: `tasks.md` is the only progress-mutated part of the rendered plan; the fast-path `approach` document is written by the worker as a plan and has no checkboxes by convention (a ticked box there is normalised the same way). On `proposed` the hazard is live today: a worker ticking a box while `proposed` triggers a republish and a needless fresh card, so this change fixes a defect as well as guarding the new path. When a revision is published, the stored body is the new plan as rendered, ticks included.

## Risks
- A worker mid-way through implementation (uncommitted code) whose artifacts change gets re-gated; accepted, that is the point. The skill tells it not to code against the unapproved revision.
- `in_progress` unchanged: still no republish. Follow-up if wanted.
- Worker liveness: `proposed` is a worker status, so no worker spawn change.
