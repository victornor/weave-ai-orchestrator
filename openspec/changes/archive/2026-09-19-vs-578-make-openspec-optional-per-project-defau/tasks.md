## 1. Mode resolution and the proposed gate

- [x] 1.1 Add `enabled: boolean` to `OpenSpecStatus` and set it from the ticket's binding in `packages/core/src/openspec/index.ts` (`statusFor`, `zeroStatus`), so `enabled:false` means an unbound ticket on an OpenSpec-off project. Verify with a unit test: unbound off-project ticket → `enabled:false`; bound ticket → `enabled:true`.
- [x] 1.2 In `packages/core/src/tickets/service.ts` `transition`, branch the `to === 'proposed'` gate on `t.openspecChangeName`: bound tickets call `openspec.validateForProposed` unchanged, unbound `change` tickets take the fast-path plan gate. Verify: an OpenSpec-on ticket with incomplete planning still rejects with `openspec_validation_failed`, and an unbound off-project ticket reaches `proposed`.
- [x] 1.3 Make `planApprovalContext` mode-aware so an unbound ticket's plan card carries no empty `OpenSpec change` line. Verify with a test asserting the card context for an unbound ticket contains no `OpenSpec change`.
- [x] 1.4 Extend `republishRevisedPlan` to republish the fast-path plan for an unbound `change` ticket while `proposed`. Verify with a test: a revised plan document replaces the `plan` revision and raises a fresh `plan_approval`.

## 2. The fast-path plan document

- [x] 2.1 Define the worker's planning document key (`approach`) and a helper reading its latest non-empty revision; refuse `proposed` with a `validation` error naming the missing plan when absent or blank. Verify with a test: missing/blank plan → transition rejected, ticket stays `proposing`.
- [x] 2.2 Publish the accepted text as the ticket's `plan` document and raise the plan approval through the existing `putDocument`/`raisePlanApproval` path. Verify with a test: the `plan` document holds the text and the `plan_approval` targets its revision.
- [x] 2.3 Confirm the fast path honours `proposalApproval`/YOLO exactly as the OpenSpec path (none auto-approves; YOLO still requires the weaver's look). Verify: off project with `proposalApproval: none` reaches `approved`; with `human`, stays `proposed` with an open card.

## 3. Toggle surfaces

- [x] 3.1 In `packages/core/src/projects/index.ts` `update`, keep the direct `openspec.enabled` write; when a `ready` project flips off→on and its clone has no `openspec/`, schedule the existing `bootstrapOpenSpec` best-effort and record the outcome as activity. Verify with a test: the flag flips both ways, and no OpenSpec work runs when turning off.
- [x] 3.2 Accept the `openspec` block in `POST /projects`'s `AddSchema` and add an optional OpenSpec flag to `weave_project_add` (default true). Verify: add with on persists on; add with off persists off and skips adoption.
- [x] 3.3 Add `weave project set-openspec <id> on|off` to `packages/cli/src/commands/project.ts` (PATCH `openspec.enabled`), keeping `weave project show`'s existing display. Verify with a CLI test or a scratch-daemon round-trip.
- [x] 3.4 Add the OpenSpec control to the Settings Projects row and the add-project form/onboarding, and carry `openspec` in `useAddProject`'s body type. Verify with a UI test: the toggle PATCHes `openspec.enabled`, the add form sends the choice, and the default is on.
- [x] 3.5 Document the CLI command in PLAN §20 and the README cheat-sheet; document the setting, both modes and when to use which in `docs/OPERATIONS.md`.

## 4. Degrade surfaces

- [x] 4.1 Add the `openspec_disabled` error code to `packages/shared/src/errors.ts` with an HTTP status. Verify `OcError.status('openspec_disabled')` is defined and the code appears in `ERROR_CODES`.
- [x] 4.2 In `packages/server/src/tools.ts`, make `weave_openspec_status` surface `enabled`, and make `weave_spec_list`/`get`/`change_get` return `openspec_disabled` for an off project; make a project-less weaver `weave_spec_search` omit off projects. Verify with tool tests.
- [x] 4.3 Make the `/specs/:project/*` routes return the typed off error and the ticket-detail route null `openspecState` when `enabled:false`. Verify with route tests.
- [x] 4.4 Make `packages/core/src/specs/index.ts` index and read with the project's mode, so an off project is not indexed and its pre-existing rows are not served. Verify: a project indexed then switched off returns `openspec_disabled`/empty from the service rather than stale rows.
- [x] 4.5 UI: hide the ticket page's OpenSpec panel for a non-OpenSpec ticket and show an explicit "OpenSpec is off for this project" state in the knowledge Specs view. Verify with UI tests for both.
- [x] 4.6 Suppress the `openspec` host-tool warning when no non-archived project has its mode on (`packages/core/src/tools/host.ts`, `packages/core/src/briefing/service.ts`). Verify with a test covering "no project on" and "one project on".

## 5. Prompts, skills, docs

- [x] 5.1 Make the rendered brief and worker `AGENTS.md` mode-aware: describe the fast path for an off-path `change` ticket, instruct the OpenSpec workflow only when bound, and name `work/openspec/config.yaml` only when the mode is on. Verify with a rendered-brief test for both modes.
- [x] 5.2 Update `skills/weave-ai-worker`, `skills/weave-ai-openspec` and `skills/weave-ai-weaver` to state that OpenSpec is a per-project mode and describe the fast path. Verify the prose guard (`packages/shared/src/tools.test.ts`) passes and the skills read correctly by source.
- [x] 5.3 Update the in-repo worker prompt docs (`docs/prompts/worker.AGENTS.md.tmpl`, `docs/prompts/skills.md`) for the mode.

## 6. Tests and verification

- [x] 6.1 Add an OpenSpec-on regression test proving the existing flow is unchanged: a `change` ticket with incomplete or invalid planning still rejects at `proposed`, and the on-path merge still archives.
- [x] 6.2 Add an end-to-end off-project test through the ticket state machine: a `change` ticket reaches review and merge with no OpenSpec artifacts, no archive and no gate error.
- [x] 6.3 Add flip tests both directions: a ticket bound while on keeps its OpenSpec flow after the project turns off; a ticket created while off is not retro-required after the project turns on.
- [x] 6.4 Run `pnpm lint`, `pnpm typecheck` and `pnpm test`, and paste both suite blocks verbatim in the PR/report.

## 7. Measurement and reporting

- [x] 7.1 Measure the planning-artifact token cost of a comparable small `change` ticket on vs off from fixtures, and report the delta. State plainly in the report that live elapsed time and live token use were not measured (a real coding CLI must not be run from a ticket), and why.
- [x] 7.2 Write the ticket `report` document and the project knowledge entry, listing every design choice taken and any deliberate follow-up (the `taskTicketsUseOpenspec` schema gap).
