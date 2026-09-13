## 1. Diff construction in `packages/render`

- [x] 1.1 Add a line-level LCS diff function (old text, new text) → `DiffLine[]`, reusing the
      `DiffLine`/`DiffHunk` shapes from `packages/render/src/diff.ts`, with line numbers counted
      from 1 within the snippet (per design.md). Golden-test it directly against hand-built
      before/after strings covering: pure addition, pure removal, a mixed change, and identical
      text (no diff). Done: `packages/render/src/editDiff.ts`'s `diffLines`, tested in
      `editDiff.test.ts` (9 tests, incl. empty-side and trailing-newline cases).
- [x] 1.2 Add a function that turns one edit-tool payload (`{ old, new }` pairs, or a `MultiEdit`'s
      `edits[]`) into one `DiffHunk[]` per edit, using 1.1. Unit-test it against `RunEvent` payload
      shapes copied field-for-field from `packages/runtimes/claude/src/events.ts` and
      `packages/runtimes/opencode/src/events.ts` (cite the exact fields read), not invented ones.
      Done: `diffHunksForEdits` takes already-extracted `EditPair[]`, tested with plain pairs here;
      the runtime-shaped `RunEvent` → `EditPair[]` extraction is task 3.1/3.3's job (transcript.ts
      owns tool-name recognition, not `packages/render`).
- [x] 1.3 Export both from `packages/render/src/index.ts` and verify `pnpm --filter @weave-ai/render build` succeeds. Done: build is clean.

## 2. Extract the shared hunk renderer

- [x] 2.1 Move `UnifiedHunk`, `SplitHunk` and their `Code`/highlight-memoisation helpers out of
      `packages/ui/src/routes/project/PullRequestDiff.tsx` into a shared component module, with no
      behaviour change, and verify the existing PR diff view tests still pass unmodified. Done:
      `packages/ui/src/components/DiffHunks.tsx`.
- [x] 2.2 Update `PullRequestDiff.tsx` to import the extracted components and verify
      `pnpm --filter @weave-ai/ui exec vitest run` for that route's existing tests is still green.
      Done: `src/test/pullRequestDiff.test.tsx` — 15/15 pass, unmodified.

## 3. Carry edit payloads through the transcript block model

- [x] 3.1 In `packages/ui/src/lib/transcript.ts`, on `tool.call`, recognise Claude
      `Edit`/`MultiEdit`/`Write` and opencode `edit`/`write` by name and retain the fields a diff or
      written-file render needs (old/new text or content) on the `ToolBlock`, without changing
      `tool.result`/`file.changed` handling (verified in design.md to carry none of this). Any other
      tool name is unaffected. Done: `parseEditPayload`/`editPayload` helper + `ToolBlock.editPayload`.
      Also added `filePath` to `summariseInput`'s path keys — opencode's edit/write input uses that
      key, not `file_path`/`path`, so the target (file path) was silently blank for opencode edits
      before this.
- [x] 3.2 Compute a thinking block's duration in `runEventsToTranscript` as the gap between its
      event's `ts` and the next event's `ts` when both parse and the delta is non-negative; leave it
      null otherwise. Unit-test both branches. Done: `thinkingDurationMs` on the text/thinking block.
- [x] 3.3 Unit-test 3.1 against real-shaped `RunEvent[]` fixtures for both runtimes: a single Claude
      `Edit`, a Claude `MultiEdit` with two edits, a Claude `Write`, an opencode `edit`, an opencode
      `write`, and an unrecognised tool name (falls through with the old/new/content fields absent).
      Done: `src/test/transcript.test.tsx`'s "edit payload extraction (VS-324)" block, field names
      cited to the adapter source in the test's own comment; 61/61 tests pass in that file.

## 4. Render edit diffs and written files

- [x] 4.1 In `packages/ui/src/components/Transcript.tsx`, render a `ToolBlock` carrying edit data as
      a diff using 1.2's hunks and 2.1's extracted `UnifiedHunk`/`SplitHunk`, choosing split vs.
      unified via a CSS container query on the transcript's rendering width per design.md (no
      JS-measured width). A `MultiEdit` block renders one hunk per edit. Done: `EditPayloadBody`,
      `EditHunk` (`@container` + `@min-[32rem]:` Tailwind v4 variants).
