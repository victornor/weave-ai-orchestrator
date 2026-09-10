## Why

Captain hit a worker failure card that ended mid-sentence, on a trailing comma, in the middle of the
one thing that would have let them recover: the list of valid model names. There was no "show more",
no sign anything had been cut, nothing to click.

The cause is not the card. `packages/runtime-sdk/src/process.ts`'s `classifyError` reduces the
runtime's stderr to its last line and a bare `.slice(0, 500)` with no marker; `packages/core/src/runs/engine.ts`'s
`parkForHuman` cuts that again to `.slice(0, 400)` before it ever reaches `decisions.create()` or the
worker's `pauseDetailJson`. Both cuts happen **before storage**, with no ellipsis, no "N characters
omitted", nothing. The full stderr is never captured anywhere else (`engine.ts`'s `onRaw` handler is a
no-op), so once these two slices run, the rest of the message is gone for good — no UI change can
bring it back. `DecisionCard.tsx`, the component that renders the worker-failure card, does not
truncate at all; it already renders whatever `decision.context` holds, in full.

One surface partially avoids this: the run's own event stream truncates a runtime error at 2000 chars
with an explicit `…[+N chars]` marker (`packages/runtime-sdk/src/fsutil.ts`'s `truncate()`), rendered
unclamped in the transcript view. That marker-based pattern already exists and is the one to reuse
everywhere else, rather than inventing a second one.

## What Changes

- **Stop discarding content before storage.** `classifyError` and `engine.ts`'s two failure paths
  (the catch-block message and `parkForHuman`) stop using bare, unmarked `.slice()` calls and instead
  reuse the existing `truncate()` helper at a generous limit, so a realistic error (including a long
  comma-separated list) survives intact, and when a message genuinely exceeds the limit the stored
  text itself carries a visible "cut here" marker rather than ending silently.
- **The decision card shows the full text, bounded for layout.** `DecisionCard.tsx`'s context is
  shown in full when short; when long, it renders collapsed to a bounded preview with a visible
  control, and expanding it reveals the complete stored text, tail included. This is the card captain
  saw, and it is shared by the conductor chat's pinned decision area, Needs You, and the global Needs
  view.
- **A ticket shows the decision that explains why its worker stopped**, not only the one-line "paused
  · …" header chip — so the full text is reachable from the ticket page too, through the same
  expandable card, rather than a second, weaker pattern.
- **Compact one-line previews stop lying by omission.** The worker card, ticket card and ticket page
  header already end a cut preview with a visible ellipsis (`oneLine()` already does this) once the
  upstream source is generous — but their tooltip currently repeats the same cut string. It is changed
  to carry the fuller underlying message, so hovering (or, on the ticket page, opening the decision)
  actually reaches more than the preview shows.
- **The TUI's decision card and worker/ticket listings** go through the same `oneLine()`/`truncate()`
  helpers already shared with the web app (`packages/render`), so they inherit the visible-marker
  behavior automatically; no separate fix needed there beyond raising `packages/render/src/decision.ts`'s
  own 600-char cap enough that it stops being the tightest link in the chain once core no longer
  pre-cuts at 400.
- Telegram is unaffected: it already chunks a long message into multiple sends at its own 4096-char
  limit (`packages/channels/telegram/src/markdown.ts`) rather than truncating, so it delivers the full
  text today and needs nothing here.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `run-recovery/stuck-worker-parking`: the message captured for a worker's pause detail and the
  decision raised for it preserves the runtime's text up to a generous limit, and marks it visibly
  when it must be cut, instead of a bare, unmarked slice.
- `run-recovery/paused-worker-visibility`: the full failure message is reachable from every surface
  that names it — the decision card (expand in place, bounded layout), the ticket page (shows the
  decision, not only the header chip), and every compact preview (visible marker plus the fuller text
  attached, not discarded).

## Impact

- `packages/runtime-sdk/src/process.ts` — `classifyError`'s unmarked `.slice(0, 500)`.
- `packages/core/src/runs/engine.ts` — the catch-block `.slice(0, 500)` and `parkForHuman`'s two
  `.slice(0, 400)` calls (`pauseDetailJson.message`, decision `context`).
- `packages/ui/src/components/DecisionCard.tsx` — collapsed/expand rendering for a long context.
- `packages/ui/src/routes/TicketPage.tsx` — surface the ticket's open worker-failure decision.
- `packages/render/src/entities.ts` (`workerPauseReason`) and its callers
  (`packages/ui/src/components/WorkerCard.tsx`, `TicketCard.tsx`, `packages/ui/src/routes/TicketPage.tsx`)
  — carry the full message alongside the capped preview.
- `packages/render/src/decision.ts` (`decisionToCard`) — raise the TUI's context cap.
- Tests: `packages/runtime-sdk` process tests, `packages/core/src/runs/engine.test.ts`,
  `packages/ui/src/test/*` (DecisionCard, WorkerCard/TicketCard, TicketPage), `packages/render`
  decision/entities tests — each with a realistically long message (the model-list example) asserting
  the complete text is reachable, not merely that a control exists.
- No schema change: `decisions.context` and `agents.pause_detail_json` are already unbounded TEXT
  columns: the caps being raised are an application choice, not a storage limit.
- No API shape change.
