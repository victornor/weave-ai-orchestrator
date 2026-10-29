## Why

A human can change their mind between approving a plan and the work starting. Today the worker who is told to change the plan cannot republish it: `approved` has no way back to `proposing`/`proposed`, and the turn-end republish (VS-364) only runs while the ticket is `proposed`. The approval on file then points at a plan revision the code no longer matches, and the only trace of the divergence is prose in a PR description. On 2026-10-29 (VS-905) the worker had to stop and wait for the weaver to rule the old approval sufficient, which left nothing on the card.

## What Changes

- The turn-end republish also runs for a `change` ticket in `approved` (work not yet delivered). When the worker's plan differs from the stored `plan` document, the daemon publishes it as a new revision, moves the ticket `approved → proposed` itself, and raises a fresh `plan_approval` card against the new revision. Approving that card moves the ticket to `approved` again and wakes the worker, exactly as a first approval does.
- The `approved → proposed` move is daemon-only: the transition table and the worker-facing `weave_ticket_transition` still refuse it, so a worker cannot un-approve itself. A worker can only cause it by changing the plan, which always ends in a new human/weaver-owned approval, never in an escape from one.
- The card context and a ticket status comment say the plan was revised after approval, name the revision approved before and the new one.
- The `weave-ai-worker` and `weave-ai-openspec` skills document the path: after approval, edit the artifacts (or `approach`), validate, say so on the ticket, and stop; do not transition and do not write code against the unapproved revision.
- Out of scope: `in_progress` and later (code already exists, so a plan change there is a different decision); the weaver's option to rule an existing approval sufficient stays available (it answers the fresh card).

## Capabilities

### Modified Capabilities
- `ticket-lifecycle`: a plan revised while `approved` is republished and re-approved.

## Impact

- `packages/core/src/tickets/service.ts` (`republishRevisedPlan`), `packages/core/src/runs/engine.ts` (comment only), tests next to `plan-republish.test.ts`, `skills/weave-ai-worker/SKILL.md`, `skills/weave-ai-openspec/SKILL.md`.
