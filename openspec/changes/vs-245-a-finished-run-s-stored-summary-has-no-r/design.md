## Context

See `proposal.md` — Why. This design covers only how the digest's `run.finished` entry is enriched.

Current shape, all in `packages/core/src/supervisor/index.ts`:

- `conductorDigest()` (`index.ts:393`) reads `ctx.events.since(lastSeq, 200)`, filters to
  `DIGEST_EVENT_TYPES` and conductor-relevance, maps each surviving event to `{ type, entityId, at }`,
  and enqueues one wake whose payload is `{ since, events: relevant.slice(0, 30) }`.
- The `run.finished` filter keeps only liveness `blocked`, `needs_decision` or `failed`
  (`index.ts:407-410`); a cleanly `advanced` turn is deliberately not digest-worthy.
- `finalize()` already emits a `summary` in the event payload (`engine.ts:528`), but that value is
  `f.report?.summary ?? r.finalText.slice(0, 1000) ?? failure.message` (`engine.ts:452`) — a
  report summary, a raw final-text excerpt and a runtime failure message are all the same field.
- The stored report itself is `runs.result_json` (`engine.ts:471`, `resultJson: f.report ?? null`).
  No non-test code reads it today. `Db.get`/`.all` decode a `*_json` column and drop the suffix
  (`packages/db/src/db.ts:110-113`), so `SELECT result_json` returns `row.result` already parsed.
- `truncate(s, max)` (`@agent-conductor/runtime-sdk`, `fsutil.ts:107`) is the codebase's existing cap
  convention: it appends a visible `…[+N chars]` marker and is already imported by core.

## Goals / Non-Goals

**Goals:**
- The conductor reads a finished run's stored report summary in the digest wake it already gets.
- The summary reads unmistakably as the agent's own account, never as a verified outcome.
- A run with no stored report yields an explicit entry, never a blank.
- The digest stays bounded no matter how many runs finish between digests.

**Non-Goals:**
- Changing which runs are digest-worthy. The existing liveness filter is untouched; this change only
  enriches the `run.finished` entries already included.
- Changing what agents report, `RunReportSchema`'s field limits, or `ac_run_inspect`.
- Reading or surfacing the rest of the report (tickets, next action, knowledge). Only the summary.
- Any migration: `result_json` already exists.

## Decisions

### 1. Read the stored report from the run row (`runs.result_json`), not the event payload's summary

The event payload's `summary` is a fallback chain that cannot be told apart from the report: a
`failed` run with no report carries the runtime's failure message in the same field a report's
summary would use, so attributing it to the agent would be wrong. Reading `result_json` at digest
time distinguishes "the agent reported this" from "the run stored no report", and makes the digest
the stored report's first reader — the gap the ticket exists to close.

**Alternative considered:** reuse the `summary` already on the event payload, avoiding the DB read.
Rejected: it mislabels failure text as the agent's account and leaves `result_json` unread.

The read is `SELECT status, result_json FROM runs WHERE id = ?` keyed by the event's `entityId`. The
row is typed narrowly and every field is checked before use (`result` may be `null`, `result.summary`
may be absent), so a legacy or unexpected row cannot throw inside the digest.

**Alternative considered:** a batch `IN (...)` query for all run ids at once. Rejected as premature:
the digest already caps at 30 events, the lookups are primary-key reads, and the digest runs at most
every `conductorDigestIntervalSec` (default 120 s).

### 2. Entry fields: `agentReportedSummary`, and `summaryOmitted` when there is none

Each `run.finished` entry keeps its existing `{ type, entityId, at }` and gains:

- `agentReportedSummary?: string` — the stored report summary, capped. The field name carries the
  attribution the spec requires: the agent's own account, not a daemon-verified value.
- `summaryOmitted?: 'no_report' | 'digest_cap'` — present exactly when `agentReportedSummary` is
  absent. `no_report` means the run stored no report (absent, or failed before recording one);
  `digest_cap` means a report exists but the per-digest summary budget is spent.

A run with a report always carries one of the two, never a blank.

### 3. Bounds: a per-entry cap and a shared per-digest ceiling

- `DIGEST_SUMMARY_ENTRY_CHARS = 400` — one entry's summary is capped with a small hard-bounded clip
  (`…`), not `truncate()`: `truncate()`'s `[+N chars]` marker is appended past the given max, which
  would let a truncated entry — and so the digest total — exceed the ceiling it exists to hold.
- `DIGEST_SUMMARY_TOTAL_CHARS = 1600` — a running budget, decremented as entries are enriched. Each
  entry takes `min(entryCap, remaining)`. Once the budget reaches zero, later `run.finished` entries
  carry `summaryOmitted: 'digest_cap'`.

Together with the existing `relevant.slice(0, 30)`, the whole digest is bounded: at most 30 entries
and at most 1600 characters of summary text, independent of how many runs finished.

**Alternative considered:** per-entry cap only. Rejected: 30 × 400 = 12,000 characters is too large
for text injected into a conductor turn, and it is not the "total ceiling" the ticket asks for.

**Alternative considered:** attach summaries to only the first handful of entries. Rejected: a shared
budget lets several short summaries all survive while a single giant one cannot consume the whole
allowance, which matches the intent better than a fixed count.

### 4. Failure isolation

The per-entry run-row read is guarded (`try/catch`); a failed read or unexpected payload yields
`summaryOmitted: 'no_report'` for that entry rather than dropping the digest or the event. The
digest's existing outer `try/catch` around the wake enqueue is unchanged.

## Risks / Trade-offs

- **The digest payload grows with summaries** → bounded by `DIGEST_SUMMARY_TOTAL_CHARS` plus the
  fixed 30-entry list, so the wake stays small.
- **Per-entry DB reads (≤ 30) per digest** → primary-key lookups on a local SQLite file, at most
  once per digest interval; negligible next to the existing `events.since` query.
- **A stored summary could still be read as a verified result** → the field is named as the agent's
  own account and the spec's attribution requirement is asserted by test; the digest already treats
  every other entry as a pointer, not a fact.
- **A corrupt/legacy `result_json`** → guarded read; the entry degrades to `no_report` instead of
  failing the digest.
