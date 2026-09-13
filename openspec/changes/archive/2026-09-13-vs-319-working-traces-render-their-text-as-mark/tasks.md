## 1. Reproduce the duplicate paragraph before changing anything

- [x] 1.1 Write a failing test against the real merge path — `packages/ui/src/api/runStream.ts`'s
      `useRunEventStream` (or a focused unit test of its merge once extracted, see 3.1) — that
      reproduces the mechanism found in `design.md`: a persisted `useRunEvents` response and a live
      SSE tail each carrying the *same* underlying row (same `seq`, different `id` — one the row's
      real autoincrement id, one `String(seq)`, matching what `packages/core/src/runs/engine.ts:218`
      and `packages/ui/src/api/runStream.ts` actually produce today), delivered in an order that
      matches the real sequence (tail delivers first, persisted refetch arrives after, exactly what
      `packages/ui/src/api/events.ts:352`'s invalidation causes). Confirm the test fails against the
      current `.id`-keyed merge before touching source, per the project rule to write patterns from
      real behaviour, not a guessed shape.

      Done: added `'does not duplicate a row the persisted query re-fetches after the live tail
      already delivered it'` to `packages/ui/src/test/runStream.test.tsx`. Confirmed it fails
      against the current code: `expected [...] to have a length of 1 but got 2` — the exact
      mechanism from `design.md`, not a guessed shape.
- [x] 1.2 State the confirmed root cause in the ticket (a comment is enough for this task): the
      `id` mismatch between a persisted row and its live emission, and the `runEvents` invalidation
      that makes the two overlap mid-turn. `design.md` already has the file:line evidence; this task
      is about confirming it reproduces, not re-deriving it.

      Done: stated on the ticket in the propose-turn comment (2026-09-13T14:41), confirmed now by
      1.1's reproduction.

## 2. Text blocks render as markdown

- [x] 2.1 In `packages/ui/src/components/Transcript.tsx`, change `TranscriptLine`'s `text` case to
      render `block.text` through `Markdown` (`breaks` on, matching `MessageBody`'s choice for chat
      text) instead of the plain `<p className="whitespace-pre-wrap …">`, keeping the
      thinking-vs-non-thinking dim/italic className on `Markdown`'s wrapper. Verify with a unit test
      (new or extended `packages/ui/src/components/Transcript.test.tsx`): a text block containing
      `**bold**`, a `` `code span` ``, and a `1. item` list renders as `<strong>`, `<code>`, and an
      `<ol><li>` respectively, not as literal markup characters; a thinking block keeps its dimmed/
      italic wrapper.

      Done: `packages/ui/src/components/Transcript.tsx`'s `text` case now renders `<Markdown
      source={block.text} breaks className={cx(..., block.thinking ? 'text-text-3 italic' : ...)}
      />`. Tests added to `packages/ui/src/test/transcript.test.tsx`: `'renders a live text block
      through markdown, matching a finished message'` and `'keeps a thinking block dimmed and
      italic while still rendering its markdown'`. Full file green: 52/52.
- [x] 2.2 Verify a partially streamed block does not crash and settles correctly: a unit test that
      renders a block whose text is an unclosed `**bold`, one whose text is an unfinished list item
      (`1. Ste`), and one whose text is an unclosed fenced code block, asserting each renders without
      throwing; then re-renders the same block with the rest of the text appended and asserts it now
      renders the completed formatting (closed bold, full list item, closed code block).

      Done: three tests added (`'renders a block with an unclosed bold marker...'`, `'renders an
      unfinished list item...'`, `'renders an unclosed fenced code block...'`), each rendering the
      partial state then `rerender`-ing with the completed text on the same block id and asserting
      the settled markup. No new production code needed beyond 2.1 — `markdownToHtml` re-parses the
      block's full current text on every render already, confirmed by these tests rather than
      assumed.
- [x] 2.3 Verify trace text is not executed as HTML: a unit test renders a block whose text contains
      a raw `<img onerror=...>`-shaped string and asserts no script/handler attribute reaches the
      DOM — the same guarantee `Markdown`/`markdownToHtml`'s existing escaping already gives finished
      messages, exercised here for the trace path specifically since the ticket calls it out as an
      acceptance criterion.

      Done: `'renders untrusted trace text as inert, never as executed markup'` asserts no `<img>`
      element exists in the DOM and the literal text is shown instead.

## 3. Fix the duplicate at its source: merge by `seq`, not by `id`

- [x] 3.1 Add an exported, pure `mergeRunEvents(persisted, live): RunEvent[]` (in
      `packages/ui/src/api/runStream.ts` or a sibling module) that dedupes by `seq` and returns the
      result sorted by `seq`, with a comment naming the invariant it relies on
      (`UNIQUE (run_id, seq)`, `packages/db/src/migrations/0001_init.sql:126`) and why `id` cannot be
      used (persisted rows carry the DB row id; live emissions carry `String(seq)` —
      `packages/core/src/runs/engine.ts:218`). Verify with the unit test from 1.1, now passing, plus:
      two events with different `seq` are both kept; an event present in both inputs with matching
      `seq` but different `id` collapses to one; input order does not affect the output order (always
      sorted by `seq`).

      Done: `mergeRunEvents` added to `packages/ui/src/api/runStream.ts`. Direct unit tests added
      (`describe('mergeRunEvents', ...)` in `runStream.test.tsx`): different-seq kept, same-seq/
      different-id collapses to one, output always seq-ordered regardless of input order.
- [x] 3.2 Rewrite `useRunEventStream` (`packages/ui/src/api/runStream.ts`) to build its `events` memo
      via `mergeRunEvents(persisted.data ?? [], tail)` instead of the current by-`id` `Set`. Verify
      `packages/ui/src/test/runStream.test.tsx` (existing cases) still passes, plus the new
      persisted-refetch-overlaps-tail case from 3.1 exercised through the real hook.

      Done: the `events` memo now reads `mergeRunEvents(persisted.data ?? [], tail)`. Full file
      green: 13/13, including the 1.1 reproduction case now passing.
- [x] 3.3 In `packages/ui/src/routes/WorkerPage.tsx`, replace `const events = [...(persisted.data ??
      []), ...live]` with `mergeRunEvents(persisted.data ?? [], live)`, leaving `live`'s own
      same-frame append guard untouched. Verify with a new case in
      `packages/ui/src/test/workerPage.test.tsx`: seed `persisted.data` and a `run.event` frame that
      describe the same row (same `seq`, differing `id`, matching the real shape) and assert the
      rendered transcript shows it once, not twice.

      Done: `WorkerPage.tsx`'s `events` now reads `mergeRunEvents(persisted.data ?? [], live)`.
      Added `'WorkerPage transcript merge (VS-319)'` with a real `useWorkspaceEvents` bus (mirroring
      `chat.test.tsx`'s pattern) so the test emits a genuine `run.event` frame rather than calling
      `setLive` directly. Confirmed against the pre-fix code (temporarily set aside with `git
      stash`, restored after) that the test fails there: `expected 1 but got 2`.
- [x] 3.4 Verify `packages/ui/src/test/liveTranscript.test.tsx` (TicketPage/RunPage, via
      `RunTranscript` → `useRunEventStream`) still passes unmodified, confirming those surfaces
      inherit the fix through the shared hook with no direct change needed there.

      Done: `liveTranscript.test.tsx` (6 tests) and `workerPage.test.tsx` (15 tests) both green
      together, no changes needed to `liveTranscript.test.tsx` or `RunTranscript.tsx`.

## 4. Spec and verification

- [x] 4.1 Confirm the spec delta in `specs/conductor-chat/live-turn-stream/spec.md` matches what was
      actually built: the markdown scenarios against 2.1-2.3, the duplicate-prevention scenarios
      against 3.1-3.3. Amend the delta if implementation diverged from the design during apply.

      Done: checked against the actual diff — implementation matched the design with no divergence,
      so the spec delta stands unamended.
- [x] 4.2 Run `pnpm lint`, `pnpm typecheck`, and both test suites (`pnpm test` for core/server, then
      `pnpm --filter @weave-ai/ui exec vitest run` for the UI suite run separately since a red
      core run would otherwise hide the UI summary) — paste both suite blocks verbatim, with their
      real totals, in the delivery report. Do not add the two totals together and do not report only
      one block as "both".

      Done: `pnpm lint` and `pnpm typecheck` both clean. Core/server suite: 180 files passed | 1
      skipped (181), 2704 tests passed | 1 skipped (2705). UI suite: 98 files passed (98), 1613
      tests passed (1613). Both pasted verbatim in the delivery comment.
