## Context

See `proposal.md` — Why. This change takes slice 4 (TUI + CLI, audit rows #10–#13) of the VS-602 plan; its `design.md` §1, §4 and §5 are this ticket's brief, and its `liveTurn`/`liveTurnLine`/`clock` are the vocabulary this change reuses and does not fork. VS-602 has merged (`main` `fcd8eea`), so the enriched `worker.activity` payload (`WorkerActivitySummary.live`) and the ephemeral `run.delta` frame exist.

Constraints read from the code at this branch:

- `run.delta` is broadcast **only** on the workspace event stream (`ctx.events.broadcast('run.delta', 'run', runId, frame)` in `runs/engine.ts`); the per-run `/runs/:id/events/stream` route pumps `run.event` only. Every terminal surface therefore needs the workspace `/events` subscription for the live row — `weave attach` and `weave chat` already hold one; `weave runs tail` does not.
- `GET /runs/:id/live` returns `RunLiveSnapshot` (`{ partials: [{ partId, kind, text }] }`) from the engine's in-memory buffer; it is the seed after a reconnect (VS-595).
- `liveTurn` needs the run's **events** too, not just partials: `Running <tool>` and `toolCount` come from `tool.call`/`tool.result`. The terminal surfaces already accumulate events.
- `packages/tui` has no test renderer (`ink-testing-library` is not a dependency); every existing TUI test is a pure-function test. Evidence for a rendered row must be a capture, not a jsdom assertion.
- `GET /workers` currently returns `activity` and `tests` from `WorkerActivitySummary` but **not** `live`, so a fresh `weave top` cannot show the `liveTurn` state until a frame arrives.

## Goals / Non-Goals

**Goals:**

- One implementation of the partial model and one line formatter shared by web, TUI and CLI.
- `weave attach`, `weave chat`, `weave top` and `weave runs tail` show what the agent is doing, from `run.delta` + `GET /runs/:id/live`, per the specs.
- Keep `packages/channels/cli` a no-op transport and the surface adapters untouched; state the headless no-view fact.

**Non-Goals:**

- Rendering the streamed partial **text** in the terminal (the row is the deliverable; `weave attach` already renders completed blocks).
- Any change to the redaction, coalescing or storage of partials; the engine already redacts `run.delta`.
- Telegram and the channel `progress` contract (VS-604).

## Decisions

**1. The partial-output merge moves to `packages/render`, not a second copy.**
`applyDelta`, `fromSnapshot`, `dropSuperseded` and their types move from `packages/ui/src/lib/livePartials.ts` to `packages/render/src/livePartials.ts`; the UI file re-exports them, so its callers and its test are unchanged. *Alternatives:* duplicate ~40 lines in the TUI (a fork of the ordering/gap rules), or have the TUI track only part kinds (re-implements `liveTurn`'s input shape and drops text the CLI may later want). Moving keeps the "one live model" rule.

**2. One composed line helper in `packages/render`.**
Add `liveActivityLine(events, partials, now, opts): string` = `liveTurnLine(liveTurn(...))`. TUI and CLI call it, so the composition is shared as well as the wording; the surface-level pure wrappers the tests exercise are thin.

**3. `weave attach`, `weave chat`: reuse the workspace stream they already hold.**
Each keeps a `PartialMap` seeded from `GET /runs/:id/live` when the run opens and when its workspace subscription reports `connected` again, and applies `run.delta` frames whose `runId` matches. A new Ink `ActivityLine` (one-second `useNow`) renders above the attach status bar and inside the chat working block. The elapsed time ticks on the component's own clock, so a "Waiting for the model" row ages without a network request — the same rule the web row follows. `weave chat` also stores the conductor's `runtimeId` (it currently keeps only the agent id) so `wholeStepsOnly` is correct.

**4. `weave runs tail`: follow the workspace stream for deltas.**
The existing command already subscribes to `/runs/:id/events/stream` for the transcript. It additionally subscribes to `/events` and, for a `run.delta` frame of the followed run, applies it and prints the live line. To avoid flooding the transcript (the engine coalesces at ~50 ms, up to ~20 frames/s), the line is printed **only when its state or label changes**, not on every frame; the completed step is printed by the existing transcript path and the superseded part is dropped. `runtimeId` for `wholeStepsOnly` is read once from `GET /runs/:id`. The live line is written dim so a capture can tell it from transcript output.

**5. `weave top`: carry `live` on the workers read.**
Add `live: activity?.live ?? null` to `GET /workers` (list and detail) — additive, exactly like the existing `activity`/`tests` fields from the same summary. `Top` renders `live.label` + `clock(now − live.since)` when present, falls back to `activity.label` + `activity.since`, then to `statusLabel`; it also folds `worker.activity` frame payloads into a per-agent map so rows move at the activity cadence instead of only on the 15 s refetch. *Alternative:* rely only on frames (first paint wrong) or only on `activity` (loses the state word VS-602 added).

**6. Tests are pure; the render is the evidence.**
Surface tests compose the render helpers and assert the line per state, the `applyDelta` path ("a frame updates the line"), and the `/runs/:id/live` seed ("reconnect recovers"). The Ink component is thin and is verified by text captures, not by a test renderer — consistent with the existing `packages/tui` tests.

## Risks / Trade-offs

- **A printed line per frame would flood `runs tail`** → print only on a state/label change, and the completed block comes from the existing transcript path.
- **`worker.activity` frames arrive at ≤1/2 s; `top`'s 15 s refetch would look stale** → fold frames into the row map, and the additive `live` field makes the first paint correct.
- **Moving `livePartials` touches a VS-602 file** → the UI path re-exports, so no UI caller or test changes; the move is justified by the no-fork rule.
- **No Ink test renderer** → the row's *logic* is pure-tested; the *rendering* is judged from the attached captures, per the shared convention that a visual change is judged by its render.
- **`wholeStepsOnly` depends on the runtime id** → read it from the agent (attach/chat) and the run (tail); an unknown runtime is treated as `none`, which is the conservative reading.

## Migration Plan

No schema, API-breaking or data change: the only API change is the additive `live` field on `/workers`. Rollback is a branch revert. The deploy step remains the owner's `weave daemon upgrade` after the merge.

## Open Questions

None.
