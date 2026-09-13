## Context

See `proposal.md` — Why, and the root-cause chain for the duplicate. Two independent defects share
one component (`Transcript`), so one change fixes both.

**Markdown.** `TranscriptLine` (`packages/ui/src/components/Transcript.tsx:97`) renders a `text`
block as `<p className="whitespace-pre-wrap …">{block.text}</p>`. `components/Markdown.tsx` already
exists, is already used for a finished message's body (`Chat.tsx`'s `MessageBody`, with `breaks`),
and already escapes all input before adding markup (`lib/markdown.ts`'s `esc()`), so there is no new
safety work — reusing it is the entire fix for defect 1.

**Duplicate.** The persisted copy of a run event (`GET /runs/:id/events`) carries the row's real
`id` (SQLite `INTEGER PRIMARY KEY AUTOINCREMENT`). The live copy (`emitRunEvent` calls in
`packages/core/src/runs/engine.ts:218` and `packages/core/src/runs/active.ts:60`) carries
`id: String(seq)` — a per-run counter, never the row's real id. The two never agree. `seq` (a plain
number, part of the row and part of the emitted payload) does agree, and is guaranteed unique per run
by the table's own `UNIQUE (run_id, seq)`. `useRunEventStream`'s merge dedupes by `.id`
(`packages/ui/src/api/runStream.ts:63-70`), which is silently wrong the moment the persisted query
refetches mid-turn — which it reliably does, because every `run.event` notification on the workspace
stream invalidates that exact query (`packages/ui/src/api/events.ts:352`), and the workspace stream is
open for the whole time a workspace route is mounted (`packages/ui/src/api/context.tsx:42`).
`WorkerPage.tsx:98` has no dedup against `persisted.data` at all, so it is exposed even harder.

## Goals / Non-Goals

**Goals:**

- A live trace's text (thinking and non-thinking) renders with the same markdown rules a finished
  message does: bold, italic, inline code, fenced code, ordered and unordered lists.
- A block that is mid-stream — an unclosed `**`, an in-progress list — renders without throwing, and
  looks right once the rest of it arrives.
- The mechanism that produces the duplicated paragraph is fixed at its source (the mismatched merge
  key), not papered over by, say, deduping identical adjacent text — a coincidentally-repeated real
  narration would then silently disappear.
- The fix applies to every surface that shares `Transcript`/`TranscriptLine`: the conductor chat, the
  worker page, and (through `RunTranscript`) the ticket and run pages.

**Non-Goals:**

- Restyling tool call rows, `command` blocks, `report` blocks, or any block type other than `text`.
- Changing how a finished message renders (`Markdown` itself, `MessageBody`) — it is already correct
  and is the pattern being matched, not touched.
- Changing the run-events schema, the engine's `id`/`seq` fields, or the API's event shape. The fix
  is entirely in how the client merges two sources it already receives.
- Changing when or why the workspace stream invalidates `runEvents` — that invalidation is doing its
  job (a persisted view should reflect new rows); the bug is that the merge assumed a persisted
  refetch could never overlap the tail, and it can.

## Decisions

### Decision 1 — Text blocks render through `Markdown`, not a plain `<p>`

`TranscriptLine`'s `text` case becomes (shape, not literal diff):

```tsx
if (block.type === 'text') {
  return (
    <Markdown
      source={block.text}
      breaks
      className={cx('text-body leading-relaxed', block.thinking ? 'text-text-3 italic' : 'text-text-body')}
    />
  );
}
```

- `breaks` is on, matching `MessageBody`'s choice for chat text (`Chat.tsx:89`): trace narration is
  streamed prose the model wrote, not hard-wrapped generated markdown, so a single newline should
  stay a visible line break — the same reasoning `Markdown.tsx`'s own doc comment gives for composer
  text.
- The thinking dim/italic treatment stays a className, now on `Markdown`'s wrapper `div` instead of
  the old `<p>`; `whitespace-pre-wrap` is dropped since `Markdown`'s own paragraph/`<br>` handling
  (with `breaks`) already preserves line breaks.
- No new escaping work: `markdownToHtml` runs `esc()` over every line before any markup is added
  (`lib/markdown.ts`), so a trace block containing literal `<script>` or any other HTML-looking text
  from the agent is inert exactly as it would be in a finished message. This is the acceptance
  criterion "no raw HTML execution" — already true of the component being reused, not something this
  change adds.
- Partial markdown safety is inherited, not built: `markdownToHtml` is regex-based per line, re-run
  on the block's *entire current text* on every render (the block's `text` field is the full
  accumulated string so far, not a diff) — there is no persisted "parsed so far" state to get stuck
  half-applied. An unclosed `**` simply fails to match the bold regex and stays literal until its
  closer arrives, at which point the very next render (with more text) matches and flips to bold. An
  open fenced block or an in-progress list item renders as whatever is captured so far and settles
  once the rest streams in. No new code is needed for this; it is verified with a test, not assumed.
