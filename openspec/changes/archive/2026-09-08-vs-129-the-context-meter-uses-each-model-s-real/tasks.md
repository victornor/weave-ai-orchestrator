## 1. Correct the Claude adapter's declared context windows

- [x] 1.1 In `packages/runtimes/claude/src/adapter.ts`, replace the single `CONTEXT_WINDOW_TOKENS`
  constant with two (200k standard, 1M native), update the doc comment above the table to state the
  evidence source (design.md) instead of "every model shares 200k today," and set
  `contextWindowTokens` per entry per the table in `design.md`: `fable`, `opus`, `sonnet`,
  `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5` → 1,000,000; `haiku`,
  `claude-haiku-4-5-20251001` → 200,000 (unchanged). Verify with `pnpm typecheck` and a read-through
  of the diff against the design.md table.
- [x] 1.2 Add a test in `packages/runtimes/claude/test/adapter.test.ts` asserting `listModels()`
  returns the corrected `contextWindowTokens` for every entry (both the 1M and the 200k ones), so a
  future edit to the table cannot silently drift back to a single shared constant. Verify with
  `pnpm vitest run packages/runtimes/claude`.

## 2. Stop clamping an over-window measurement to 100%

- [x] 2.1 In `packages/render/src/usage.ts`, remove the upper `Math.min(100, ...)` bound from both
  `percent` and `toCompaction` in `contextStrip` (keep the `Math.max(0, ...)` floor), and update the
  doc comments on `ContextStripView.meter.percent`/`toCompaction` in `packages/render/src/types.ts`
  to state the value can exceed 100 when the declared window is contradicted by the measurement, and
  why. Verify by reading the diff — no behaviour change for `tokens <= window`.
- [x] 2.2 Update the existing test `packages/render/src/usage.test.ts` `'clamps a context that has
  outgrown the numbers we were given'` to assert the new uncapped behaviour (500,000 tokens against a
  200,000 window → `percent: 250`, `toCompaction` computed the same uncapped way, `tone: 'over'`), and
  rename it to describe what it now verifies. Verify with `pnpm vitest run packages/render`.
- [x] 2.3 Add the three test cases the ticket calls for to `packages/render/src/usage.test.ts`: (a) a
  known large (1M) window reporting a correct, unclamped fraction for a mid-range measurement; (b) a
  model with no declared window (`contextWindowTokens: null`/`undefined`) rendering the existing
  `reason: 'Context window unknown'` state — confirms the already-correct "unknown" path is unaffected
  by this change; (c) the over-window case's `percent`/`toCompaction` staying uncapped past 100, with
  `tone: 'over'`. Verify with `pnpm vitest run packages/render`.

## 3. Keep the meter's bar from overflowing its own space

- [x] 3.1 In `packages/ui/src/components/ContextMeter.tsx`, clamp only the bar's CSS `width` to
  `Math.min(100, view.meter.percent)` (and, if a bar is ever added for `toCompaction`, the same
  there); leave the percentage text and the `title` hover text showing the true, uncapped number from
  `view.meter.percent`/`toCompaction`. Verify by reading the diff.
- [x] 3.2 Add a test in `packages/ui/src/test/contextMeter.test.tsx` covering a `view` whose
  `meter.percent` is over 100 (e.g. 250): the bar's rendered width style is capped at 100%, the
  visible percentage text reads `250%`, and the tone class matches `'over'`. Verify with
  `pnpm --filter @agent-conductor/ui exec vitest run`.

## 4. Verify and deliver

- [x] 4.1 Run `pnpm typecheck`, `pnpm lint`, `pnpm test` (root, which chains the ui suite) and confirm
  all green.
- [x] 4.2 State in the PR description the corrected context window declared for each of the eight
  `MODELS` entries and the evidence for each (from `design.md`), and the one caveat about the baked-in
  catalog vs. a possible live-served catalog override that could not be checked from inside this role.

## 5. Lead the meter with the raw count, per captain's review (2026-09-08)

- [x] 5.1 In `ContextMeter.tsx`, replace the percent-of-window headline with `view.tokensLabel`; keep
  the bar (proportion, capped at its own edge) and the compaction percentage in words (uncapped) as
  the only percentage the header states. When the window is unknown but the size is known, show the
  bare count instead of the quiet "window unknown" line; keep the quiet line only when no size is
  known at all. Verify with `pnpm typecheck` and a read-through of the diff.
- [x] 5.2 Update `contextMeter.test.tsx` and the two `ContextMeter`-facing assertions in
  `chat.test.tsx` to match: headline is the count, not a percentage; the bare-size case when the
  window is unknown; the over-window case shows the compaction percentage uncapped beside an
  unaffected headline count. Verify with `pnpm --filter @agent-conductor/ui exec vitest run`.
- [x] 5.3 Update the `conductor-chat/session-limit` spec delta's scenarios to match the new rendering,
  and re-run `pnpm typecheck && pnpm lint && pnpm test` (root) to confirm everything is still green.
