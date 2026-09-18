## Why

The V2 Live floor is the one screen where you watch several agents at once, and it is the one place
that cannot tell you any of them is about to fill its context window. The weaver chat's finished-turn
summary and the run page both show a worker's context size against its model's window through
`contextStrip`, and the automatic compaction policy already acts on exactly that number — but Live
renders nothing of the kind.

## What Changes

- Every Live card gains a compact context line: the worker's context size, the model's window and
  how full it is, with a visible mark at the runtime's compaction point.
- The size is the worker's active-session `last_context_tokens` — the last completed turn's size,
  written from the turn's reported usage and read by the automatic compaction policy — carried on the
  worker list so a card can show it while a new turn is running. The line is labelled as the last
  completed turn, never as a live count.
- The proportion comes from `contextStrip` in `packages/render`, the same view-model the weaver chat
  and run page use, so the two surfaces cannot report different numbers for the same turn. A small
  `ContextMeter` renders that view-model; it is not a second context meter.
- A model whose window the runtime cannot state (OpenCode) shows the count and says the window is
  unknown — no fabricated denominator, and the row is not hidden.
- The line stays one line at phone width and does not reflow the grid, the feed heights or the
  toolbar.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-v2/live`: a Live card states the worker's context size against its model's window, including
  the runtime's compaction point, or the count with the window stated as unknown.

## Impact

- `packages/server/src/routes/workers.ts` — the workers list carries each listed agent's active
  session `last_context_tokens` (one grouped read per call); `docs/API.md` updated.
- `packages/ui/src/api/types.ts`, `packages/ui/src/api/hooks.ts` — `WorkerListItem` gains the field.
- `packages/ui/src/lib/board.ts` — `liveWorkingAgents` becomes generic so the extra field survives.
- `packages/ui/src/components/ContextMeter.tsx` (new) — renders a `ContextStripView`.
- `packages/ui/src/v2/LivePage.tsx` — resolve the window and compaction point per card and render
  the meter.
- Tests: the workers route, `ContextMeter`, and `v2live.test.tsx`.
- No database migration and no new route; the added list field is additive.
