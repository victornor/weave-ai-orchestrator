## Context

See `proposal.md` - Why for the root-cause trace. In summary: two bare, unmarked `.slice()` calls
run before any storage write —

1. `packages/runtime-sdk/src/process.ts`'s `classifyError(exitCode, stderr)`:
   `(stderr.trim().split('\n').pop() || ...).slice(0, 500)`, feeding `TurnResult.error.message`.
2. `packages/core/src/runs/engine.ts`'s `parkForHuman()`: `message.slice(0, 400)` written twice —
   once into `agents.pauseDetailJson.message`, once into the `retry_approval` decision's `context`
   string (`Last error: ${message.slice(0, 400)}`).

A third, separate cut lives in `engine.ts`'s catch-block for an engine-level exception:
`err.message.slice(0, 500)`.

The full stderr is never captured anywhere (`engine.ts`'s `onRaw` handler is a no-op), so once (1)
and (2) run, later content is unrecoverable — this is why a UI-only fix cannot work.

One marker-based pattern already exists and already ships: `packages/runtime-sdk/src/fsutil.ts`'s
`truncate(s, max = 8192)` appends `…[+N chars]` when it cuts. It's used today for the run event
stream's `error` event (`truncate(state.errorMessage, 2000)`), which is why that surface (the run
transcript) already shows more of a failure, with an honest marker, than the decision card does.

`decisions.context` and `agents.pause_detail_json` are unbounded SQLite TEXT columns — the 400/500
caps are pure application choices, not a storage constraint.

## Goals / Non-Goals

**Goals:**
- Make the two pre-storage cuts generous and marked, using the existing `truncate()` helper, so a
  realistic failure (the model-list example) survives intact and any real cut is visible in the
  stored text itself.
- Make the web decision card show the complete stored text, bounded for layout.
- Make the ticket page reach that same full-text view for a paused worker, instead of stopping at the
  compact header chip.
- Make every compact preview (worker card, ticket card, ticket page chip) carry the fuller message
  behind its visible ellipsis, rather than only repeating the same cut string as its own tooltip.
- Keep the TUI and CLI honest (visible marker, never a bare cut) using the render helpers they
  already share with the web app — without building a TUI pager.

**Non-Goals:**
- No new database column or schema migration: the fields are already unbounded text.
- No change to Telegram's rendering: it already chunks a long message across several sends at its own
  4096-char limit instead of truncating, so it already delivers the full text.
- No generic, reusable `<ExpandableText>` component library — one local disclosure pattern in
  `DecisionCard.tsx`, matching the one `GlobalIncidents.tsx`'s `IncidentRow` already uses, is enough;
  this change does not go looking for other places to apply it.
- No interactive pager or scroll-back for the Ink TUI's decision card. It keeps a static, capped
  preview; reaching the full text there means opening the web app, same as today for anything else
  the TUI doesn't render in full.
- Does not change `packages/render/src/decision.ts`'s TUI cap into something unbounded — only raises
  it enough that it is no longer tighter than the (now-generous) stored text, so the TUI's own visible
  ellipsis is the binding truncation there, not an invisible upstream one.

## Decisions

### A single generous limit, reused via the existing `truncate()` helper

`classifyError` and `engine.ts`'s two failure paths import and call the same `truncate()` used
already by the runtime event stream, instead of a bare `.slice()`. Limit chosen: **4000 characters**.

Rationale: the reported failure ("Available models: auto, gpt-5.3-codex-low, …") was cut at 500
chars; 4000 comfortably holds a realistic model catalog list or a multi-line tool error while staying
well short of the `decisions.context` column being asked to hold something unreasonable. It sits
above the run-event-stream's own 2000-char cap (that surface is a secondary, already-adequate view;
the decision card is the primary one and deserves the larger budget) and below `truncate()`'s
8192-char default (no reason to claim the full default budget for a field that a compact preview will
usually collapse anyway).

`parkForHuman()` no longer re-slices to 400: the message it receives from `classifyError` (or from
the engine-level catch block) is already bounded to 4000. It calls `truncate(message, 4000)` once,
defensively, in case a future caller supplies an unbounded string directly — this is idempotent
against a value already under the limit, so it changes nothing for the common case.

Alternative considered: capture and store the *raw*, unbounded stderr somewhere and let each surface
truncate independently at render time. Rejected — it would need a new place to put that raw text (a
new column, or overloading an existing one), is a much larger change for a field that is meant to be
a human-readable summary of a failure, not a log dump, and the transcript/event-log path already
exists for anyone who needs the raw process output in full.

### The decision card: collapse by line/character count, not a fixed pixel height

`DecisionCard.tsx` decides whether to collapse based on the rendered markdown source's length (a
character threshold, matching the collapse condition already proven in `GlobalIncidents.tsx`'s
`IncidentRow`), not a CSS `max-height` + `overflow: hidden` clip. A clip-based approach can silently
cut mid-word with no way to detect it from outside the component and fights `Markdown`'s own layout;
a length check on the source string is simple, testable without a real layout engine (jsdom), and
matches the one disclosure pattern already in the codebase.

### `workerPauseReason` starts returning the full message alongside the capped preview

`packages/render/src/entities.ts`'s `workerPauseReason(agent): string | null` becomes a function that
still returns the same capped, ellipsis-marked one-line summary as its primary return value (no
change to any caller that only reads the string), but callers that want the fuller text for a tooltip
read it via a small paired accessor (e.g. `workerPauseDetail(agent): { summary: string; full: string
} | null`) rather than every call site re-deriving it from `agent.pauseDetail` by hand. `WorkerCard`,
`TicketCard` and `TicketPage` are updated to use the fuller text for their `title` attribute; nothing
else about their layout changes. TUI and CLI call sites are untouched — they only ever wanted the
one-line summary and keep getting exactly that.

### Ticket page shows the open worker-failure decision, reusing `DecisionCard`

`TicketPage.tsx` already renders `plan_approval` and `merge_approval` decisions inline (see the
existing `planDecision/mergeDecision` lookups). This change adds the same lookup for a `retry_approval`
decision open on the ticket and renders it with the same `DecisionCard` component used everywhere
else — no new card variant, no second full-text pattern. It sits in the page body, not the header
meta line, so it doesn't fight the existing compact "paused · …" chip for space; that chip is
unchanged except for carrying the fuller tooltip text described above.

## Risks / Trade-offs

- **A 4000-char decision context is still finite.** An adversarial or pathological stderr (a stack
  trace repeated in a loop, say) could still exceed it. Mitigation: the marker makes that visible
  instead of silent, which is the actual bar this change is set to clear — "never silent" — not
  "never truncated at all."
- **Changing `workerPauseReason`'s surface area touches several call sites.** Mitigation: kept
  additive — the existing single-string return stays exactly as it is; only a new accessor is added,
  so no existing caller (TUI, CLI, any test asserting the summary string) needs to change.
- **`DecisionCard`'s new collapse logic adds local component state.** Small and scoped to one
  component, matching the existing `IncidentRow` precedent; no shared state, no new dependency.

## Migration Plan

No data migration: existing stored `decisions.context` and `pauseDetailJson.message` rows, however
short they already are, render exactly as they do today (short enough to need no collapse control).
Only new failures written after this ships get the generous cap and the marker. No rollback concerns
beyond a normal revert.
