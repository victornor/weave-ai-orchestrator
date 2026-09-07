# Tasks

- [x] 1. Identify the row and the condition behind VS-65 and VS-66 from the daemon journal, and record the chain in the proposal.
- [x] 2. Give the 80 % curation threshold one home, `CURATION_BUDGET_FRACTION` in `knowledge/files.ts`, and read it from the three sites in the knowledge service that spelled it `* 0.8`.
- [x] 3. Clear `curation_pending` across a scope and project when a curation write completes there, so a flag on a linked document the curator did not rewrite cannot outlive the run.
- [x] 4. Make `curationPass` skip a knowledge row whose file is not on disk, with a log line naming it.
- [x] 5. Make `curationPass` re-derive "over budget" from the file's current size against the configured budget for its scope, and repair `curation_pending` and `budget_tokens` on the row when they disagree — without touching `updated_at`.
- [x] 6. Log every request with path, scope, the condition (`over_budget` or `stale`), the token estimate, the budget in force and the timestamp the staleness was measured from; log a failed request with the same fields.
- [x] 7. Tests: a flag left by a since-raised budget asks for nothing and is cleared; a file grown past 80 % is asked for and flagged; a row with no file on disk is skipped; a project curated a day ago is asked for nothing; a curation write clears a sibling document's flag. Four of the five fail without the fix.
- [x] 8. `pnpm lint`, `pnpm typecheck` and `pnpm test` green.
