## 1. Make the renderer and the shipped conductor template agree

- [x] 1.1 In `templates/conductor.AGENTS.md.tmpl`, replace the `{{#each projects}}`/`{{#unless projects}}` and `{{#each roles}}`/`{{#unless roles}}` blocks with the joined-string variables `{{projects}}` and `{{roles}}` that `renderConductorInstructions` already computes — the same variables the built-in `CONDUCTOR_TMPL` consumes. Verify: rendering the shipped template for a workspace with one project and one active role lists both.
- [x] 1.2 Verify a workspace with no projects and no roles renders the renderer's empty-state text (`- (none yet)` / `- (none hired yet)`), not a blank gap, through the shipped template.

## 2. Cover the shipped templates and report the class

- [x] 2.1 Add a shipped-template case to `packages/core/src/prompts/render.test.ts` that renders `conductor.AGENTS.md.tmpl` with realistic data and asserts the "Projects in this workspace" and "Roles and live workers" sections are non-empty, plus an empty-workspace case asserting the empty-state text. Confirmed failing against the pre-fix template (both assertions failed), passing after.

- [x] 2.2 Check the shipped `worker.AGENTS.md.tmpl` (and the other shipped templates) against their renderer data for the same `{{#each}}`-over-a-string or missing-variable class of drift, and record the result in the ticket report. Result: the worker template is consistent. Two adjacent same-class gaps were found but are outside this ticket's scope and are reported for a follow-up — `charter.md.tmpl`'s header reads four fields `renderCharter` never supplies, and `brief.md.tmpl`'s `{{brief.noWorktree}}` is never supplied.

## 3. Verification and delivery

- [x] 3.1 `pnpm lint && pnpm typecheck` green.
- [x] 3.2 Run full `pnpm test` and paste both suite blocks verbatim. The UI suite is green; the core suite's only failures are the three pre-existing VS-241 archived-fixture failures (their test files are byte-identical to `main`), not this ticket.
- [x] 3.3 Commit with the ticket id, push, open the PR, record it as a work product, and transition to `in_review`. (PR #202)
