## Context

See `proposal.md` — Why. The pieces that shape the approach:

- Every trigger funnels through `KnowledgeService.requestCuration` (`packages/core/src/knowledge/service.ts`): the supervisor's `curationPass` sweep, `fireCuration` from the 80 %-of-budget and over-budget-rejection write paths, the decisions-hub write, and the manual `POST /knowledge/:scope/curate` route. The supervisor is the only path that calls it per file.
- The `tickets_origin_open` unique index (`packages/db/src/migrations/0001_init.sql`, on `workspace_id, origin_kind, origin_fingerprint` where the status is not terminal) already prevents a *second open* curation ticket for a project: `spawnCurator` uses `originFingerprint: curation:${projectId}`. It does **not** prevent a new ticket once the previous one has finished.
- `write()` in `service.ts` already treats a curation as scope-wide for the `curation_pending` flag (`reason === 'curation'` clears it for every file in the scope); it does not touch `last_curated_at` for files the curator did not rewrite, which is the sweep's staleness reference.
- Never-read is derived from `knowledge_usage_events` (`knowledge/context-accounting`); the sweep reads `knowledgeUsage.neverRead()`.
- The sweep's only dedup today is a per-file `meta` stamp, `supervisor:curation_requested:${f.path}`, cooldown `CURATION_REQUEST_COOLDOWN_MS = 24h`. One stamp per file path means *N* files in one project produce *N* requests on *N* clocks.

## Goals / Non-Goals

**Goals:**

- One curation run per scope + project, whether open or recent, regardless of which trigger asks.
- A single per-scope request per sweep instead of one per file, with each qualifying file still logged.
- A completed curation resets the whole scope's freshness so nothing it covered is immediately due again.
- The bypass set is exactly: a manual request and a write rejected for being over budget.

**Non-Goals:**

- No new configuration surface; the interval is a code constant with its reasoning in a comment.
- No change to the thresholds themselves (80 %, 14-day staleness, never-read window), to the knowledge health view, or to the curator's brief.
- No synthetic read events: a document's read state continues to come only from the usage events the daemon already records.
- No route or CLI surface change beyond the internal `force` option on the manual curate route.

## Decisions

### Enforce the cap in `requestCuration`, not only in the sweep

*Decision:* `requestCuration(actor, scope, projectId, opts?: { force?: boolean })` becomes the single choke point that decides whether a run is asked for. It skips when a curation for the scope + project is open, or when one was requested/completed within `CURATION_MIN_INTERVAL_MS`, unless `force` is set. On a skip it returns an empty result and logs the reason; on success it stamps the "last requested" time.

*Why:* four different call paths file curation, and three of them do not go through the sweep. A cap living only in the sweep would leave `fireCuration` and the manual route able to refile. One choke point also gives one place to test the interval.

*Alternative considered:* fix only the sweep and keep per-file cooldown. Rejected — it leaves the write paths uncapped and does not collapse per-file requests.

### Collapse per-file conditions in the sweep

*Decision:* `curationPass` groups the rows that qualify by `(scope, projectId)`, makes one `requestCuration` call per group, and logs each qualifying file with its own evidence (`path`, `scope`, condition, size, budget, staleness reference, never-read window). The per-path `supervisor:curation_requested:*` meta stamp and `CURATION_REQUEST_COOLDOWN_MS` are removed; the scope interval replaces them.

*Why:* the request is for a scope by design (the curator rewrites the hub and reviews the scope), so one request per scope is the honest unit. Grouping keeps the "which file made this fire" evidence the existing log requirement asks for.

*Alternative considered:* keep calling per file and let `requestCuration` swallow duplicates. Rejected — it keeps *N* calls, *N* meta stamps and *N* log lines for one decision, and makes the collapse invisible to the sweep's tests.

### Represent the interval with a per-scope `meta` stamp

*Decision:* stamp `meta` key `knowledge:curation_at:${scope}:${projectId ?? ''}` with the current time when a request is honored, and again when a curation write completes for the scope (`reason === 'curation'`). The interval is measured from the newest stamp. Keyed by scope + project, so workspace, shared, decisions and each project are capped separately.

*Why:* it covers the workspace-scope path (which has no ticket, only a conductor wake) as well as the project path, and it persists across restarts with the rest of `meta`. Stamping on completion makes "after one finishes" literal for a run that stays open across the interval.

*Alternative considered:* derive the last run from the newest curation ticket per project. Rejected — it does not cover workspace scope and adds a tickets query to a hot path.

### Distinguish the hard over-budget rejection from the soft over-share trigger

*Decision:* `fireCuration` gains a `force` flag; the rejection path in `note()` (`tokens > budget`, write refused) passes `force: true`, while the soft path (`tokens > budget * CURATION_BUDGET_FRACTION`, write accepted) does not. The `replace()` path at `tokens > budgetOfRow(row)` is a rejection-equivalent (the write is over budget) and passes `force: true`. The manual HTTP route passes `force: true`; `actor.kind === 'human'` is the fallback signal for a manual call.

*Why:* the requirement names exactly these two as bypasses. The soft condition means the file is approaching its budget, not that it is broken; it can wait for the interval.

### Reset the scope's staleness reference on a completed curation

*Decision:* in `write()`, when `reason === 'curation'`, update `last_curated_at` to now for every file in the scope **and** project (the same predicate that already clears `curation_pending`), leaving `updated_at` untouched. Do not synthesize read events; a document's never-read state stays exactly what `knowledge_usage_events` says, and the interval keeps the scope from being asked again before a read can land.

*Why:* `last_curated_at` is the staleness reference the sweep reads; without this, every document the curator did not rewrite re-qualifies as stale the next morning. Clearing `curation_pending` alone (VS-67) fixed the flag, not the age.

## Risks / Trade-offs

- **A legitimate re-check is delayed by up to 24 h.** → Only for the *automatic* triggers; a human can bypass with `weave knowledge curate`, and a hard over-budget rejection still fires immediately.
- **A curation run that never completes leaves its request stamp** and the scope is retried 24 h later. → Acceptable: that is the existing cooldown behaviour; the ticket itself is still open and visible.
- **Removing the per-path cooldown could change the "asks at most once per file per day" test.** → That test is replaced by a scope-level test asserting one request for several due files and none on a second pass inside the interval.
- **The supervisor test mocks `requestCuration`**, so the collapse assertion and the cap assertion must live in different suites. → Collapse and grouping in `supervisor.test.ts` with the mock; interval, bypass and open-ticket cap in `knowledge.test.ts` against the real service.

## Migration Plan

No schema change: the cap reuses the existing `meta` table and the existing `tickets_origin_open` index. Deploy is the ordinary daemon upgrade after merge. Rollback is reverting the change; the stray `meta` keys are inert.

## Open Questions

None.
