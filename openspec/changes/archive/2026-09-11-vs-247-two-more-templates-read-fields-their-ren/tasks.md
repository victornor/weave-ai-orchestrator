# Tasks

## 1. Make the charter template and its renderer agree

- [x] 1.1 In `packages/core/src/prompts/index.ts`, have `renderCharter` supply `project.defaultBranch`, `project.deliveryMode` and `project.mergeMethod` from the project row looked up by `spec.project` (its `default_branch`, and `policies_json.deliveryMode`/`mergeMethod` with the same workspace-default fallbacks `workerData` uses), via a small `projectHeaders` helper both renderers share; change the header's project field in `templates/charter.md.tmpl` from the unsupplied `{{role.project}}` to `{{project.id}}`. Verify: rendering the shipped template for `api` prints `` `api` · default branch `main` · delivery `pr` · merge method `squash` ``.

## 2. Make the brief template and its renderer agree for a no-worktree ticket

- [x] 2.1 Add `noWorktree: boolean` to `WorkerTemplateData['brief']` and set it in `workerData` from `!agent.worktreePath` — the fact `spawn({ noWorktree: true })` writes. `brief.md.tmpl` is unchanged. Verify: rendering the shipped brief for a no-worktree worker selects the curation block and not the worktree-setup block, and an ordinary worker gets the inverse.

- [x] 2.2 Confirm the curation block's content is right for a no-worktree ticket against `skills/agent-conductor-knowledge/references/curation.md` (read-only `work/`, never write/commit/push, submit with `ac_knowledge_replace`) — not merely that the branch is selected.

## 3. Cover the shipped templates and report the class

- [x] 3.1 Add a shipped-template case to `packages/core/src/prompts/render.test.ts` rendering `charter.md.tmpl` with realistic data and asserting the header names the project, default branch, delivery mode and merge method. Confirmed failing against the pre-fix renderer.

- [x] 3.2 Add shipped-template cases rendering `brief.md.tmpl` for a no-worktree worker (curation block present, worktree-setup block absent) and for an ordinary worker (the inverse). Confirmed failing against the pre-fix renderer.

- [x] 3.3 Check the remaining shipped templates (`conductor.AGENTS.md.tmpl`, `worker.AGENTS.md.tmpl`, `brief.md.tmpl`, `charter.md.tmpl`) against their renderer data for the same missing-field / `{{#if}}`-on-an-unsupplied-flag class, and record the result in the ticket report.

## 4. Verification and delivery

- [x] 4.1 `pnpm lint && pnpm typecheck` green.
- [x] 4.2 Run full `pnpm test` and paste both suite blocks verbatim (core/server and UI, real totals, never summed).
- [x] 4.3 Commit with the ticket id, push, open the PR, record it as a work product, and transition to `in_review`.