- *Alternative considered:* add a second, trace-specific markdown renderer tolerant of partial input.
  Rejected — `Markdown`'s renderer is already partial-input-tolerant (it never throws on malformed
  input, by construction of being regex/line-based rather than a strict parser), and a second
  renderer would be exactly the "same paragraph, formatted two different ways" risk the ticket is
  trying to eliminate.

### Decision 2 — Merge persisted and live events by `seq`, not by `id`

Add one small, pure, exported helper (`packages/ui/src/api/runStream.ts`, or a sibling module if that
file gets crowded):

```ts
export function mergeRunEvents(persisted: readonly RunEvent[], live: readonly RunEvent[]): RunEvent[] {
  const out: RunEvent[] = [];
  const seen = new Set<number>();
  for (const e of [...persisted, ...live]) {
    if (seen.has(e.seq)) continue;
    seen.add(e.seq);
    out.push(e);
  }
  return out.sort((a, b) => a.seq - b.seq);
}
```

- `seq` is chosen over `id` because it is the one field the persisted row and the live emission
  already agree on today, verified against the schema's own `UNIQUE (run_id, seq)` constraint
  (`packages/db/src/migrations/0001_init.sql:126`) — not a new invariant being introduced, an
  existing one being used correctly. Both inputs are already scoped to one run (both call sites pass
  events for a single `runId`), so `seq` alone — without pairing it to `runId` — is sufficient and
  keeps the helper simple; nothing about this ever merges two runs' events together.
- `useRunEventStream` (`runStream.ts:63-70`) is rewritten to call this helper instead of its current
  by-`id` `Set`.
- `WorkerPage.tsx:98`'s `const events = [...(persisted.data ?? []), ...live]` is replaced with
  `mergeRunEvents(persisted.data ?? [], live)`. Its own `live`-only append guard (`setLive((xs) =>
  xs.some((x) => x.id === p.event!.id) ? xs : [...xs, p.event!])`) is left as is — it prevents the
  same SSE frame from being appended to `live` twice, which is a different, correct check (`live` is
  never persisted-and-refetched, only appended to) — the bug being fixed here is specifically the
  merge *against* `persisted.data`.
- *Alternative considered:* fix the mismatch at the source — have `emitRunEvent`/`record()` carry the
  row's real autoincrement id (e.g. via `lastInsertRowid`), so `id` itself becomes trustworthy.
  Rejected for this change: it touches the engine, the event shape, and every runtime's assumptions
  about `RunEvent.id` being stable across the codebase, for a fix that a client-only, one-field
  change already delivers with no server risk. Worth a follow-up if another consumer is later found
  relying on `id` for the same kind of merge — noted as an open question below rather than done here.
- *Alternative considered:* stop invalidating `runEvents` on `run.event` (`events.ts:352`). Rejected
  — that invalidation is correct and needed (it is how a persisted view ever learns about new rows at
  all, e.g. a surface that mounts the query without a live tail); the bug is the merge's assumption,
  not the invalidation.

## Risks / Trade-offs

- **`seq` uniqueness is a DB-level invariant this change now relies on client-side.** It already is
  one (`UNIQUE (run_id, seq)`), so this is documenting reliance on an existing guarantee, not adding a
  new coupling. If that constraint were ever relaxed, this merge would need to change too — noted
  inline in the helper's comment.
- **A runtime adapter that genuinely emits the same narration text twice, as two distinct events with
  two distinct `seq` values, still renders twice.** That is correct: `seq`-based dedup only removes a
  duplicate of the *same* row seen through two paths, not two different rows that happen to carry the
  same text. `assistant.thinking` blocks never merge across blocks regardless of source, so a runtime
  genuinely repeating itself would still be visible — that is a runtime concern, not a rendering bug,
  and out of scope for this ticket.
- **`RunTranscript`'s reuse.** Since `RunTranscript` (ticket/run pages) already goes through
  `useRunEventStream`, it gets both fixes for free with no direct change to `RunTranscript.tsx`
  itself — verified by reading its usage, not assumed; a test exercises it directly rather than
  relying on that inference alone.

## Migration Plan

UI-only; no data migration, no schema change, no server change. Existing sessions and already-open
tabs pick up the fix on next reload; nothing to roll back beyond the commit.

## Open Questions

None blocking this change. Flagged for a possible follow-up, not decided here: whether
`emitRunEvent`/`record()` should carry the row's real database id instead of `String(seq)`, so `id`
itself stops being a synthetic, per-run-only value — out of scope because the `seq`-based merge fully
resolves the defect this ticket reports without touching the engine.
