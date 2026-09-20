## 1. The label

- [x] 1.1 In `packages/render/src/liveTurn.ts` change the `waiting` state's `label` and `PROGRESS_WORD.waiting` from `Waiting for the model` to `Working`; leave the state id, every other label and the elapsed/tool-count formatting untouched
- [x] 1.2 Update the behaviour-describing comments that quote the old phrase in `packages/render/src/liveTurn.ts`, `packages/core/src/activity/index.ts`, `packages/ui/src/components/LiveActivity.tsx` and `packages/tui/src/components/ActivityLine.tsx` so no user-visible or current-behaviour string in code still reads "waiting for the model"
- [x] 1.3 Verify no source matches on the label text rather than the state (`rg` for `Waiting for the model` and any label comparison); the only hit that remains in code is history, and no user-visible string remains

## 2. Consumers and their tests

- [x] 2.1 Update `packages/render/src/liveTurn.test.ts`: every `Waiting for the model` golden becomes `Working` for `liveTurn`, `liveTurnLine`, `liveActivityLine` and `progressLine`, and the test names read as working
- [x] 2.2 Update the web tests and fixtures that assert the old wording: `packages/core/src/activity/activity.test.ts`, `packages/ui/src/test/workerActivity.test.ts`, `packages/ui/src/test/activeRunLine.test.ts`, `packages/ui/src/test/v2work.test.tsx`, `packages/ui/src/components/RunTranscript.test.tsx` — each asserts `Working` on the `waiting` state, and the v2work card case asserts the row is never a bare status word
- [x] 2.3 Update the terminal and channel tests: `packages/tui/src/components/ActivityLine.test.ts`, `packages/tui/src/apps/Top.test.ts`, `packages/cli/src/commands/runs.test.ts`, `packages/server/test/channels.test.ts` — each asserts `Working` (with seconds and tool count) for the `waiting` state, including the channel progress text
- [x] 2.4 Run the changed packages' tests (`pnpm vitest run packages/render packages/core packages/ui packages/tui packages/cli packages/server`) and confirm green

## 3. Evidence and closing

- [x] 3.1 Capture rendered evidence from a scratch harness outside the worktree — the live row between steps in a persistent session, the weaver chat and the planner chat, light and dark, each reading `Working` with its seconds; open each image and confirm it shows what is intended before attaching all of them to the ticket with `weave_ticket_attachment_put`
- [x] 3.2 Run `pnpm lint && pnpm typecheck` and one full `pnpm test` with `--maxWorkers=4`; paste both suite blocks (core/server and UI) verbatim in the report
- [x] 3.3 Confirm `git status --porcelain` in the worktree is empty before delivery (screenshots and scratch files live outside `work/`)