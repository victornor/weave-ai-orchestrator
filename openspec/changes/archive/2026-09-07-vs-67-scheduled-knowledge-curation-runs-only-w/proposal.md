## Why

The daemon filed a "Curate project knowledge (agent-conductor)" ticket every 24 hours — VS-65 at
2026-09-05 23:07:07 and VS-66 at 2026-09-06 23:07:08 — with nothing to curate either time. The
workspace is three days old, so nothing can be 14 days stale, and `PROJECT.md` was 3,862 tokens of a
10,000 budget with `curation_pending = 0`.

The daemon journal names the row outright:

```
{"domain":"supervisor","path":"projects/agent-conductor/docs/knowledge-documents.md",
 "scope":"project","reason":"pending","msg":"curation requested"}
```

three times, one a day. The chain behind it:

1. `knowledge-documents.md` was written on 2026-09-04 at 1,222 tokens, when a linked document's
   budget was 1,500 (`packages/core/src/knowledge/files.ts` before VS-18). 1,222 is past 80 % of
   1,500, so `write()` recorded `curation_pending = 1` on that row.
2. VS-18 raised the document budget to 10,000 the next day. `budgetOfRow` resolves the budget from
   the configuration on every read, but `curation_pending` is a *cached verdict*, recomputed only by
   the next write to that file — and nothing has written that document since.
3. `curationPass` (`packages/core/src/supervisor/index.ts`) trusted the cached flag. Its per-path
   cooldown, `supervisor:curation_requested:<path>` in `meta`, is one day — so one stuck flag became
   exactly one curation ticket a day, for ever.
4. Curation could never clear it. `requestCuration('project', …)` spawns a curator that rewrites the
   project's *hub* file; `write(reason: 'curation')` clears the flag on the row it wrote. The flag on
   the sibling document was never touched.

Two smaller faults sit in the same pass: a row whose file is gone (deleted, archived, renamed) is
read as stale for ever, and the request is logged with a bare `reason` and no numbers, so diagnosing
this took the journal plus the schema rather than the log line alone.

## What Changes

- **The pass decides from the numbers in front of it, not from the cached flag.** `curationPass`
  reads `token_estimate` and re-derives "over budget" as `tokens > configured budget × 0.8`, using
  the configured budget for the file's scope — the same resolution `budgetOfRow` does. A file at or
  under its share is not requested however it was flagged in the past.
- **The row is repaired when it disagrees.** The pass writes back `budget_tokens` and
  `curation_pending`, so the flag stops lying to the API, the lint listing and the UI as well. It
  deliberately does not touch `updated_at`, which is the staleness reference for a file that has
  never been curated.
- **The flag is cleared for the whole scope when curation completes** (this is the answer to
  "the curator handles that file too, or the flag is cleared for its scope"): a curation write clears
  `curation_pending` on every knowledge file in the same scope and project, because a curation run is
  requested for a scope, not for one file.
- **A row with no file on disk is skipped**, with a debug line naming it, rather than ageing into
  staleness for ever.
- **Each request is logged with its evidence**: path, scope, `reason` (`over_budget` or `stale`), the
  token estimate, the budget in force, and the timestamp the staleness was measured from. A failed
  request logs the same fields.
- **The 80 % threshold has one home.** `CURATION_BUDGET_FRACTION` in `knowledge/files.ts` replaces
  the three `* 0.8` literals in the knowledge service and is what the supervisor reads, so the writer
  and the sweeper cannot drift apart.

Thresholds are unchanged: 14 days stale, 80 % of budget, one request per path per day.

## Capabilities

### New Capabilities

- `knowledge/scheduled-curation`: when the daemon's periodic sweep asks for a curation run, what it
  measures, what it ignores, and what it records.

### Modified Capabilities

(None.)

## Impact

- `packages/core/src/knowledge/files.ts` — `CURATION_BUDGET_FRACTION` exported.
- `packages/core/src/knowledge/service.ts` — the three `* 0.8` literals read the constant; a curation
  write clears `curation_pending` across its scope.
- `packages/core/src/supervisor/index.ts` — `curationPass` skips rows with no file, re-derives the
  over-budget verdict, repairs the row, and logs the numbers.
- `packages/core/src/supervisor/supervisor.test.ts`, `packages/core/src/knowledge/knowledge.test.ts` —
  four new tests, and the existing seed now puts a file on disk under the real relative path.
- No schema change, no migration, no API or UI change. The stuck row repairs itself on the first
  sweep after the upgrade.

## Out of scope

- Changing the 14-day staleness window, the 80 % share, or the one-request-per-day cooldown.
- Making the project curator rewrite linked documents.
- Deleting leftover `knowledge_files` rows; `reindex()` already does that for documents, and this
  pass only declines to act on them.
