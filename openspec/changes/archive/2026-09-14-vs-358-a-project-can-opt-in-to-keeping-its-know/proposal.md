## Why

Every project's knowledge lives only on the daemon host's workspace filesystem (`knowledge/projects/<id>/**`), never in the project's own git repo — there is no review, no `git blame`, and no durable trail a human can read outside the daemon. VS-355 scouted a hybrid design captain accepted (2026-09-13): a project can opt in to also committing its knowledge into its own repo, with a worker's writes riding its ticket's own PR and the workspace copy staying what every existing feature reads.

## What Changes

- Add `knowledgeRepo: { enabled: boolean }` (default `false`) to `ProjectConfigSchema`, the same idiom as `openspec.enabled`: a dedicated `projects.knowledge_repo_enabled` column, wired through project creation and the project PATCH route. Off (today's behavior) is unchanged and covered by the existing knowledge test suite running unmodified.
- `weave_knowledge_note` gets the same secret-shaped-content refusal `weave_knowledge_doc_put` already has, for every project — a prerequisite before any note can target a repo, not gated on opt-in.
- For an opted-in project, a worker's `weave_knowledge_note`/`weave_knowledge_doc_put`/`weave_knowledge_replace` call for its own project also writes the resulting file into its worktree at `.weave/knowledge/…`, committed with the ticket's other changes; the existing workspace-side write and its `knowledge_revisions` row are unchanged. A hard path-prefix check ensures only `knowledge/projects/<thatProjectId>/**` can ever reach a repo this way — `WORKSPACE.md`, `SHARED.md`, `decisions.md` and any other project's files never do.
- An opted-in project's curation worker gets a real worktree and branch (instead of today's read-only, worktree-less spawn) and delivers its `weave_knowledge_replace` through the project's normal PR/`merge_approval` flow. A weaver's out-of-ticket write (e.g. editing "Current focus") to an opted-in project goes through a daemon-managed scratch-branch commit and pull request, reusing the primitives `archive-before-merge.ts` already built for OpenSpec archive backfill — never a silent direct push.
- When a ticket's delivery lands and the project's primary clone fast-forwards, the daemon reconciles that project's `.weave/knowledge/**` (if the project is opted in) into the workspace-side `knowledge/projects/<id>/**` copy: updates/creates/removes files to match what actually landed, records a revision with a merge actor, and reindexes — so a resolved merge conflict or a hand-edited file in the repo is what the workspace copy, search, budgets and curation end up seeing.
- V1 Settings: a checkbox on project creation and a toggle on the project's row in Settings → Projects, both off by default, with a one-line note that knowledge will be committed to the repo. (V2 has no project-settings surface yet — nothing to add there.)
- Document the `.weave/knowledge/` repo folder in `docs/PLAN.md` §5, next to the workspace state directory `.weave/`, naming the two apart.

Out of scope (follow-up tickets per captain's decision): turning the option on/off for a project that already has knowledge (the copy-in/copy-out PR), a public-repo warning, and artifacts-as-files.

## Capabilities

### New Capabilities
- `knowledge-repo/opt-in`: the `knowledgeRepo.enabled` project config flag, default off, and that an opted-out project's behavior is unchanged.
- `knowledge-repo/note-secret-refusal`: `weave_knowledge_note` refuses secret-shaped content, in every project.
- `knowledge-repo/worker-write-path`: a worker's project-scoped knowledge write for an opted-in project also lands in its worktree, to be committed and reviewed with the ticket's other changes.
- `knowledge-repo/curation-and-weaver-write-path`: an opted-in project's curation worker gets a worktree and normal delivery; a weaver's out-of-ticket write to an opted-in project goes through a daemon-managed branch and pull request.
- `knowledge-repo/merge-sync`: the workspace-side knowledge copy is reconciled from the landed repo state whenever an opted-in project's ticket lands.
- `knowledge-repo/repo-write-boundary`: only a project's own `knowledge/projects/<projectId>/**` can ever be written into a repo; workspace-scope files and other projects' files never are.
- `knowledge-repo/settings-ui`: the V1 opt-in checkbox and per-project toggle.

### Modified Capabilities
(none — every changed requirement here is new behavior gated on a new, default-off flag; nothing existing changes shape.)

## Impact

- `packages/shared/src/config.ts` (`ProjectConfigSchema`), `packages/shared/src/enums.ts` (`KnowledgeRevisionReason`), `packages/shared/src/types.ts` (`Project`).
- `packages/db/src/migrations/0036_*.sql` (new `projects.knowledge_repo_enabled` column), `packages/db/src/repos.ts` (`projectRow`).
- `packages/core/src/projects/index.ts` (`createRow`, `update`, `configFor`).
- `packages/core/src/knowledge/service.ts` (`note`'s secret check; `note`/`putDoc`/`replace` gain an optional worktree-mirror write funnelled through `write()`), `packages/core/src/knowledge/files.ts` (a repo-relative-path helper, path-prefix guard).
- `packages/server/src/tools.ts` (`weave_knowledge_note`/`weave_knowledge_doc_put`/`weave_knowledge_replace` handlers pass the mirror target when the caller is a worker in its own opted-in project's worktree).
- `packages/core/src/workers/index.ts` (`spawnCurator`: a real worktree for an opted-in project).
- `packages/core/src/tickets/service.ts` (`mergeDone`: reconcile `.weave/knowledge/**` after `landDelivery` succeeds, inside the existing per-project critical section).
- `packages/core/src/tickets/archive-before-merge.ts` (reused scratch-worktree primitives for the weaver's out-of-ticket commit+PR — a new sibling function, not a change to the existing archive sequence).
- `packages/ui/src/routes/Settings.tsx` (`ProjectsSection`, `ActiveProjectRow`).
- `docs/PLAN.md` §5.
- Tests: `packages/core/src/knowledge/knowledge.test.ts` (secret refusal on `note`, opted-in mirror write, path-prefix guard), `packages/core/src/tickets/merge-done*.test.ts` (sync-on-merge), `packages/core/src/workers/*.test.ts` (curator worktree), `packages/core/src/projects/*.test.ts` (config plumbing), `packages/ui` route tests. All using temporary git repos, never the live daemon.
