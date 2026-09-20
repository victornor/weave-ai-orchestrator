## Why

VS-602 made every **web** interface show what a running agent is doing, over the one runtime-neutral live model VS-595 built (`liveTurn`, `liveTurnLine`, `clock`, ephemeral `run.delta` frames, `GET /runs/:id/live`). The terminal is the surface its owners actually watch, and it still shows a bare status: `weave attach` and `weave chat` print "weaver is working…", `weave top` drops the activity line the API already returns, and `weave runs tail` prints only completed transcript blocks. Someone watching a worker in a terminal cannot tell a healthy long turn from a hung one.

## What Changes

- **Shared partial model.** Move the pure partial-output merge (`applyDelta`, `fromSnapshot`, `dropSuperseded`) from `packages/ui/src/lib/livePartials.ts` into `packages/render`, and have the web re-export it from its existing path. One implementation for web, TUI and CLI — no fork.
- **`weave attach`** consumes `run.delta` frames on the workspace subscription it already holds and reads `GET /runs/:id/live` on open and reconnect, rendering a live row above the status bar.
- **`weave chat`** renders the same live row in its working block instead of the literal "weaver is working…".
- **`weave top`** shows each worker's live activity label and elapsed time (from the `worker.activity` fields VS-602 added, with the `/workers` read carrying them too so first paint is correct) instead of a bare status.
- **`weave runs tail`** prints the live line from `run.delta` frames beside the transcript, and the completed step when it lands.
- **New TUI pieces:** a shared Ink `ActivityLine` component and a one-second `useNow` tick in `packages/tui`, rendering `liveTurnLine` (Writing, Thinking, Running `<tool> <target>`, Waiting for the model, Starting, whole steps only; turn time, tool count, time since the last event).
- **No behaviour change where it must not change:** the `packages/channels/cli` adapter stays a no-op transport; the tmux/herdr/hyprland surfaces inherit the live row because they launch `weave attach`; the headless surface renders no view and is stated as such.
- Streamed text is a **view only** — nothing here sends it as a message, and no new path is added around the engine's existing redaction.

## Capabilities

### New Capabilities
<!-- None: this extends an existing capability. -->

### Modified Capabilities
- `interface-live-progress`: adds the terminal UI (`weave attach`, `weave chat`, `weave top`) and the CLI follow output (`weave runs tail`) to the surfaces that must show the one live model, never a bare working state.

## Impact

- `packages/render`: gains the pure partial-output merge and a composed `liveActivityLine` helper (with `liveTurn`/`liveTurnLine`/`clock` already there).
- `packages/tui`: new `components/ActivityLine.tsx`, a `useNow` hook; `apps/Attach.tsx`, `apps/Chat.tsx`, `apps/Top.tsx`.
- `packages/cli`: `commands/runs.ts` (`tail`).
- `packages/server`: `routes/workers.ts` gains the additive `live` field on the workers list/detail read.
- `packages/ui`: `src/lib/livePartials.ts` becomes a re-export (callers and tests unchanged).
- `packages/channels/cli`, `packages/surfaces/*`: unchanged; the tmux/herdr/hyprland inheritance and the headless no-view statement are confirmed in the PR.
