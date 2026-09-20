## 1. The setting

- [x] 1.1 Add `visualPlanArtifact: z.boolean()` to `ProjectPoliciesSchema` and a `visualPlanArtifactEnabled(policies)` resolver in `packages/shared/src/config.ts` that returns true only for `true`. Verify with a unit test: absent, false and malformed values resolve off; `true` resolves on.
- [x] 1.2 Confirm the policy round-trips through `PATCH /projects/:id` and the project config file with no route or schema change. Verify: a `policies.visualPlanArtifact: true` PATCH is persisted to the DB row and the `workspace.yaml` block, and `GET /projects/:id` reports it (a route/service test).

## 2. The per-ticket rule

- [x] 2.1 Add migration `0060` with `tickets.plan_artifact_required INTEGER` (nullable) and convert it to a boolean in `ticketRow` (`packages/db/src/repos.ts`); add `planArtifactRequired: boolean` to the `Ticket` type (`packages/shared/src/types.ts`). Verify migrations apply cleanly and an existing row reads `planArtifactRequired: false`.
- [x] 2.2 Stamp the rule for a `change` ticket at assign time, from the project's policy, beside `bindOpenspec` (`packages/core/src/tickets/service.ts`), on both the create-with-role and `assign` paths. Verify: a change ticket assigned on a policy-on project stores true; on a policy-off project stores false; a non-change ticket never stores it.

## 3. The `proposed` gate

- [x] 3.1 In `transition`, when `to === 'proposed'` and the ticket's kind is `change` and its rule is on, require a stored `artifact:plan` document with a current revision, and refuse with a `validation` error naming `weave_ticket_artifact_put` and the key `plan`, leaving the ticket in its prior status. Verify: refused without it on both the OpenSpec and fast paths, accepted with it on both.
- [x] 3.2 Confirm the gate is additive: OpenSpec validation and the fast-path `approach` requirement still apply, and a link-only `artifact` work product with no stored `artifact:plan` document does not satisfy the rule. Verify with tests for each.
- [x] 3.3 Confirm a ticket that began while the policy was off is not gated after the project turns it on, and a ticket that began while on keeps the requirement after the project turns it off. Verify with tests using the stamp.

## 4. Worker guidance

- [x] 4.1 Add a `planArtifact` flag to `WorkerTemplateData` from the ticket's stamp (`packages/core/src/prompts/index.ts`) and tell the worker, in `templates/brief.md.tmpl` and `templates/worker.AGENTS.md.tmpl`, to publish a plan artifact under key `plan` before `proposed` when it is set — a diagram, comparison, sequence/dependency view or mock — supporting rather than replacing the written plan. Verify with a rendered-brief test for both flag states.
- [x] 4.2 Update `skills/weave-ai-worker`, `skills/weave-ai-openspec` and `skills/weave-ai-artifacts` to state the rule and the reserved key. Verify the prose guard (`packages/shared/src/tools.test.ts`) passes and the skills read correctly by source.

## 5. Showing it

- [x] 5.1 Add an optional `planArtifact` prop to `packages/ui/src/components/DecisionCard.tsx` (V1), rendered as a labelled control with the artifact's title opening its sandboxed viewer route, and pass the ticket's `plan` artifact from the Plan view (`packages/ui/src/v2/ticket/Ticket.tsx`). Verify with a UI test that a `plan_approval` card with an `artifact:plan` shows it, and one without does not change.
- [x] 5.2 Make `packages/ui/src/v2/DecisionCard.tsx` prefer the `plan` artifact on a `plan_approval` card over any other artifact. Verify with a UI test where a ticket carries two artifacts.
- [x] 5.3 Add the Visual plan artifact control to the Settings Projects row (`packages/ui/src/settings/sections.tsx`) — inline, experimental, with its cost line — and to the add-project form. Verify with a UI test: the control PATCHes `policies.visualPlanArtifact`, the add form sends it, and the default is off.

## 6. Tests and evidence

- [x] 6.1 Tests, per the ticket: default off changes nothing; on refuses `proposed` without an artifact on both the OpenSpec and fast paths and accepts it with one; a non-change ticket is unaffected; a ticket that began before the flip keeps its original rule; the card shows the artifact on both builders.
- [x] 6.2 Run one full test suite at a time with `--maxWorkers=4`, plus `pnpm lint` and `pnpm typecheck`, and paste both suite blocks verbatim in the PR.
- [x] 6.3 Capture UI acceptance evidence in both themes at desktop and phone width: the setting on a project row, and a plan approval card with its artifact; attach them to the ticket with `weave_ticket_attachment_put` (files in the home directory, never in `work/`).

## 7. Docs and knowledge

- [x] 7.1 Document the policy in `docs/OPERATIONS.md` (what it does, its cost, its default), add `visualPlanArtifact` to PLAN §20's project-policy list and the README cheat-sheet.
- [x] 7.2 Write the ticket `report` document and the project knowledge entry (the reserved `artifact:plan` key, the per-ticket stamp, the two-card-builder trap).
