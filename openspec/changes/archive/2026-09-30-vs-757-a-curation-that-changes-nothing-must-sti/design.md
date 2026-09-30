## Context

`write()` (`knowledge/service.ts:276-292`) is the only place staleness is reset. A no-op curation writes nothing. The supervisor sweep (`supervisor/index.ts` ~960-1010) re-derives `stale` from `last_curated_at ?? updated_at`, so NULL rows keep qualifying and only the 24 h interval (`withinCurationInterval`) prevents a request.

## Decisions

1. **Hook = `propagateTerminal(t, actor)` in `tickets/service.ts` (~line 581).** It is the single function run after `transition`, `cancel` and `mergeDone` reach a terminal status, so a curation ticket finishing by any path is covered, including `done` reached from `in_review` after a delivered knowledge-repo PR. It gets `if (t.status === 'done' && t.originKind === 'curation' && t.projectId)` → `deps().knowledge.markCurated('project', t.projectId)`, wrapped in try/catch with a warn like its neighbours. `cancelled` and failed runs never reach `done`, so they stamp nothing. Alternative rejected: run completion in the engine — a run ending does not mean the ticket is done (a curator may be relaunched), and the ticket status is the authoritative "curation finished" fact.
2. **`markCurated(scope, projectId)`** in the knowledge service updates every `knowledge_files` row of the workspace + scope + project (`last_curated_at = now`, `curation_pending = 0`) and calls `stampCuration`. `write()`'s sibling stamping keeps its own statement (it excludes the row it just patched) but shares the stamp. `updated_at` is untouched. Rows with a NULL `last_curated_at` are covered because the update is unconditional on it.
3. **Workspace scope.** The weaver is woken with `reason: 'curate'` and there is no ticket or completion event; a weaver turn ending is not evidence it curated. So workspace/shared/decisions keep stamping on `weave_knowledge_replace` only, as today. The interval still limits them to one request a day; stated as a known limitation.
4. **No-role log once per interval.** `spawnCurator` throws `wrong_status` when the project has no active role. In `requestCuration`'s project branch, catching that from a non-forced request calls `stampCuration` before rethrowing, so the supervisor logs the warning once and the following sweeps hit the existing `curation request suppressed: within the interval` info path. Forced (human) requests do not stamp and still surface the error. Only `wrong_status` is caught, so transient spawn failures are still retried next sweep.

## Risks

A curation that ends `done` after a failed/partial job still counts as curated for 14 days; acceptable — that is the ticket's requirement.
