## 1. Detect the report block

- [x] 1.1 In `packages/ui/src/lib/transcript.ts`, add a `report` variant to `TranscriptBlock`
      carrying the parsed `RunReport` and the original raw text, and after building the block list
      in `runEventsToTranscript`, replace the last block with it when that block is `type: 'text'`
      and `extractReport` (from `@agent-conductor/shared`) parses its text successfully. Verify with
      a unit test in `packages/ui/src/lib/transcript.test.ts` (or the nearest existing test file for
      this module) asserting a run ending in a fenced ```json report produces a trailing `report`
      block, not a `text` block.
- [x] 1.2 Verify assistant text that does not parse as a report is unaffected: add a test asserting
      an ordinary trailing text block still comes out as `type: 'text'`.

## 2. Render the report block collapsed

- [x] 2.1 In `packages/ui/src/components/Transcript.tsx`, add a `report` case to `TranscriptLine`
      rendered with the same collapsed-head/expandable-body shape as the `tool` case: collapsed
      shows a status glyph (mapping `RunReport.state` to `UiStatus` per `design.md`, with
      `needs_decision` → `needs-you` and `paused` → `stalled`) plus the report's `summary`,
      truncated; expanded shows the raw JSON text styled like `DiffBlock`. Verify by rendering a
      `report` block in a component test and asserting the collapsed row shows the summary text and
      no raw JSON, and that clicking it reveals the JSON.
- [x] 2.2 Verify existing `tool` and `text` block rendering in `Transcript.tsx` is unchanged (run the
      existing `Transcript`/`RunTranscript` test suite and confirm no assertions had to change for
      unrelated block types).

## 3. End-to-end check

- [x] 3.1 Using the `ui-screenshot-harness` approach (see project knowledge base), render a
      `Transcript` with a fixture event stream ending in a real end-of-turn report and confirm
      visually that the collapsed one-line detail appears in place of the raw JSON paragraph,
      including at phone width. Capture a before/after screenshot as the ticket's verification asks.
- [x] 3.2 Run `pnpm --filter @agent-conductor/ui test`, `pnpm lint`, and `pnpm typecheck`; all green.
