## Why

On 2026-09-27 the WeaveAI project was filed **eight** automatic "Curate project knowledge" tickets (VS-707…725); Fernwood got two within an hour and the side-projects workspace saw the same pattern. The sweep's curation condition is evaluated per file and its cooldown is keyed per file path (`supervisor:curation_requested:${f.path}`), so a project with several stale, over-budget or never-read files fires one curation request per file, each on its own clock. `requestCuration`/`spawnCurator` only rely on the `tickets_origin_open` unique index, which stops a second *open* curation ticket but not a new one once the previous (fast, worktree-less) ticket has finished — so the same project is re-curated several times a day and burns worker quota on knowledge bases well under budget.

## What Changes

- **One curation request per scope per sweep.** The supervisor's `curationPass` stops calling `requestCuration` once per file; it groups the files that need curation by scope + project and makes at most one request per group.
- **A per-scope cap in `requestCuration`.** Regardless of which trigger calls it (the supervisor sweep, `fireCuration` on an 80 %-of-budget write, a document-targeted write, the decisions hub, or the manual `POST /knowledge/:scope/curate` route), the daemon asks for at most one curation run for a given scope + project while one is open, and none for a minimum interval (24 h) after the last one was requested or completed.
- **Hard triggers still fire through the cap.** A manual `weave knowledge curate` (human actor) and a write *rejected* for being over budget bypass the minimum interval — but still never create a second open curation ticket.
- **A curated scope stops being immediately due again.** When a curation write completes for a scope, it resets the staleness reference for every file in that scope, not only the file it rewrote, and a document the curation turn read is recorded as read, so the scope does not immediately re-qualify as stale or never-read.
- No change to the documented thresholds themselves: 80 %-of-budget, the 14-day staleness window, the never-read window, manual curate and over-budget rejection all still work.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `knowledge/scheduled-curation`: curation is asked for at most once per scope + project per sweep and per interval, the per-file conditions collapse into that single request, a completed curation resets the scope's freshness, and manual/over-budget triggers bypass the interval but not the single-open-ticket cap.

## Impact

- `packages/core/src/supervisor/index.ts` — `curationPass` groups by scope and drops the per-path request cooldown in favour of the scope cap.
- `packages/core/src/knowledge/service.ts` — `requestCuration` gains the per-scope cap; `fireCuration` distinguishes a hard over-budget rejection from the soft 80 % trigger; a completed curation (`reason === 'curation'`) resets freshness for the whole scope.
- `packages/core/src/knowledge/files.ts` — the shared minimum-interval constant.
- `packages/core/src/workers/index.ts` — `spawnCurator` keeps the `curation:${projectId}` fingerprint that the unique index already uses; no new open ticket is created inside the interval.
- Tests in `packages/core/src/supervisor/supervisor.test.ts` and `packages/core/src/knowledge/knowledge.test.ts`. No route, CLI or config surface changes; `docs/API.md` unchanged.
