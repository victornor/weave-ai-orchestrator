# Tasks

## 1. Carry the session context size on the worker list

- [x] 1.1 In `packages/server/src/routes/workers.ts`, read each listed agent's active session
  `last_context_tokens` in one grouped query (`WHERE status = 'active' AND agent_id IN (…)`) and add
  `lastContextTokens: number | null` to every item. Verify with a route test that a worker with a
  recorded size carries it and a worker without an active session carries `null`.
- [x] 1.2 Add `lastContextTokens?: number | null` to `WorkerListItem` in
  `packages/ui/src/api/hooks.ts` (the type is declared beside `useWorkers`). Verify with
  `pnpm typecheck`.
- [x] 1.3 Make `liveWorkingAgents` in `packages/ui/src/lib/board.ts` generic
  (`<T extends Agent>(workers: readonly T[]): T[]`) so the list's extra fields survive into the page
  cell input, and confirm both existing callers still typecheck. Verify with `pnpm typecheck`.
- [x] 1.4 Update the `GET /workers` entry in `docs/API.md` to name the new list field. Verify by
  reading the entry back.

## 2. The shared meter component

- [x] 2.1 Add `packages/ui/src/components/ContextMeter.tsx` that takes a `ContextStripView` (from
  `@weave-ai/render`) plus the runtime's compaction fraction, and draws a compact track bar sized to
  `meter.percent` (fill clamped to 100), a marker at the compaction fraction, the
  `tokensLabel` / `windowLabel` text and a `last turn` label; with `meter === null` it draws the
  count and the view's `reason` and no bar. Verify with a jsdom render test asserting the fill width,
  the marker position and the text for a known window, and the no-bar count line for an unknown one.
- [x] 2.2 Add the colocated test `packages/ui/src/components/ContextMeter.test.tsx` (the UI vitest
  include is `src/**/*.test.tsx` only) covering the near-window tone, the unknown-window state and a
  `null` view. Verify with `pnpm vitest run packages/ui src/components/ContextMeter` (or the UI
  suite).

## 3. Render it on the Live floor

- [x] 3.1 In `packages/ui/src/v2/LivePage.tsx`, add `contextTokens` and `runtimeId` to
  `LiveCellInput`, fill them from the `WorkerListItem` in the cells builder, and in `LiveCard` resolve
  the model window (`resolveModel(useRuntimeModels(run?.runtimeId ?? cell.runtimeId), run?.model)`)
  and `compactionAt` (`useRuntimes()` → the runtime's `capabilities['contextCompactionAt']`), build
  the `contextStrip` view and render `ContextMeter` on a fixed one-line strip between the ticket line
  and the feed. Verify by rendering `LiveBody` and asserting the meter appears on a card with a
  recorded size and is absent for one without.
- [x] 3.2 Extend `packages/ui/src/test/v2live.test.tsx`: seed `lastContextTokens` on a worker and a
  model with a `contextWindowTokens` in the mocked `useRuntimeModels`, add the now-required
  `useRuntimes` mock, and assert the known-window card shows the size, window and compaction marker,
  the unknown-window card shows the count with the unknown wording and no bar, and a worker with no
  recorded size shows no line. Verify with the UI suite.
- [x] 3.3 Confirm the context strip cannot reflow the floor: at phone width it stays one line and the
  grid's `data-cols`, the feed heights and the toolbar controls are unchanged. Verify with the
  existing phone assertions in `v2live.test.tsx` plus a one-line/no-wrap assertion on the new strip.

## 4. Visual verification and checks

- [x] 4.1 Render the Live floor (light and dark, desktop and phone) with one agent near its window
  and one well under it, using the `ui-screenshot-harness` procedure; produce the captures outside
  the worktree and attach them to this ticket with `weave_ticket_attachment_put` (never commit binary
  review assets). Verify each attached capture appears on the ticket.
- [x] 4.2 Confirm the meter's figure matches the run page / weaver chat for the same completed turn
  in the seeded capture data, and note the compaction-boundary exception from design.md in the PR.
  Verify by reading the seeded data and the captured card text together.
- [x] 4.3 Run `pnpm lint`, `pnpm typecheck` and `pnpm test`; paste both the core/server and the UI
  suite blocks verbatim in the report.
