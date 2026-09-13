## 1. Reuse the plan publication path

- [x] 1.1 In `packages/core/src/tickets/service.ts`, extract the inline `plan_approval` creation from the `to === 'proposed' && t.kind === 'change'` branch of `transition` (the `deps().decisions.create({ kind: 'plan_approval', ... })` plus the `yolo(next)` → `autoApprove` call) into a private `raisePlanApproval(actor, t, opts?: { context?: string })`, returning the decision. Call it from the `transition` branch and from `repairApprovals`'s `proposed` loop, preserving each caller's current title, context, `owner`, `askedByAgentId`/`askedInRunId` and YOLO handling exactly. `pnpm typecheck` to confirm it compiles.
- [x] 1.2 Confirm the existing plan-approval tests still pass: `pnpm vitest run packages/core/src/tickets/tickets.test.ts packages/core/src/decisions/decisions.test.ts packages/core/src/tickets/yolo.test.ts`.

## 2. Republish a revised plan at the end of a worker's turn

- [x] 2.1 Add `republishRevisedPlan(actor: Actor, ticketId: string): Promise<{ republished: boolean; reason: string }>` to `packages/core/src/api.ts` `TicketsService` and implement it in `packages/core/src/tickets/service.ts`. Guard: return `{ republished: false, reason: 'not proposed' }` unless the ticket is `proposed`, `kind === 'change'` and has an `openspecChangeName`. Then `const res = await deps().openspec.validateForProposed(ticketId)`. On `{ ok: false }`: `systemComment` listing each issue's message (one per line), `wake(conductorId(), 'system', ...)` naming the ticket, return `{ republished: false, reason: 'validation failed' }`. On `{ ok: true }`: read `getDocument(ticketId, 'plan')?.body`; when equal to `res.plan`, return `{ republished: false, reason: 'unchanged' }`; otherwise `putDocument({ kind: 'system', id: null }, ticketId, 'plan', res.plan, { system: true })`, `raisePlanApproval` with a revised-plan context, `systemComment` stating the revised plan was published, and `recordActivity` for the republish. Wrap the body in try/catch, log a warning and return `{ republished: false, reason: ... }` rather than throwing.
- [x] 2.2 In `packages/core/src/runs/engine.ts` `executeRun`, after each `finalize(...)` that ends a `worker` run with a `ticket`, `await deps().tickets.republishRevisedPlan({ kind: 'system', id: null }, ticket.id)` inside a try/catch that logs a warning on failure, so a republish problem never fails the run.
- [x] 2.3 Run `pnpm typecheck`.

## 3. Guidance text

- [x] 3.1 In `skills/weave-ai-openspec/SKILL.md` (Revision) and `skills/weave-ai-worker/SKILL.md`, state that a plan revised while the ticket is still `proposed`, in answer to weaver concerns or steering, needs no transition — the daemon republishes the changed plan at the end of the worker's turn — that the worker must never move the ticket back to `proposing` by hand, and that requesting `proposed` applies only when the ticket is already in `proposing` (the revise path).
- [x] 3.2 In `packages/server/src/tools.ts` (`weave_decision_review` description), `skills/weave-ai-weaver/SKILL.md` (the review paragraph) and `templates/weaver.AGENTS.md.tmpl` (the "Review plan, merge and action cards" paragraph), state that `concerns` holds approval until a new plan revision (for a plan) or a new commit (for a merge) lands, so it is only for "the work must change before approval", and that notes to apply while building go in a `looked` note. Keep the existing "not an endorsement, never your approval" language.
- [x] 3.3 Run `pnpm vitest run packages/shared/src/tools.test.ts packages/core/src/prompts/render.test.ts` — the tools test fails on an unregistered `weave_*` token or stray `ac_*`, and the prompt test pins the rendered weaver text.

## 4. Tests

- [x] 4.1 Add `packages/core/src/tickets/plan-republish.test.ts` using `makeHarness`, a real temporary OpenSpec change on disk (`writeChange`) and the fake openspec binary (`writeFakeOpenspec`), with the real `TicketsService` and real `OpenSpecService`, stubbing `decisions`/`wake` where needed. Assert:
  - a `proposed` `change` ticket whose artifacts changed produces `plan` revision 2, supersedes the prior `plan_approval`, creates a fresh open card targeting revision 2, wakes the weaver, and comments that the revised plan was published;
  - a run with no artifact change creates no revision, no card and no republish comment;
  - invalid artifacts publish nothing, create no card, leave a ticket comment naming the issues, and wake the weaver;
  - a ticket whose status is not `proposed` is never republished.
- [x] 4.2 In `packages/core/src/runs/engine.test.ts`, assert that a worker run ending on a ticket calls `tickets.republishRevisedPlan` (spy/stub) exactly once, and that a non-worker run does not.
- [x] 4.3 Run `pnpm vitest run packages/core/src/tickets/plan-republish.test.ts packages/core/src/runs/engine.test.ts`.

## 5. Validate and run the suites

- [x] 5.1 Run `openspec validate vs-364-a-plan-revised-while-its-approval-card-i --json --strict` and fix any item.
- [x] 5.2 Run `pnpm lint && pnpm typecheck && pnpm test` and paste both suite blocks verbatim in the report; this touches core and server, so both must be green.
