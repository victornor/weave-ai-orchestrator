# Tasks — VS-359

## 1. Persisted switch state

- [x] 1.1 Add migration `packages/db/src/migrations/0038_project_knowledge_switch.sql`: `ALTER TABLE projects ADD COLUMN knowledge_switch_json TEXT`. Add `knowledgeSwitch: { direction: 'on' | 'off'; branch: string; prUrl: string; startedAt: string } | null` to `Project` (`packages/shared/src/types.ts`). Verify the existing migration-runner test (or a dedicated one) applies it against a fresh and an already-migrated database, and that a project row reads `knowledgeSwitch: null` when unset.
- [x] 1.2 Confirm `camel()` (`packages/db/src/db.ts`) decodes `knowledge_switch_json` into `knowledgeSwitch` on its own (the `*_json` rule), adding a `projects` service test only if the decode needs `projectRow` (`packages/db/src/repos.ts`) to coerce it.

## 2. The switch module (`packages/core/src/knowledge/repoSwitch.ts`)

- [x] 2.1 Implement `startKnowledgeRepoSwitch(actor, project, direction)` and `applyKnowledgeRepoSwitch(project, enabled)` per design Decisions 1–2 and 4. On enable, rewrite `.weave/knowledge` in a scratch worktree from `<ctx.paths.knowledge>/projects/<slug>/**`, mapping every path through `repoKnowledgePath()`; on disable, remove it. Cut/reuse branch `ac/knowledge-<slug>-on|off`, rebase if stale, commit, push, open or reuse the PR via `createPullRequest`/`pullRequestForBranch`, and write `knowledge_switch_json`. A no-diff case applies the flag directly with no PR; a missing forge that cannot open a PR throws and leaves the flag and record untouched.
- [x] 2.2 Tests (`repoSwitch.test.ts`) against temporary git repos and a fake forge, following `repoDelivery.test.ts`: enabling a project with a hub file, a foldered document and an archive file opens exactly one PR whose diff is only that project's `.weave/knowledge/` tree and leaves the flag off; disabling opens one PR removing the tree and leaves the workspace copy intact; a closed-then-retried switch reuses the branch and opens no second PR; the no-diff enable/disable case applies the flag with no PR; an unroutable forge leaves the flag off with no pending record.
- [x] 2.3 Boundary coverage: attempting to write a workspace-scope file, the shared file, the decisions log, and a foreign project's file through the enable copy is refused by `repoKnowledgePath` before anything reaches disk.

## 3. Projects service

- [x] 3.1 In `packages/core/src/projects/index.ts`, route `update`'s `knowledgeRepo.enabled` change for a `ready` project through `startKnowledgeRepoSwitch` (refusing with `conflict` when a switch is pending), persisting every other merged field normally while leaving the flag and its config block at their current value; leave the no-clone/creation direct write as-is. Add `applyKnowledgeRepoSwitch(project, enabled)` writing both the row and `workspace.yaml` (`upsertConfigBlock`). Add `repoInfo(id)` and `repoInfoForUrl(url)` reading the optional forge capability, returning `null` rather than throwing.
- [x] 3.2 Tests: flipping `knowledgeRepo.enabled` on a ready project with a fake forge starts a switch and does not change the flag; a second flip while pending is refused; the flag change on a project with no clone still writes directly; `applyKnowledgeRepoSwitch` updates both the row and the config block; `repoInfo`/`repoInfoForUrl` return the forge's answer and `null` when absent.

## 4. Supervisor reconcile step

- [x] 4.1 Add `reconcileKnowledgeRepoSwitches(projects)` to `packages/core/src/supervisor/index.ts` and call it from `reconcilePass()` after `reconcileOpenSpecArchives`: `prState` each pending switch; merged → `applyKnowledgeRepoSwitch` from the direction and best-effort `projects.fetch`; closed → clear the record; open → leave. A `prState` failure logs and skips the project.
- [x] 4.2 Supervisor test: a merged enabling PR flips the flag and clears the record; a merged disabling PR clears the flag; a closed PR clears the record without changing the flag; an open PR changes nothing.

## 5. Forge visibility capability

- [x] 5.1 Add `repoInfo?(cwd: string, remote?: string): Promise<{ private: boolean } | null>` to `ForgeAdapter` (`packages/plugin-sdk/src/index.ts`) with a doc comment following the existing optional-capability style.
- [x] 5.2 Implement it in `GhForge` (`packages/core/src/forge/gh.ts`) via `gh repo view [remote] --json visibility`, with an exported pure `repoVisibilityFromGh` mapping `PRIVATE`/`INTERNAL` → `{ private: true }`, `PUBLIC` → `{ private: false }`, anything else → `null`. Tests in `gh.test.ts` assert the pure mapping and, through the existing fake `gh`, the exact argv and a non-zero-exit → `null`; no live GitHub.

## 6. Routes and API docs

- [x] 6.1 Add `GET /projects/repo-info?url=` (registered before `GET /:id`) and `GET /projects/:id/repo-info` to `packages/server/src/routes/projects.ts`, returning `{ private: boolean } | null`. Cover them in the project route tests.
- [x] 6.2 Document both routes in `docs/API.md`, next to the other project routes.

## 7. Settings UI (`packages/ui/src/routes/Settings.tsx`)

- [x] 7.1 `ActiveProjectRow`: when `p.knowledgeSwitch` is set, replace the select with a "Waiting for the pull request to merge" status, a link to `prUrl`, and a "close the pull request to cancel" hint, and disable the control. When it is not set and the human selects `on`, query `GET /projects/:id/repo-info` first and, on a public answer, show an inline warning with an explicit confirm before PATCHing; a private or `null` answer PATCHes immediately.
- [x] 7.2 `ProjectsSection` create form: on checking the knowledge-repo box, query `GET /projects/repo-info?url=` and show a warning under the checkbox when the repository is public; the Add button remains the confirmation and nothing is queried while the box is unchecked.
- [x] 7.3 UI tests: a public answer on the existing-project toggle shows the warning and only the confirm issues the PATCH; a private/`null` answer PATCHes without the warning; a pending switch renders the waiting state with the PR link and no select; the create-form warning appears only for a public answer.

## 8. Verification

- [x] 8.1 `pnpm lint` and `pnpm typecheck` green.
- [x] 8.2 `pnpm test` green, and paste **both** suite blocks verbatim (core/server and UI) in the PR/report — never one block labelled as both, never an added-together figure.
