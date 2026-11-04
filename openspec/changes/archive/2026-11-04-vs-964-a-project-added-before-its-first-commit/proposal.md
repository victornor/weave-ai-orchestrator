## Why

A project registered while its remote had no commits (VS-964, v-tg-content, 2026-11-03) showed `syncState: diverged` with a null synced head for about 25 minutes, started no worker, and then recovered by itself on the next scheduled fetch. Nothing said that waiting was correct, so the weaver filed a false incident and a human spent the time re-assigning a ticket that was never the problem. A clone of an empty remote has not diverged from anything; it has nothing.

## What Changes

- A new sync state `empty` (alongside `in_sync`, `behind`, `diverged`): the clone's remote has no commits yet. `projects.fetch` and `projects.checkSync` detect it (unborn HEAD and no `origin` refs after the fetch) and record/return it instead of attempting the checkout and fast-forward that used to fail into `diverged`.
- The state carries its own wording, "the remote has no commits yet; the clone will pick them up on the next fetch": returned as `message` by `GET /projects/:id/sync`, shown on the project page, and used by the curation freshness gate's block text.
- Giving a worker its worktree on an `empty` project runs one fetch first. If the first commit has landed the project becomes `in_sync` and the worker proceeds; if the remote is still empty nothing loops and the state stays `empty`. The hourly sweep is unchanged.
- Migration 0067 rebuilds `projects` so `sync_state`'s CHECK accepts `empty` (SQLite cannot alter a CHECK).
- Not changed: projects whose remotes have commits, project registration, the `diverged` handling and its VS-673 self-heal.

## Capabilities

### New Capabilities
- `project-sync-state`: the values of a project's sync state, what each means, and what the system does on `empty`.

### Modified Capabilities
<!-- none -->

## Impact

`packages/shared` (enum), `packages/db` (migration 0067), `packages/core` (projects service, workers service, run engine gate message, api type), `packages/ui` (project page, sync hook type). `docs/API.md` sync response gains `message`.