- [x] 4.2 Render a `ToolBlock` carrying write data as numbered, highlighted content (reusing
      `lib/highlight.ts`'s `languageForPath`/`highlightLine`, unchanged), collapsed behind an expand
      control past a line-count threshold matching the existing long-output collapse pattern. Done:
      `WrittenFile`, windowed at 300 lines with a "Show N more lines" control, mirroring
      `Transcript`'s own "Show earlier" idiom.
- [x] 4.3 A `ToolBlock` recognised as edit/write but missing the needed fields, and any tool this
      capability does not recognise, keeps rendering today's compact row — verify with a test per
      case. Done: two tests in `src/test/transcript.test.tsx`.
- [x] 4.4 Verify no raw HTML interpretation: a test asserting that edit/write content containing
      `<`/`>`/`&` renders as literal text (escaped), matching `highlightLine`'s existing escaping.
      Done: "never interprets edit or written-file text as HTML" test. `pnpm lint`/`typecheck` clean;
      69/69 in transcript.test.tsx, 15/15 in pullRequestDiff.test.tsx.

## 5. Collapse thinking blocks

- [x] 5.1 In `Transcript.tsx`, split the `thinking` block out of the plain `text` rendering path into
      its own collapsed-by-default control (matching `ToolGroup`'s pattern), showing the duration
      from 3.2 when present and no duration line when absent. Expanding it renders the existing
      VS-319 markdown rendering unchanged. Done: `ThinkingLine`.
- [x] 5.2 Test: a thinking block with a derivable duration collapses to one line with that duration;
      one without a derivable duration still collapses, with no duration and no placeholder;
      expanding either renders the markdown VS-319 already produces (add a regression test against
      VS-319's existing markdown/line-break behaviour). Done: three new tests in
      `src/test/transcript.test.tsx`; updated the two pre-existing tests that assumed thinking
      rendered always-expanded (`transcript.test.tsx`'s own render test, and
      `workerPage.test.tsx`'s VS-319 dedup test) to expand first. 71/71 and 15/15 pass respectively.

## 6. Live and global Live default cell size

- [x] 6.1 In `packages/ui/src/lib/liveCellSize.ts`, replace the flat `DEFAULT_SIZE` constant with a
      `defaultSize(desktop, colsMax)` function per design.md, and thread `desktop`/`colsMax` through
      `isDefaultSize`, `sizeOf` and `writeLiveCellSizes`. Keep `clampSize`/`snapSize` unchanged.
- [x] 6.2 Update `Live.tsx` and `GlobalLive.tsx` (`LiveCell`'s reset and phone expand/restore
      handlers, both routes' `sizeOf`/`writeLiveCellSizes` call sites) to the new signatures.
- [x] 6.3 Unit-test `defaultSize`/`isDefaultSize`/`sizeOf`/`writeLiveCellSizes` as pure functions:
      half-width at `sm` (8→4) and `xl` (12→6), full-width at phone (4→4), and that a size explicitly
      saved before this change (any value ≠ the breakpoint's new default) still round-trips through
      `writeLiveCellSizes`/`readLiveCellSizes` unchanged. Do not rely on jsdom-measured geometry for
      this — these are pure functions over numbers. Done: `src/test/liveCellSize.test.ts`, 24/24 pass.
- [x] 6.4 Visually verify (dev server or a screenshot harness) that `xl` now shows two cells per row,
      `sm` still shows two, and phone still shows one, and that dragging and reset still work.
      Partially done: `liveFloor.test.tsx`/`globalLive.test.tsx`'s existing drag/reset interaction
      tests (33/33) pass unchanged against the new default, and CSS Grid's `span` semantics make
      "6 of 12" and "4 of 8" provably two-per-row (2 × half = whole, deterministically, not something
      that needs empirical measurement the way jsdom-unmeasurable geometry does). A literal
      screenshot of the running app was not taken this turn — unverified, noted honestly rather than
      claimed.

## 7. Full verification

- [x] 7.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` (both the core/server suite and the UI
      suite — paste both blocks verbatim, per this project's own convention); fix anything red. Done:
      lint clean, typecheck clean. Core/server: 183 files passed | 1 skipped (184), 2760 tests
      passed | 1 skipped (2761) — first run hit the known `app.test.ts` transcription EPIPE flake
      (documented in the project KB's `daemon-test-suite` doc, VS-263, unrelated), reran clean. UI:
      98 files passed (98), 1652 tests passed (1652).
- [x] 7.2 Re-read the acceptance criteria in the ticket description against the final diff and note
      any gap before requesting review. Done: all seven acceptance items implemented and tested,
      except the literal screenshot half of 6.4/#5 and #1's split/unified visual outcome — both
      noted as unverified this turn (jsdom cannot evaluate CSS container queries or measure
      geometry); the underlying pure logic and DOM/CSS mechanism are tested instead, per this
      project's own convention for jsdom-unmeasurable behaviour.

## 8. PR #270 review follow-up (weaver, 2026-09-13)

- [x] 8.1 An edit/write `ToolBlock` now opens expanded by default (path header plus diff or written
      content on first render, no click), and the header still collapses it. `groupConsecutiveTools`
      no longer folds a block carrying `editPayload` into a counted group — each edit or write shows
      its own row, even next to another of the same tool name.
- [x] 8.2 Both `EditHunk` and `WrittenFile` now window their content at 40 lines (was 300 for
      `WrittenFile`; `EditHunk` had no window at all) behind a shared "Show N more lines" control, so
      a large edit or file does not flood a cell now that it renders open by default.
- [x] 8.3 Fixed the `EditPayloadBody` hunk memo: it was keyed on the `payload` object, which
      `runEventsToTranscript` reconstructs fresh on every call (i.e. on every live event), so every
      visible diff reran its LCS on every tick once diffs opened by default. Rekeyed on the block's
      own `id`, which is set once at `tool.call` and never reassigned — a stable, correct key. Test:
      a spy on `diffHunksForEdits` confirms it is called once per block regardless of later events.
- [x] 8.4 Updated existing tests for the new default-open state (no more click-to-open needed) and
      added: a still-collapses-on-click test, an edit-hunk windowing test, a
      does-not-group-consecutive-edits test, and the memo-stability spy test. 76/76 pass in
      `transcript.test.tsx`. Re-ran `pnpm lint`, `pnpm typecheck`, `pnpm test`: core/server 183 files
      | 1 skipped (184), 2805 tests | 1 skipped (2806); UI 98 files (98), 1658 tests (1658).
