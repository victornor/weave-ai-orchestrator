## Why

VS-255's automatic curation of fernwood's knowledge base removed real facts as "contradicted":

```
local HEAD:  e19946d8  2026-09-08
origin/main: d8bd27ba  2026-09-10
```

The paths it said were missing (`docs/backup-and-restore.md`, `ops/backup/*`) exist on current
`origin/main`. The clone the curator fact-checked against was two days behind — not diverged, just
never fetched before curation ran — and the curator removed entries on the strength of that stale
read. The removal itself came from following the curation procedure correctly; the checkout it was
told to trust was the thing that was wrong.

This is structural, not a one-off mistake. `spawnCurator` (`packages/core/src/workers/index.ts:219`)
spawns every curation ticket with `noWorktree: true`. Two gaps compound:

1. **Nothing fetches the primary clone before or during a curation turn.** The clone is only ever
   brought current by the hourly `reconcilePass` sweep (`packages/core/src/supervisor/index.ts:676`),
   and that sweep already has a known silent-failure mode (VS-131): when the clone has diverged and
   `git merge --ff-only` fails, it logs a warning and moves on. A curation turn can start at any point
   in that up-to-an-hour (or longer, if the sweep is failing) staleness window with no check at all.
2. **There is no real, discoverable checkout for a `noWorktree` agent.** `TurnInput.worktree` — the
   only thing that grants `--add-dir` filesystem access (`packages/runtimes/claude/src/args.ts:116`,
   `packages/runtimes/gemini/src/args.ts`) — is populated only from `agent.worktreePath`
   (`packages/core/src/runs/engine.ts:340`), which is always `null` when `noWorktree` was set. The
   brief and `curation.md` both assert "`work/` is a read-only checkout" as if it were real; nothing
   backs that claim. VS-255's worker had to guess the primary clone's actual location
   (`projects/fernwood`) itself, because the daemon never told it — and the same lack of a structural
   pointer means a future curator could just as easily read the wrong thing, or nothing at all.

The curation procedure (`skills/agent-conductor-knowledge/references/curation.md`) says "never add a
fact"; it says nothing about what to do when a fact can't be checked. Deleting a true fact because the
evidence used to check it was stale is the mirror image of inventing one, and today nothing — neither
the environment nor the instructions — prevents it.

## What Changes

- **A curation turn cannot run against unverified evidence.** Before a curation agent's turn executes
  (`packages/core/src/runs/engine.ts`, the same place `model_unconfigured` already short-circuits a
  turn before it starts), the daemon fetches the project's primary clone and fast-forwards it to
  `origin/<landingBranch>` (reusing `ProjectsService.fetch`, already used by the reconcile sweep). If
  that succeeds, the turn runs as normal. If it does not — fetch fails (offline, auth) or the clone has
  diverged and cannot be fast-forwarded — the turn does not run: the daemon records the failure and
  transitions the ticket to `blocked` with a routable `{owner: "conductor", action}`, naming what
  failed. This runs on every turn a curation ticket takes, not only its first, so a relaunch or a
  multi-turn run is covered the same way. Nothing here is a rule the worker has to remember or a check
  it could skip — the turn is never handed to it.
- **The checkout the curator is told to fact-check against is now the one just verified.** The brief's
  `work/` reference for a `noWorktree` curation ticket resolves to the project's primary clone's real
  absolute path (rather than the literal, un-backed string `work/`), and states the moment the daemon
  just confirmed it matches `origin/<landingBranch>` (`Project.lastFetchedAt`, refreshed by the same
  fetch). The worker no longer has to guess where its evidence lives or take it on faith that it is
  current.
- **The curation procedure says what to do when a fact can't be checked either way.** `curation.md`'s
  "remove what is contradicted" step gets a explicit converse: a fact that cannot be positively
  verified false is left alone and reported in the ticket comment, not removed. This is instructional,
  layered on top of the structural fix above — the structural fix is what makes "the checkout might be
  stale" stop being a live possibility during a turn; this covers the separate, narrower case of a
  worker that cannot resolve one specific claim even against a checkout it does trust (an ambiguous
  path, a renamed script it can't otherwise place).

## Capabilities

### New Capabilities

- `knowledge/curation-freshness`: a curation turn may only run once the primary clone is verified
  current against the project's landing branch; when it cannot be, the turn does not run and the
  ticket is blocked with a routable reason instead of proceeding.

### Modified Capabilities

(none — `knowledge/scheduled-curation` governs when a curation run is asked for, not what a curation
turn is allowed to do once it starts; this change adds an independent precondition on the turn itself.)

## Impact

- `packages/core/src/runs/engine.ts` — a new pre-turn freshness gate for curation-originated tickets,
  mirroring the existing `model_unconfigured` early-exit shape; extends the `TurnInput.worktree`
  population to give a curation turn a real, verified read path.
- `packages/core/src/prompts/index.ts` — `workerData()`'s `worktree.path` fallback for a `noWorktree`
  curation ticket becomes the project's real clone path instead of the literal string `work/`; a new
  field carries the verified-fresh timestamp into the brief.
- `templates/brief.md.tmpl` — states the real path and the verification moment instead of an unbacked
  claim.
- `skills/agent-conductor-knowledge/references/curation.md` — states the "cannot verify → leave it,
  report it" rule for step 6.
- `packages/core/src/runs/engine.test.ts` — coverage for the VS-255 shape (clone behind, brought
  current, curator's evidence reflects the newer commit) and the block path (clone cannot be
  fast-forwarded, turn never runs, ticket ends up `blocked`).
- No migration: `Project.syncState` / `Project.lastFetchedAt` already exist and are already written by
  `ProjectsService.fetch`.
