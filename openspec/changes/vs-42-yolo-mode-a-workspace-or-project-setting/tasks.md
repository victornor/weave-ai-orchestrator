## 1. The setting

- [x] 1.1 Add `yolo: z.boolean().default(false)` to `WorkspaceDefaultsSchema` and `yolo: z.boolean()` to `ProjectPoliciesSchema` (already `.partial()`, so absent = inherit) in `packages/shared/src/config.ts`; verify by parsing a config with and without the key in a shared unit test.
- [x] 1.2 Add `yoloEnabled(policies, workspaceDefault)` to `packages/shared/src/config.ts` beside `mergeConcurrencyOf`, resolving project-override → workspace-default and falling back to the workspace default for an absent or malformed value; verify with a unit test covering on/off/absent/garbage.

## 2. Plan approvals

- [x] 2.1 In `packages/core/src/tickets/service.ts`, add a `yolo(t: Ticket)` helper that resolves the ticket's project policies against `ctx.config.defaults.yolo` through `yoloEnabled`, and returns the workspace default for a ticket with no project.
- [x] 2.2 In `transition`'s `to === 'proposed'` branch, keep the `approvalOwner() === 'none'` short-circuit first, then — when `yolo(next)` — answer the just-created `plan_approval` with `deps().decisions.answer({ kind: 'system', id: null }, d.id, { key: 'approve', text: '<names YOLO mode>' })`, and re-read the ticket before returning so the caller sees `approved`. Verify with a core test: a `change` ticket reaching `proposed` under YOLO ends `approved`, and the decision row is `answered` / `answeredByKind: 'system'` with the mode in `answerText`.
- [x] 2.3 Verify the negative cases in the same test file: with YOLO off the decision stays `open` and the ticket stays `proposed`; a ticket whose OpenSpec plan fails validation still raises no decision and is not approved.

## 3. Merge approvals

- [x] 3.1 In `transition`'s `to === 'in_review'` branch, leave the `!next.autoMerge` condition that creates the `merge_approval` untouched, and schedule the deferred `autoMergeSweep()` for a YOLO ticket as well as an `autoMerge` one.
- [x] 3.2 Widen `autoMergeSweep`'s candidate query to `in_review` tickets that are `auto_merge = 1` **or** whose project has YOLO on, keeping the existing `deliveryMode` / `requireCi` / `prState` gate exactly as it is (pending → skip, failure → system comment and skip).
- [x] 3.3 At the end of the sweep's per-ticket body, branch once: if the ticket has an open `merge_approval`, answer it `approve` as the system with text naming YOLO mode; otherwise transition to `merging` as today. Verify with core tests that an `autoMerge` ticket still takes the direct path with no decision, and a YOLO ticket's open decision is answered by the system and the ticket enters the merge queue.
- [x] 3.4 Verify the timing and the off switch in the same tests: a YOLO ticket whose PR checks are pending keeps its decision open; failing checks leave it open and add the "waiting on CI" system comment; turning YOLO off before the sweep runs leaves an already-open decision unanswered and waiting for the human.

## 4. What must not change

- [x] 4.1 Add core tests asserting that with YOLO on, a `hire_approval`, a `discard_approval`, a `retry_approval`, a `gate_finding` and an agent `question` are all still `open` with their usual owners after a supervisor tick.
- [x] 4.2 Add a core test for the project override in both directions: workspace on + project off leaves that project's plan approval open, workspace off + project on auto-approves it, and a ticket in a sibling project is unaffected.

## 5. The agents' instructions

- [x] 5.1 Add the resolved flag to the worker template data in `packages/core/src/prompts/index.ts` (`project.yolo`) and state the approval policy in `templates/brief.md.tmpl` and the `BRIEF_TMPL` fallback in `prompts/defaults.ts`, both branches (on: plan and merge approvals are granted automatically, do not wait on the human; off: they wait).
- [x] 5.2 State the same policy in `templates/conductor.AGENTS.md.tmpl` from the `policies` block `renderConductorInstructions` already passes, so the conductor does not tell the human to approve something that will be granted without them. Verify both with `prompts/render.test.ts` cases for the mode on and off.

## 6. The surfaces

- [x] 6.1 Add a YOLO toggle to the workspace section of `packages/ui/src/routes/Settings.tsx` (patching `{ defaults: { yolo } }`) and a per-project override control in the projects section (patching `{ policies: { yolo } }`), each showing what it currently resolves to; verify with a UI test that toggling issues the expected patch.
- [x] 6.2 Add the persistent YOLO indicator to `packages/ui/src/app/AppShell.tsx`, visible on every screen while the workspace setting is on; verify with a UI test that it renders when on and not when off.
- [x] 6.3 Add an `autoApproving?: boolean` prop to `packages/ui/src/components/DecisionCard.tsx` that replaces the approve action with an "auto-approved by YOLO mode" line for a `plan_approval` or `merge_approval` (never for another kind), and pass it from `packages/ui/src/routes/NeedsYou.tsx` using the resolved flag — a prop, not a new hook, because the route tests mock `../api/hooks` wholesale. Verify with UI tests for both kinds and for an unaffected kind.
- [x] 6.4 Mark a ticket whose only open decision is auto-approving as auto-approving rather than needs-you on the board (`TicketCard` chip, driven from `Board.tsx`); verify with a UI test.
- [x] 6.5 Document the `yolo` key in the help text of `conductor workspace set-default` and `conductor project set-policy`; verify with the existing `packages/cli/src/program.test.ts` help assertions.

## 7. Docs and close-out

- [x] 7.1 Update `docs/PLAN.md` §15's ownership policy sentence so it no longer says merge approval is not overridable, naming the workspace/project setting.
- [x] 7.2 Add `docs/adr/0009-yolo-auto-approval.md` recording the deviation from §15 and why auto-approval answers the decision rather than skipping it.
- [x] 7.3 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all three are green.
