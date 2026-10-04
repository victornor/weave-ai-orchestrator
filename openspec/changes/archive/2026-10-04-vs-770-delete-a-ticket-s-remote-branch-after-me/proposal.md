## Why

Merged ticket branches pile up on the remote (548 in agent-conductor, 518 in fanflow): the daemon deletes the local worktree branch but never the remote one. Separately, there is no reproducible way to capture product screenshots for marketing: the real workspace holds real projects and data.

## What Changes

- After a ticket's PR is confirmed merged (the daemon's landing flow and the `merge_done` path), the daemon deletes the ticket's head branch on the remote and the local branch if it still exists. On by default; `policies.deleteBranchAfterMerge: false` turns it off per project, with a toggle in project Settings and an optional workspace default (`defaults.deleteBranchAfterMerge`).
- Guards: never the project's default or landing branch, never a branch another open PR uses as its head, never a branch whose head is not contained in the merge. A failed delete is logged and noted once on the ticket and never fails the landing.
- New `weave project prune-branches <project> [--dry-run]` for the existing backlog: lists remote branches whose ticket is done or cancelled and whose head is contained in the landing branch; deletes only without `--dry-run`.
- New demo mode (`weave demo`): a real daemon on its own config dir and port (refuses 7433 and the live config dir) seeded with a deterministic fake dataset, with agents, git, forge and network replaced by fakes/stubs and scripted live progress.
- New `pnpm demo:screenshots`: Playwright + headless Chromium walks an extensible manifest of routes/states at desktop and phone viewports, light and dark, and writes named PNGs. Docs for all of it.

## Capabilities

### New Capabilities
- `branch-cleanup`: remote/local ticket branch deletion after merge, its policy, guards, failure handling, and the backlog prune command.
- `demo-mode`: the seeded, offline demo daemon and the automated screenshot capture.

### Modified Capabilities
<!-- none: existing delivery/landing requirements are unchanged; cleanup is a new post-merge step -->

## Impact

- `packages/shared` (policy schema + `deleteBranchAfterMerge` helper, workspace default), `packages/plugin-sdk` (optional `ForgeAdapter.deleteBranch`/`listBranches`), `packages/core` (forge/gh, tickets/service mergeDone, a branch-cleanup module, project prune), `packages/server` (prune route, demo boot), `packages/cli` (`project prune-branches`, `demo`), `packages/ui` (Settings toggle), new demo seed + capture script, docs.
- No change for projects without a forge; existing branches are untouched unless the operator runs prune.
