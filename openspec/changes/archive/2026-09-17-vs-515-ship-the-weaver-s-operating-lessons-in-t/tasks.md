## 1. Worker-option choice

- [x] 1.1 Confirm the worker-option lesson is already shipped by the required-field change now on main (`workerModelId` required, the refusal lists the options, and the text says to read the descriptions rather than guess) and add no duplicate rule here; keep the landed wording on the one shared sentence through the rebase.

## 2. Review-card guidance

- [x] 2.1 In `skills/weave-ai-weaver/SKILL.md`'s review section, add: review the oldest unreviewed card first because a waiting card does not re-wake the weaver and new cards arrive with the digest; mark every card read, including one held for a reason outside the work, with its `waitingOn`; a `concerns` mark wakes nobody so return and re-review when the revision lands.
- [x] 2.2 In `skills/weave-ai-weaver/SKILL.md`'s review section, add that a plan or report asserting success is not evidence and the delivery is read, that visual evidence means the renders across supported themes and viewport sizes opened and confirmed, and that a pull request is not called ready while its checks run.
- [x] 2.3 In `templates/weaver.AGENTS.md.tmpl`'s plan/merge/action card paragraph, add the oldest-first order, that a card held for a reason outside the work is still marked with its waiting statement, and that a pull request is not called ready while its checks run, folding the last into the existing `waitingOn` sentence rather than adding a new one.

## 3. Routing what the human says

- [x] 3.1 In `skills/weave-ai-weaver/SKILL.md`, add that a stated want is acted on rather than turned into a poll, and that asks arriving together are one ticket; verify the existing roadmap guidance still states that a `blockId`-carrying message is recorded as a roadmap item and not filed as a ticket, and add nothing where it does.

## 4. Reading worker state

- [x] 4.1 In `skills/weave-ai-weaver/SKILL.md`'s supervision table and relaunch guidance, add that a run that succeeded with no scheduled wake is a stall regardless of the digest label, that a run is inspected before relaunching, and that the weaver checks whether the human already resumed the worker.

## 5. Tests

- [x] 5.1 Add assertions to `packages/core/src/prompts/render.test.ts` that the rendered weaver instructions carry the worker-option rule, the oldest-first review rule, the held-card marking, and the succeeded-with-no-wake stall rule; confirm the `packages/shared/src/tools.test.ts` prose guard still passes.

## 6. Verify the shipped text

- [x] 6.1 Read the final diff of both files for deployment specifics — no workspace, project, ticket or human name — and confirm `templates/weaver.AGENTS.md.tmpl` stays under its 200-line target and that no rule is repeated in both files.
- [x] 6.2 Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `openspec validate vs-515-ship-the-weaver-s-operating-lessons-in-t --strict`, and report both suite blocks verbatim.
