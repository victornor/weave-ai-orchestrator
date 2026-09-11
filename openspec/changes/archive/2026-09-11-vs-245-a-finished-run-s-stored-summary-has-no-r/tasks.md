## 1. Digest enrichment

- [x] 1.1 In `packages/core/src/supervisor/index.ts`, add the bound constants
  `DIGEST_SUMMARY_ENTRY_CHARS = 400` and `DIGEST_SUMMARY_TOTAL_CHARS = 1600` next to the existing
  digest constants, with a comment naming `worker-supervision/conductor-digest` (design.md Decision
  3). Verify with `pnpm typecheck`.
- [x] 1.2 Add a helper (e.g. `digestRunSummary(runId)`) that reads
  `SELECT result_json FROM runs WHERE id = ?`, returns `{ agentReportedSummary: string }` when the
  decoded row's `result.summary` is a non-empty string, and returns `{ summaryOmitted: 'no_report' }`
  otherwise, guarded by a `try/catch` so a failed read or unexpected payload degrades to `no_report`
  (design.md Decisions 1 and 4). Cap summaries with a local hard-bounded clip (a visible `…`) so the
  per-entry and per-digest ceilings hold exactly. Verify the helper's two branches with a unit test
  in `supervisor.test.ts`.
- [x] 1.3 In `conductorDigest()`, replace the plain `{ type, entityId, at }` mapping with one that,
  for `e.type === 'run.finished'`, attaches the helper's result subject to a per-digest running
  budget: cap the summary to `min(DIGEST_SUMMARY_ENTRY_CHARS, remaining)` and decrement
  `remaining` by what was carried; when `remaining` is zero, attach `{ summaryOmitted: 'digest_cap' }`
  instead of a summary. Leave other event types mapped exactly as before and leave
  `relevant.slice(0, 30)` unchanged (design.md Decision 3). Verify with the tests in task group 2.

## 2. Digest tests (`packages/core/src/supervisor/supervisor.test.ts`)

- [x] 2.1 A run that stored a report: insert a `runs` row with `resultJson: { state, summary, knowledge }`
  and emit `run.finished` with liveness `blocked`; assert the digest wake's `run.finished` entry
  carries `agentReportedSummary` equal to the stored summary and does not carry `summaryOmitted`
  (spec: "The digest carries a finished run's stored report summary").
- [x] 2.2 A run with no stored report: insert a `runs` row with `resultJson: null` (and a second case
  for a run that failed with no report) and emit a digest-worthy `run.finished`; assert the entry
  carries `summaryOmitted: 'no_report'` and no `agentReportedSummary`, i.e. never a blank (spec:
  "A run with no stored report still produces a sensible entry").
- [x] 2.3 A single long summary: store a report summary longer than `DIGEST_SUMMARY_ENTRY_CHARS` and
  assert the carried `agentReportedSummary` is capped and ends with the `truncate()` marker (spec:
  the per-entry limit scenario).
- [x] 2.4 Many finished runs between digests: emit more digest-worthy `run.finished` events than the
  summary budget can hold and assert the summed `agentReportedSummary` length across entries never
  exceeds `DIGEST_SUMMARY_TOTAL_CHARS`, that the entries that were left out carry
  `summaryOmitted: 'digest_cap'`, and that the event list length is still bounded by the existing
  slice (spec: "The carried summary text is bounded").
- [x] 2.5 Run the existing digest tests ("sends the conductor a coalesced digest wake…", "ignores
  events that are not conductor-relevant") unmodified and confirm they still pass, demonstrating the
  change only enriches entries that were already included.

## 3. Verification

- [x] 3.1 Confirm `ac_run_inspect` and `packages/server/src/inspect.ts` are untouched by the diff
  (`git diff --name-only` shows only the supervisor source and its test) and that the run-inspection
  tests still pass.
- [x] 3.2 `pnpm lint && pnpm typecheck && pnpm test` green. Paste both suite blocks verbatim in the
  PR and the ticket comment, each with its own real totals (core/server and UI, never summed).
