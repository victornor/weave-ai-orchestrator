## Context

Local worktree branches are removed with their worktrees; the remote ticket branch is not, and the repo's `delete_branch_on_merge` is off. The merge lands through `mergeDone` in `packages/core/src/tickets/service.ts` (forge `mergePr`, or an out-of-band merge trusted via `prState`), inside a per-project serialized section. Policies are a zod schema in `packages/shared/src/config.ts` with per-key helpers, surfaced in `packages/ui/src/settings/sections.tsx`. The UI is a Vite app talking to ~140 daemon endpoints; the DB has ~135 tables.

## Decisions

### D1 Branch cleanup runs after the landing, outside the serialized section
After `mergeDone` has recorded `done` (so a failure cannot affect it), a `branchCleanup` function is invoked in a try/catch; any error becomes one system comment plus a log line. It is skipped for `local-branch` delivery (no remote branch) and when the policy is off.

### D2 Deletion through the forge adapter, with git-level guards
`ForgeAdapter` gains optional `deleteBranch(cwd, branch)`; listing uses `git ls-remote`; gh implements them with `gh api -X DELETE repos/{owner}/{repo}/git/refs/heads/<branch>` (a 404/422 "already gone" is success). Rather than `gh pr merge --delete-branch`, which also touches the local checkout of the primary clone, we delete by ref so nothing writes into the shared clone. Containment (squash-aware, per captain's correction): the forge says the PR is **merged** and the remote branch head equals the PR's head at merge (`headSha` from `prState`), so nothing was pushed after; being an ancestor of the landing branch is an additional accepting case for merge-commit projects. Plain ancestry alone would delete almost nothing under squash merges. Guards, in order: name is not the default/landing branch; no *other* open PR has it as head; remote head SHA (from `git ls-remote`/the forge) equals the merged PR head or is an ancestor of the landing branch. Any guard failure keeps the branch and notes why once. The local branch is deleted with `git branch -D` only if it exists and is not checked out in the clone.

### D3 Policy
`deleteBranchAfterMerge: z.boolean()` in `ProjectPoliciesSchema`, resolved by `deleteBranchAfterMergeEnabled(policies, workspaceDefault)`: project value wins, then `defaults.deleteBranchAfterMerge`, then true. An absent or malformed value yields the default (on), unlike YOLO the safe direction is the default. Settings shows a toggle next to the existing boolean policies (inherit/on/off pattern of `requireCi`).

### D4 Prune command
`POST /projects/:id/prune-branches {dryRun}` in the server; the CLI adds `weave project prune-branches <project> [--dry-run]`. Candidates = remote branches (one `git ls-remote --heads origin`) matching a ticket's recorded branch where the ticket is done/cancelled, minus the same guards, plus the same containment rule as D2. Same code as D2 so rules cannot diverge. No automatic run; the operator runs it.

### D5 Demo mode: the real daemon, seeded, with side effects disabled
Alternatives: (a) a mock HTTP server answering every endpoint from hand-written fixtures; (b) the real daemon over a seeded DB. We choose (b): the real presenters and routes render the data, so the demo cannot drift from the product, and write actions in the UI keep working. Cost: seeding by SQL against the real schema.

- `weave demo [--port N] [--dir D] [--seed S]` starts the server in `demo` mode: `--config-dir` defaults to a temp dir, 7433 and the live config dir are refused.
- Demo boot skips the dispatcher, supervisor, channels, webhooks, push, upgrade/update checks and git/forge reconciliation, and registers a fake forge and fake runtime adapters. Project clone paths in the seed point at an empty dir; nothing runs git.
- The seeder (`packages/demo`) inserts through the DB layer with a fixed clock (`2026-03-02T09:00:00Z` base, all timestamps derived from offsets) and ids derived from stable labels, so two seeds into empty DBs are byte-identical (tested by dumping tables).
- Live views: a scripted event player in the server emits run/trace events on a loop over the existing SSE channels; the fake runtime adapter exposes the same script for run streams.
- Screenshots: `pnpm demo:screenshots` (script `scripts/demo-screenshots.mjs`) boots a demo daemon on a free port with the built UI, drives headless Chromium through `playwright-core` (a new devDependency, using the installed Chromium or Playwright's cache), loops over `demo/manifest.ts` entries x {desktop 1440x900, phone 390x844} x {light, dark} and writes `<name>--<viewport>--<theme>.png`. It stops the daemon by its recorded PID. Per entry: path, optional ready selector, optional setup steps. A test loads every manifest route and fails on console/page errors.

### Risks
- The seed couples to the schema; a migration test that seeds into a freshly migrated DB catches breakage.
- Some views (connection banner states) need the page to simulate a failed stream; the manifest supports an `init` hook injecting a route-level stub for those.

## Open points
- Branch deletion for `local-branch` delivery is out of scope (no remote).
