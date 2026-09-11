## 1. Read the live-input status in the attach view

- [x] 1.1 In `packages/tui/src/apps/Attach.tsx`, add an `input` field to the local `WorkerDetail` type, structurally `{ midTurn: boolean; reason?: string }`. The existing detail fetch already spreads the payload (`setDetail({ ...record, agent })`), so the field flows through without an extra request. Verify with `pnpm typecheck`.

## 2. The pre-send label

- [x] 2.1 Add an exported pure `preSendLabel(input: { midTurn: boolean; reason?: string } | null | undefined): string | null` next to `deliveryNotice`, returning `null` when the status is absent, `'Reaches the running turn immediately.'` when `midTurn`, and the web app's queued sentence with ` — <reason>` when a reason exists. Verify by reading it against `WorkerPage.tsx:92`'s literals.

## 3. Render it and refresh it

- [x] 3.1 Render the label as a dim status line above the input, in command and insert mode alike, whenever `preSendLabel` is non-null; make the placeholder a neutral `steer the worker` (conductor keeps `message the conductor`). Reduce `maxLines` by one while the line is shown so the transcript absorbs the difference. Verify with `pnpm typecheck` and by reading the JSX.
- [x] 3.2 In the workspace-stream handler's `run.started` branch, bump `nonce` for this agent's run so the label refetches when a turn begins; leave the existing `worker.status`/`run.finished` bumps as they are. No interval or timer is added. Verify by reading the diff: the only new refetch source is `run.started`.

## 4. Tests

- [x] 4.1 In `packages/tui/src/apps/Attach.test.ts`, add cases for `preSendLabel`: `{ midTurn: true }` → the mid-turn sentence; `{ midTurn: false, reason: '…' }` → the queued sentence with the reason; `{ midTurn: false }` → the queued sentence with no invented reason; `null`/`undefined` → `null`. Verify with `pnpm vitest run packages/tui/src/apps/Attach.test.ts`.
- [x] 4.2 Confirm the existing `deliveryNotice` tests in the same file still pass unmodified. Verify with the same command.

## 5. Full verification

- [x] 5.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`, and paste both suite blocks verbatim with their real totals in the delivery report.
