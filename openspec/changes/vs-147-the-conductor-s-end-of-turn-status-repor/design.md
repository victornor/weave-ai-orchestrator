## Context

See `proposal.md` for the motivation. Relevant existing code:

- `packages/ui/src/lib/transcript.ts`'s `runEventsToTranscript` turns `run_events` rows into
  `TranscriptBlock[]`; `assistant.text` events merge into a single `type: 'text'` block per run of
  consecutive text (`last.text += text`).
- `packages/ui/src/components/Transcript.tsx`'s `TranscriptLine` renders `type: 'text'` as a plain
  `<p>`, and `type: 'tool'` with a collapsed head row plus click-to-expand body.
- `packages/shared/src/report.ts` already owns detection and parsing: `extractReport(text)` returns
  a validated `RunReport` or `null`, scanning fenced ```json blocks (last one wins) and a trailing
  bare JSON object. This is the same function the run engine uses server-side to read a turn's
  final report; reusing it client-side keeps "what counts as the report" defined in exactly one
  place.

## Goals / Non-Goals

**Goals:**
- Detect the end-of-turn report reliably, using the existing parser rather than a new heuristic.
- Render it collapsed, consistent with how a tool row already collapses in the same trace.

**Non-Goals:**
- No change to `packages/render`'s separate TUI-facing implementation (see proposal's Out of scope).
- No change to what the report contains, how it is produced, or how the daemon parses it.
- No attempt to hide the trace section itself, or to change VS-74's collapse/expand behavior for
  turns that don't end in a report.

## Decisions

**Detect on the finished, merged text block, not per-event.** `runEventsToTranscript` builds the
full block list from a run's complete event history (it is not a streaming reducer called once per
event); after merging consecutive `assistant.text` events, check whether the *last* block is
`type: 'text'` and `extractReport(block.text)` succeeds. If so, replace it with a `type: 'report'`
block carrying the parsed `RunReport` and the original raw text. Checking only the last block (not
every text block) matches how the report is actually produced — one trailing message per turn — and
avoids re-parsing every text block in every turn on every render.
- Alternative considered: tag the event itself server-side (e.g., a `kind: 'final_report'` column on
  `run_events`). Rejected as unnecessary schema/migration work for a client-only rendering fix; the
  investigation confirms the data needed to detect this already exists and only needs to be read.

**Render like a tool row, not like a new pattern.** Reuse the existing collapsed-head-plus-expandable-body
shape (`expandable`/`open` state, `▸`/`▾`) that `TranscriptLine` already uses for `type: 'tool'`,
rather than introducing a third visual language. Collapsed line: a status glyph for the report's
`state` plus the `summary` field, truncated. Expanded: the raw JSON, styled like `DiffBlock`.
- `RunReport.state` (`REPORT_STATES`: `working | needs_decision | blocked | paused | done | failed |
  idle`) does not line up 1:1 with `UiStatus` (`StatusGlyph`'s prop type). Map the two states with no
  existing `UiStatus` equivalent: `needs_decision` → `needs-you`, `paused` → `stalled`. The rest are
  shared spellings already.

**A block is either wholly a report or wholly text — no splitting.** `extractReport` matches against
the whole block; if the model's final message is *only* the report (as every worker/conductor skill
instructs), this is exact. If a block ever contains both prose and a trailing report, the whole
block renders as the collapsed report and the prose is not shown separately — an acceptable and rare
edge case, not a regression (today that block is shown correctly as text; splitting it correctly is
more machinery than this fix needs, and no observed turn mixes the two).

## Risks / Trade-offs

- [A model turn ends with JSON that happens to validate against `RunReportSchema` but isn't
  actually the structured report] → Vanishingly unlikely given the schema's required fields
  (`state` enum, `knowledge` with its `where`/`reason` refinement); the same risk already exists
  server-side in `extractReport`'s use for `finalize()`, so this fix does not introduce a new
  failure mode, only a new place the same ambiguity could show up.
- [A conductor/worker turn that does NOT end its message with the structured report — an older
  transcript recorded before this convention, or a skill that changes it later] → Falls through
  unchanged as a `type: 'text'` block, exactly like today; no regression.
