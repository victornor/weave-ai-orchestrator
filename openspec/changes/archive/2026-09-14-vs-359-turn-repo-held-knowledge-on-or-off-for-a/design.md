# Design — VS-359

## Context

VS-358 (merged) added `knowledgeRepo.enabled` (off by default), the write paths that mirror a worker's / weaver's knowledge into `.weave/knowledge/`, and merge-time reconciliation. It deliberately left two things out: moving an existing project's knowledge across that boundary, and warning when the destination repository is public. Both are follow-ups named by captain's VS-355 decision (Q6, Q8).

The primitives this builds on, all on `origin/main`:

- `scratchLandWorktree` / `scratchBranchFrom` / `isFreshAgainstLanding` / `rebaseOntoLanding` (`packages/core/src/tickets/archive-before-merge.ts`) — throwaway detached worktrees of the project clone, rebase and conflict reporting.
- `ForgeAdapter.createPullRequest?` / `pullRequestForBranch?` / `prState` (`packages/plugin-sdk/src/index.ts`), implemented by `GhForge`.
- `repoKnowledgePath()` (`packages/core/src/knowledge/files.ts`) — the single boundary check mapping `projects/<slug>/**` to `.weave/knowledge/**`.
- The supervisor's `reconcilePass()` (`packages/core/src/supervisor/index.ts:696`), which fetches every ready project's clone and polls forge state for `in_review` PRs — the natural home for a periodic switch check.
- `projects.update()` (`packages/core/src/projects/index.ts:311`), which today writes `knowledgeRepoEnabled` straight from the patch.

## Goals / Non-Goals

- **Goal**: turning the opt-in on or off for an existing project is a reviewed pull request, and only its merge changes the setting.
- **Goal**: the daemon learns a pending switch's outcome with no ticket and no live worker — a supervisor reconcile step reads the PR state.
- **Goal**: a public repository is surfaced to the human before they confirm, advisory only.
- **Non-goal**: changing VS-358's write paths, sync, or the shape of `.weave/knowledge/`.
- **Non-goal**: migrating artifacts as files.
- **Non-goal**: a warning anywhere other than the two enable interactions (creation checkbox, existing-project toggle).

## Decisions

### 1. A pending switch is a `projects` column, reconciled by the supervisor

A switch that opens a pull request must be remembered across daemon restarts, exposed to the UI, and resolved later with no caller waiting. Add `knowledge_switch_json TEXT` to `projects` (migration `0038`, nullable), mapped by the existing `*_json` decoding in `packages/db/src/db.ts` to `Project.knowledgeSwitch: { direction: 'on' | 'off'; branch: string; prUrl: string; startedAt: string } | null`.

