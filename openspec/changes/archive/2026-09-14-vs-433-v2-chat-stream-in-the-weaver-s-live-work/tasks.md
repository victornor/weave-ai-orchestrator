# Tasks — VS-433

## 1. Reveal helpers

- [x] 1.1 `packages/ui/src/lib/streamReveal.ts`: make `useStreamReveal` follow growth — a linear ramp
      from the characters already shown to the new end, extended on each `full` change, so the visible
      prefix never shortens and never restarts. VS-425's reply behaviour is unchanged.
- [x] 1.2 Add `useNewLiveIds(events)`: the ids of run events whose `seq` is above the highest `seq`
      present at mount, so only a line that arrived while watching reveals.

## 2. The live trace

- [x] 2.1 `packages/ui/src/v2/ChatTrace.tsx`: `ChatTrace` takes `reveal` (default `false`) and computes
      the new ids; `TraceLine` reveals its text and a single `ToolRow` reveals its target; a tool group
      and its children stay whole.
- [x] 2.2 `packages/ui/src/v2/ChatPage.tsx`: pass `reveal` to the live `<ChatTrace>` only;
      `ChatTurnTrace` is untouched, so past turns never animate.

## 3. Tests and verification

- [x] 3.1 `packages/ui/src/test/streamReveal.test.ts`: a growing line's prefix only lengthens, and the
      existing VS-425 reply-reveal tests still pass.
- [x] 3.2 `packages/ui/src/test/v2chattrace.test.tsx`: a line arriving while watching reveals as a
      prefix then the whole text; lines present at mount and a `ChatTurnTrace` render whole; reduced
      motion renders whole.
- [x] 3.3 `pnpm lint && pnpm typecheck` green; both suites run and pasted verbatim.
- [x] 3.4 Evidence: real-browser captures (stubbed run events) in dark and light — a line mid-reveal,
      the same line settled, a growing line at two moments, and a mid-turn join with existing lines
      whole. Absolute paths in the PR.
