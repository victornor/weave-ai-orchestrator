## Why

Today every ticket lands as two commits: the squash-merged PR, then a `chore(openspec): archive <change>` commit the daemon pushes directly to `main` a minute later, in the primary clone, after `weave_ticket_merge_done`. That second commit was never reviewed, and its push is a direct write to a protected branch that fails silently (logged at `info`) if the branch rejects it — leaving the primary clone's `openspec/specs` permanently behind what actually landed. Worse, an archive failure surfaces only after the code has already merged (VS-293's `retire_capabilities` check is a partial, static mitigation for exactly this gap), by which point the ticket is stuck at `merging` with unarchived specs and no way to undo the merge.

## What Changes

- Move the OpenSpec archive out of the post-merge, daemon-in-primary-clone step and into the merge itself, so a ticket lands as **one** commit containing the code, the merged `openspec/specs/**`, and the moved `openspec/changes/archive/<date>-<change>` folder.
- **BREAKING (internal contract):** the actual PR merge (`gh pr merge`) moves from the worker to the daemon. The worker's merge turn now ends at "branch synced, tested, pushed" and calls `weave_ticket_merge_done` to *request* landing; the daemon archives the change onto the ticket's own branch, pushes that branch, performs the merge with the project's `mergeMethod`, verifies it landed, and only then marks the ticket `done`. The worker never runs `openspec archive` (unchanged) and, under this change, never runs `gh pr merge` either.
- The whole sequence (freshness check against the current landing branch → archive on the ticket's branch → push → merge → verify → fast-forward the primary clone) runs inside one project-scoped critical section, so two tickets touching the same capability spec still land correctly back to back regardless of the project's `mergeConcurrency` setting (1–8 today) — not only when it is 1.
- An archive failure, or a branch that turns out to be behind the landing branch by the time the daemon acts on it, now rejects `weave_ticket_merge_done` outright: no merge happens, the ticket stays out of `done`, and the worker is told to re-sync and retry — the same shape as a rebase conflict it already knows how to handle.
- The daemon stops pushing directly to a project's landing/default branch for archiving. `packages/core/src/forge/gh.ts`'s existing, currently-unused `GhForge.mergePr` becomes the production path for the actual merge.
- The reconciliation sweep that backfills an archive left behind by a ticket merged before this change ships no longer pushes a commit straight to the landing branch either: it opens a small pull request carrying just the archive commit (or, if it cannot, files an incident/ticket comment) — never a silent `info`-only failure.

## Capabilities

### New Capabilities
- `ticket-delivery/archive-before-merge`: the atomic sequence that archives a ticket's OpenSpec change onto its own branch and performs the merge, as one project-serialized operation triggered by `weave_ticket_merge_done`, replacing the worker-driven `gh pr merge` step.

### Modified Capabilities
- `ticket-delivery/openspec-archival`: narrows to the backfill/reconciliation path only (a change left behind by a ticket that merged before this shipped, or whose merge predates the daemon owning the merge step); adds the requirement that reconciliation never pushes directly to a protected branch.
- `ticket-delivery/landing-verification`: the "OpenSpec archives on the landing branch" scenario and the "one landing at a time per project" requirement are amended to describe archiving as part of that same serialized landing operation, not a step that runs after it on the primary clone.
- `ticket-delivery/merge-queue`: the requirement that "the merging worker is told it holds the queue" is amended — the worker still syncs, resolves conflicts and re-runs checks before landing, but no longer performs the merge itself; it requests landing and the daemon executes archive-then-merge.

## Impact

- `packages/core/src/tickets/service.ts` (`mergeDone`, ~line 1070-1163): now performs archive-then-merge itself instead of verifying an already-completed forge merge and archiving afterward.
- `packages/core/src/openspec/index.ts` (`archiveAfterMerge`, `commitArchive`): the direct-push `commitArchive` path is retired for the new flow; `archiveAfterMerge` is repurposed for the backfill/reconciliation path only, gaining a PR-based (not push-based) landing route.
- `packages/core/src/forge/gh.ts` (`GhForge.mergePr`): goes from test-only to a real production call site.
- `packages/core/src/tickets/merge-queue.ts`: the per-project serialization that already exists for archive (`openspec/index.ts`'s `createSerializer()`) and for landing (`tickets/service.ts`'s own instance) is unified into the one critical section this change relies on for correctness.
- `packages/core/src/supervisor/index.ts` (`reconcileOpenSpecArchives`): switches from direct push to opening a PR (or reporting) for legacy unarchived changes.
- `skills/weave-ai-worker/references/delivery.md` and `skills/weave-ai-openspec` (`SKILL.md`, `references/openspec-cli.md`): the merge procedure's steps 5, 8 and 9 change — no worker-run `gh pr merge`; `weave_ticket_merge_done` now requests landing rather than confirms a completed one.
- Tests: `packages/core/src/openspec/service.test.ts`, `packages/core/src/tickets/merge-done.test.ts`, `packages/core/src/tickets/merge-queue.test.ts`, `packages/core/src/supervisor/supervisor.test.ts` all assert the old ordering and need corresponding coverage for the new one.
