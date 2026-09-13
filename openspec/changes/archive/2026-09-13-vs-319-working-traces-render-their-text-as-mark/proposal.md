## Why

Captain watched the weaver's in-progress trace in the chat (screenshot: attachment
`01M2DJE9C9ECERT0V6F48A59DE` on thread `01M1Q5NVMN22QJPQMFSG165KAF`). Two defects, both in the live
transcript, neither in the finished message that follows it:

1. **Raw markdown.** `TranscriptLine` (`packages/ui/src/components/Transcript.tsx:97`) renders every
   `text` block — narration and thinking alike — as `<p className="whitespace-pre-wrap …">{block.text}</p>`,
   plain text. `**Inbox:**` shows its asterisks, a `1. … 5.` list shows as five plain lines, and a
   backtick code span shows its backticks. The same content, once the turn finishes and the message
   is stored, renders correctly through `components/Markdown.tsx`. `Transcript` backs every live
   trace in the app — the conductor chat (`routes/Chat.tsx:874`), the worker page
   (`routes/WorkerPage.tsx:203`), and, via `RunTranscript`, the ticket and run pages
   (`routes/TicketPage.tsx:561`, `routes/RunPage.tsx:96`) — so the defect is universal to "a turn
   that hasn't finished yet," not particular to the chat.

2. **A duplicated paragraph.** The screenshot's last thinking/narration paragraph renders twice,
   back to back. Root-caused below (not merely reproduced): the live view merges two event sources
   that assign the *same underlying row* two different identifiers, so the surface's own
   deduplication never catches the repeat.

## Root cause of the duplicate (verified by reading the code, not guessed)

- A run's events are persisted with a real, unique primary key: `run_events.id INTEGER PRIMARY KEY
  AUTOINCREMENT` (`packages/db/src/migrations/0001_init.sql:125`). `GET /runs/:id/events` returns
  that row as-is (`packages/core/src/runs/index.ts:47`), so a persisted `RunEvent.id` is that
  autoincrement value.
- The engine's live emission never uses that value. `record()` in
  `packages/core/src/runs/engine.ts:214-218` inserts the row, then broadcasts
  `{ id: String(seq), runId, seq, ts, type, ... }` — `seq` is a per-run counter kept in a local
  variable, not the row's real id. `recordHumanInputEvent` (`packages/core/src/runs/active.ts:52-60`)
  does the same thing for a human's mid-turn message. So the *live* copy of an event and its
  *persisted* copy carry two different `id` values for the same row; `seq` is the only field that
  actually agrees between them (and is guaranteed unique per run by the table's own
  `UNIQUE (run_id, seq)`).
- `useRunEventStream` (`packages/ui/src/api/runStream.ts:53-70`) merges the persisted query's rows
  with the SSE tail and deduplicates by `.id`. That works as long as the persisted query is only
  fetched once, before the tail starts. It stops working the moment the persisted query refetches
  mid-turn — and it does: every `run.event` notification on the *workspace* stream invalidates the
  *same* `runEvents` query key (`packages/ui/src/api/events.ts:351-352: case 'run.event': inv(qk.runEvents(ws,
  id))`), and that workspace stream is the one connection every workspace route already holds
  (`packages/ui/src/api/context.tsx:42`). So while a turn is being watched, every event it produces
  triggers a refetch of its own persisted history a moment later — a refetch that returns the same
  row the SSE tail already delivered, under a different `id`. The by-id dedup lets both through.
- `packages/ui/src/lib/transcript.ts`'s event-to-block reducer merges consecutive `assistant.text`
  blocks (`last.text += text`) but never merges `assistant.thinking` blocks — each one is always
  pushed as its own block. A thinking/narration paragraph that exists twice in the deduped-wrong
  `events` array therefore becomes two separate, back-to-back blocks — exactly the screenshot.
- `packages/ui/src/routes/WorkerPage.tsx:98` has the same class of bug in a cruder form:
  `const events = [...(persisted.data ?? []), ...live]` concatenates the two arrays with **no**
  deduplication against `persisted.data` at all (only `live`'s own append guards against re-adding a
  frame already in `live`). It shares `useWorkspaceEvents` — the same workspace stream that triggers
  the `runEvents` invalidation — so it is exposed to the identical race, without even the partial
  protection `useRunEventStream` has.

## What Changes

- `Transcript`'s `TranscriptLine` renders a `text` block (thinking or not) through the existing
  `Markdown` component instead of a plain `<p>`, matching how a finished message renders its body
  (`routes/Chat.tsx`'s `MessageBody`, `breaks` on). The thinking/narration dim-and-italic treatment
  moves from the raw-text wrapper to a class on the `Markdown` container, so it still applies.
  `Markdown`'s renderer already HTML-escapes everything before adding markup
  (`packages/ui/src/lib/markdown.ts`'s `esc()`), so trace text — untrusted, from the agent — gets the
  same safety guarantee finished messages already have, with no new work needed there.
- A shared helper merges a run's persisted events with its live tail by `seq` (already unique per
  run, already present on both sides) instead of by `id` (which the two sources do not agree on).
  `useRunEventStream` and `WorkerPage.tsx` both use it, so the same fix covers the conductor chat,
  the worker page, and (through `RunTranscript`) the ticket and run pages in one place.
- No change to the `id` field itself, the schema, or what the engine broadcasts — `seq` is already
  exactly the join key the two sources agree on, so the fix is entirely client-side.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `conductor-chat/live-turn-stream`: the live transcript's text blocks render as markdown, the same
  rules finished messages use, including while a block is still streaming and its markup is
  incomplete; live activity renders exactly once no matter how many times its persisted record is
  independently fetched while the turn is still live.

## Impact

- `packages/ui/src/components/Transcript.tsx` — `TranscriptLine`'s `text` block renders via
  `Markdown`.
- `packages/ui/src/api/runStream.ts` — a `seq`-keyed merge, exported for reuse.
- `packages/ui/src/routes/WorkerPage.tsx` — its ad hoc `[...persisted, ...live]` concatenation
  replaced with the shared merge.
- Tests: `packages/ui/src/components/Transcript.test.tsx` (or a new file beside it),
  `packages/ui/src/test/runStream.test.tsx`, `packages/ui/src/test/workerPage.test.tsx`,
  `packages/ui/src/test/liveTranscript.test.tsx`.
- No server, database, schema, or event-shape change.

Out of scope (per the ticket): restyling tool rows; changing how a finished chat message renders.