Alternatives considered:
- **A dedicated `knowledge_repo_switches` table.** More rows, more joins; there is at most one pending switch per project, and the setting it drives already lives on the project row.
- **Model the switch as a ticket.** A ticket would give a review/merge path for free, but the work is a mechanical file copy with no reasoning for a coding CLI to do; spawning a worker to run it is waste, and "the flag flips when the PR merges" would then be entangled with ticket status. The daemon-managed record matches how out-of-ticket knowledge edits already flow (VS-358's `requestKnowledgeRepoPr`).

Resolution is a new `reconcileKnowledgeRepoSwitches(projects)` call inside `reconcilePass()`, right after `reconcileOpenSpecArchives`. For each project with `knowledgeSwitch` and a clone, `forge.prState(clonePath, prUrl)`:

- `merged` → set `knowledgeRepoEnabled` from `knowledgeSwitch.direction`, clear the switch, best-effort `projects.fetch` so the primary clone reflects the landed tree. No workspace reconciliation (see Decision 4).
- `closed` → clear the switch, leave the flag.
- `open` → leave.

`reconcilePass` already runs on `RECONCILE_EVERY_MS`; no new timer. This is also the cancel mechanism: closing the PR is noticed on the next pass.

### 2. Enable copies out, disable removes — one branch per direction, always exactly one PR

`startKnowledgeRepoSwitch(actor, project, direction)` (`packages/core/src/knowledge/repoSwitch.ts`):

- Branch `ac/knowledge-<slug>-on` or `ac/knowledge-<slug>-off` (direction-specific, so a stale closed-PR branch from the opposite direction can never carry content into the new one).
- If the pending record already exists → `conflict` (enforced in `update`, Decision 5).
- If the remote branch exists with an open PR → that is the pending switch; the record is (re)written to it. Otherwise a scratch worktree is cut from `origin/<landing>` (or reused detached at `origin/<branch>`, rebased onto landing, if only the branch survives), the `.weave/knowledge` tree is rewritten to the desired state, committed, pushed, and a PR opened.
- **Enable**: `rm -rf .weave/knowledge` in the scratch tree, then copy every file under `<workspace>/knowledge/projects/<slug>/` to `.weave/knowledge/<repoRelPath>` — path resolved only through `repoKnowledgePath()`, so nothing outside that project's scope can ever be written. `archive/**` is copied as well, per the ticket.
- **Disable**: `rm -rf .weave/knowledge`.
- Commit message `chore(knowledge): <slug> knowledge <verb> through the repo`; PR base is `landingBranchOf(project)`, title names the project, body states the direction and that closing the PR cancels it.
- **No-diff case**: if the desired tree equals what the branch already holds (nothing staged to commit), there is nothing to review — the flag is applied directly through `applyKnowledgeRepoSwitch`, no PR, no pending record. In practice an enable of a non-empty project always differs (the repo has no `.weave/knowledge`), and a disable of a repo without one always takes this path.
- **No forge able to open a PR** (`createPullRequest` absent) → throw; the flag is unchanged and no record is written (spec: a refused switch leaves the setting as it was).

`applyKnowledgeRepoSwitch(project, enabled)` is one small `projects` method that writes the DB column **and** the `workspace.yaml` config block (`upsertConfigBlock`) together, so the row and the declared config never disagree. `update`'s normal write path and the supervisor both call it.

"Open it as a normal PR with the project's delivery mode": read literally, a `local-branch`-delivery project has no PR. The acceptance criteria, however, require exactly one PR unconditionally, and the stated purpose is that captain reviews what enters the repo — a review that a direct commit cannot give. The switch therefore always opens a PR on the project's forge and landing branch; `policies.deliveryMode`/`mergeMethod` do not gate it. This is the one judgment call in the ticket; recorded here so a reviewer can overturn it cheaply.

### 3. `repoInfo?(cwd, remote?)` — optional capability, gh-backed, pure-mapped

Signature in `packages/plugin-sdk/src/index.ts`, alongside `createPullRequest?`/`pullRequestForBranch?`:

```ts
/** Optional (VS-359): whether a repository is public, or null when the forge cannot say. */
repoInfo?(cwd: string, remote?: string): Promise<{ private: boolean } | null>;
```

`remote` is optional and, when omitted, means "the repository at `cwd`'s origin". The creation form has no clone yet, so the URL form is required; `GhForge` runs `gh repo view [remote] --json visibility` in `cwd` (the clone, or the workspace root for the URL case) and maps `PRIVATE`/`INTERNAL` → `{ private: true }`, `PUBLIC` → `{ private: false }`, anything else (including a failed command) → `null`. The JSON→result mapping and the argv are pure/exported and unit-tested against a fake `gh`, exactly like the existing `gh.test.ts` — no live GitHub.

Read surface (`ProjectsService`): `repoInfo(id)` for an existing project (`cwd = clonePath`), and `repoInfoForUrl(url)` for the create form (`cwd = ctx.paths.root, remote = url`). Both return `{ private: boolean } | null` and never throw on an unanswerable forge.

### 4. The switch merge is not reconciled into the workspace

VS-358's `reconcileProjectKnowledgeFromRepo` is keyed to a *ticket's* landing and refuses to apply a document whose path has no revision by the landing ticket. A daemon-managed switch PR is not a ticket, so reconciliation would either be a no-op or, for a disable, risk deleting workspace files. Neither is wanted: on enable the workspace tree is the source that was copied, so it already equals the landed content; on disable the workspace copy is intentionally kept. The switch reconcile therefore only flips the flag and fast-forwards the clone — it never calls `knowledge.replace`/`putDoc`/`deleteDoc`.

### 5. `update` routes a flag change, and refuses a second switch

`projects.update` gains one branch before the normal write:

- If `patch.knowledgeRepo?.enabled` is present and differs from `project.knowledgeRepoEnabled` and the project is `ready` with a clone: if a switch is already pending → `conflict`; else `await startKnowledgeRepoSwitch(actor, project, direction)`, and persist every *other* merged field as today while leaving `knowledgeRepoEnabled` at its current value and writing the unchanged flag to the config block. The returned project carries the new `knowledgeSwitch`.
- Otherwise (no clone yet, e.g. a project still `cloning`/`error`, or a non-flag patch) the existing direct write stands, so VS-358's tests for `update` flipping the flag stay meaningful for a not-yet-cloned project and the creation path is untouched.

### 6. Routes and UI

Routes (`packages/server/src/routes/projects.ts`; documented in `docs/API.md`):

- `GET /projects/repo-info?url=<git url>` → `{ private: boolean } | null`. Registered **before** `GET /:id` so the literal segment wins.
- `GET /projects/:id/repo-info` → `{ private: boolean } | null`.

UI (`packages/ui/src/routes/Settings.tsx`; V2's Settings → Projects renders this same `ProjectsSection`, so one change covers both):

- `ActiveProjectRow`: when `p.knowledgeSwitch` is set, replace the select with a status line — "Waiting for the pull request to merge" + link to `prUrl` + "close the pull request to cancel" — and disable the control. When it is not set and the human selects `on`, first `GET /projects/:id/repo-info`; if `private === false`, show an inline warning with an explicit **Turn on anyway** confirm; a private or `null` answer PATCHes immediately.
- `ProjectsSection` create form: on checking the box, query `GET /projects/repo-info?url=`; if public, render the warning under the checkbox. The Add button is the confirmation. Nothing is queried while the box is unchecked, so an ordinary add does not pay for a `gh` call.

## Risks / Trade-offs

- **[The daemon opens a PR for a `local-branch` project, contradicting the literal "delivery mode" wording]** → Decided above (Decision 2) on the acceptance criteria's "exactly one PR"; called out in the PR body so a reviewer can reverse it.
- **[A switch PR is merged directly on the forge while the daemon is down]** → The record persists; the first reconcile pass after boot flips the flag. No loss.
- **[Two humans race two switch requests]** → `update` refuses while a record exists; the scratch machinery refuses/serializes on the branch.
- **[`gh repo view` is unreachable or unauthenticated at switch time]** → the warning is advisory and the switch does not depend on it; the answer is `null` and no warning appears.
- **[A closed switch PR leaves its remote branch]** → harmless; the next same-direction switch reuses it and rewrites the tree, the opposite direction has its own branch name.
- **[Copying a large `archive/` tree]** → bounded by a project's own knowledge, which is small by budget; the copy is one commit on a scratch worktree and does not run in the request if it fails validation early.

## Migration Plan

1. Migration `0038_project_knowledge_switch.sql` adds the nullable column; existing projects read `knowledgeSwitch: null`, and every VS-358 behavior is unchanged.
2. No data backfill: a project that was already enabled has no `.weave/knowledge/` migration to run and keeps working; only a future toggle starts a switch.
3. Rollback: the column is additive and unread by VS-358 code paths, so reverting the release leaves the flag wherever it was; a leftover open switch PR can be closed by hand.

## Open Questions

- None. The two judgment calls (always a PR; no workspace reconciliation on switch merge) are resolved above rather than deferred, because either would change the specs or the task breakdown.
