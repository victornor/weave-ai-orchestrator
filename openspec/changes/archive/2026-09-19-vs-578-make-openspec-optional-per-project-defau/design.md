## Context

See `proposal.md` for the audit and motivation. The relevant current state:

- `Project.openspecEnabled` exists (`openspec.enabled`, default `true`) and already gates three things: `bootstrapOpenSpec` at project add (`packages/core/src/projects/index.ts:96`), the ticket↔change binding (`bindOpenspec`, `packages/core/src/tickets/service.ts:260`) and the two spawn-time binders (`packages/core/src/workers/index.ts:211,493`). Nothing else reads it.
- The `proposed` transition validates OpenSpec unconditionally for a `change` ticket (`service.ts:712`). With the flag off there is no change name, so validation fails and the ticket is stuck.
- The merge/archive path already degrades on a null change name: `attemptArchiveThenMerge` skips archiving, `archiveAfterMerge` returns a skip, the merge queue never reads OpenSpec. The only tickets it touches are those with a bound change name (the supervisor's archive sweep filters `openspec_change_name IS NOT NULL`).
- The worker prompt already carries `project.openspec` (`packages/core/src/prompts/index.ts:165`); no template consumes it. The brief's change line is already hidden when the change name is null.
- `knowledgeRepo` is the existing per-project toggle precedent: a Settings control plus `PATCH /projects/:id`; when flipping it on a ready project it runs a reviewed, PR-based switch (`packages/core/src/knowledge/repoSwitch.ts`).

The mode must be readable at points that run in the daemon (`tickets.service`, `specs`, the specs routes, the ticket-detail route, briefing), rendered into agent briefs, and editable from three surfaces. Every one of those already has access to the project row; none needs a new store.

## Goals / Non-Goals

**Goals**

- A `change` ticket on an OpenSpec-off project runs end to end with no OpenSpec artifact and no gate error, while keeping a reviewed plan step and the existing merge-approval flow.
- The switch is safe to flip while work is in flight.
- OpenSpec-on projects are byte-for-byte unchanged in behaviour.

**Non-Goals**

- Removing OpenSpec support, or changing the OpenSpec-on flow.
- Making OpenSpec a workspace-level default; it stays a project property.
- A new OpenSpec planning format beyond "one short plan document".
- Fixing `policies.taskTicketsUseOpenspec`'s absence from `ProjectPoliciesSchema` (see Open Questions).

## Decisions

### D1 — The ticket's own binding is the source of truth for its path

A `change` ticket is on the OpenSpec path iff `ticket.openspecChangeName != null`. The `proposed` gate, the plan context and the republish path branch on that, not on the project's live flag. Binding still happens (flag-gated) at creation/spawn, so the project's flag decides only *new* tickets.

**Why:** it is the only rule that satisfies "flipping the switch never breaks work in flight" in both directions without storing a mode on each ticket or a migration. A ticket bound before a flip keeps its name and therefore its flow; a ticket created while off has no name, so turning the project back on cannot retroactively demand spec deltas. It also means the transition needs no extra project read and cannot disagree with what the worker was told.

**Alternatives considered:** (a) re-read `project.openspecEnabled` in the gate — rejected, because flipping off would strand every bound-but-not-yet-proposed ticket, and flipping on would retro-demand artifacts. (b) add a per-ticket `mode` column — rejected as a migration and a second source of truth that can drift from the binding.

### D2 — The fast path is one worker-written document, published as the plan

The worker records its approach as a ticket document under the key `approach`. On `proposing → proposed` for an unbound `change` ticket the daemon reads the latest `approach` revision; if missing or blank it refuses with a `validation` error naming the missing plan; otherwise it writes that body as the `plan` document (exactly as the OpenSpec path writes the rendered proposal+tasks+design) and raises the plan-approval card unchanged.

**Why:** the whole plan-approval machinery — the card, the revision target, `republishRevisedPlan`, the Plan tab, `PlanPreview` — keys on the `plan` document. Reusing it means the fast path adds no second approval mechanism and the human reviews both modes the same way. Keeping the `plan` key daemon-owned preserves the invariant that a worker cannot forge the daemon's digest, and reuses the existing "a new `plan` revision supersedes the open approval" behaviour.

**Alternatives considered:** (a) let the worker write `plan` directly when off — rejected: it would relax a daemon invariant for a corner case and bypass the supersede logic. (b) require no plan at all — rejected by the ticket: a wrong approach is the expensive failure. (c) a comment instead of a document — rejected: comments are not revisioned and the card targets a document.

### D3 — Tools report the mode; the ticket route nulls the state

`OpenSpecStatus` gains `enabled: boolean` (`false` for an unbound ticket on an OpenSpec-off project). `weave_openspec_status` returns it; the ticket-detail route maps `enabled === false` to `openspecState: null`, which every existing UI consumer already treats as "nothing to show". `weave_spec_*` and the `/specs` routes return a typed `openspec_disabled` error for an off project.

**Why:** `weave_openspec_status`'s contract is to report the planning state, so an explicit flag is truer than a failure; but the spec tools' contract is to return specs, and there are none, so a typed refusal is clearer than an empty list that reads as "no capabilities". Nulling the ticket route's state reuses the UI's existing null handling instead of adding a parallel flag through the wire and every component.

**Alternatives considered:** returning `null`/empty for the spec tools too — rejected: `[]` is indistinguishable from a project that has capabilities but none indexed, and the ticket asks for a clear "off" signal.

### D4 — The post-creation toggle is a direct write; turning on bootstraps best-effort

Changing the mode after creation goes through the existing `PATCH /projects/:id` write, surfaced in Settings, the CLI and config. When a `ready` project flips off→on and its clone has no `openspec/`, the daemon schedules the same best-effort `bootstrapOpenSpec` the add pipeline uses and records the outcome as activity; it does not block the PATCH. Turning off writes nothing to the repo.

**Why:** turning off is purely daemon behaviour and reversible, so a reviewed PR would add ceremony for nothing. Turning on is the only direction that needs a repo change, and the add path already owns that exact bootstrap, so reusing it keeps one implementation. Mirroring `knowledgeRepo`'s reviewed switch was considered and rejected: that switch exists because committing knowledge visibly changes the repo's contents and visibility, whereas OpenSpec enablement can be bootstrapped by the daemon the same way a fresh add is, and the ticket does not ask for a reviewed switch.

**Risk accepted:** `bootstrapOpenSpec` pushes to the default branch; on a protected branch the push is refused and the clone is left without a committed `openspec/`, so new `change` tickets on that project would fail the proposed gate. The daemon records this as a warning; the operator must adopt OpenSpec through their own PR flow. This matches the existing add-path behaviour and is called out in Risks.

### D5 — Suppress the host-tool warning only when no project needs OpenSpec

`hostToolWarnings()` takes the live projects and drops the `openspec` warning when no non-archived project has the mode on. Every other host-tool warning is unchanged.

**Why:** the warning is an operator signal ("a project that needs this cannot run"), so it should follow whether any project needs it, not whether the binary exists in the abstract.

### D6 — Measure planning cost deterministically, and say what is not measured

The measurement task compares the token cost of the planning artifacts a comparable small `change` ticket produces under each mode (proposal + design + spec deltas + tasks for OpenSpec-on; one short plan for off), computed from fixtures. Live elapsed time and live token use of real runs are **not** measured inside this ticket: the workspace rule forbids launching a real coding CLI against the live credentials, and a fake adapter's elapsed time would be meaningless. The tasks state this limitation in the report rather than implying a live measurement.

## Risks / Trade-offs

- **Bootstrap-on-enable can silently fail on a protected default branch.** → Record the outcome as project activity and a warning; the proposed gate's host-tool/plan error names the condition; the operator adopts OpenSpec by PR. Documented in `docs/OPERATIONS.md`.
- **A stale bound change on a project now off keeps driving OpenSpec work** (the archive sweep and `validateForProposed` key on the name, not the flag). → This is intended (requirement 4) and is what lets in-flight tickets finish; the sweep only acts on tickets that actually have a change directory, and a project turned off will not gain new ones.
- **`openspec_disabled` is a new error code** and a new `OpenSpecStatus` field on the wire. → Both are additive; unknown codes already serialize and the UI reads `openspecState` as before.
- **The fast path is a second way to plan**, so the plan-approval code now has two producers. → Both funnel through `putDocument(actor, id, 'plan', …)` and `raisePlanApproval`, so the card, target and supersession stay single-path; the branch is one `if` on `openspecChangeName`.
- **Spec and implementation drift as the mode is read in several places.** → One helper resolves a ticket's path and one resolves a project's mode; tests cover the off-path end to end and the on-path regression.

## Migration Plan

No data migration. The DB column and config key already exist and default on. The change is additive: new branches read the existing binding, a new error code and status field are added, and the docs and skills gain the mode. Rollback is a revert; a project that turned the mode off is still a valid OpenSpec-on project once reverted (its unbound tickets simply were never bound).

## Open Questions

- `policies.taskTicketsUseOpenspec` is read by `bindOpenspec` but is absent from `ProjectPoliciesSchema`, so it cannot currently be persisted through `PATCH`. Adding it to the schema is a small, separate correctness fix that does not change this mode's specs or approach; left as a follow-up rather than folded in silently.
