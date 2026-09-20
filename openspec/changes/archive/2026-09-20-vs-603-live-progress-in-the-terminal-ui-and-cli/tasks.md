## 1. The shared model

- [x] 1.1 Move the pure partial-output merge (`applyDelta`, `fromSnapshot`, `dropSuperseded`, `PartialMap`, `PartialText`) from `packages/ui/src/lib/livePartials.ts` to `packages/render`, re-export it from the UI path, and keep the existing UI test green
- [x] 1.2 Add `liveActivityLine(events, partials, now, opts)` to `packages/render` (composing `liveTurn` + `liveTurnLine`) and a test that each state (writing, thinking, running `<tool> <target>`, waiting for the model, starting, whole steps only) reads as the shared wording does

## 2. Terminal primitives

- [x] 2.1 Add a one-second `useNow(active, everyMs = 1000)` hook to `packages/tui/src/hooks.ts`, stopped while inactive
- [x] 2.2 Add the Ink `ActivityLine` component in `packages/tui/src/components/ActivityLine.tsx` rendering `liveTurnLine` from events, partials and `runtimeId`, hidden when there is no live run; a pure test covers the per-state line and that applying a `run.delta` frame moves "waiting" to "writing"

## 3. `weave attach`

- [x] 3.1 Consume `run.delta` frames for the followed run on the workspace subscription it already holds and seed from `GET /runs/:id/live` on open and on reconnect; render `ActivityLine` above the status bar; test the seed helper and the frame-applies-to-line path

## 4. `weave chat`

- [x] 4.1 Replace the literal "weaver is working…" with the same live row in the working block, seeded from `GET /runs/:id/live` and fed by `run.delta`; keep the conductor's `runtimeId` so the whole-steps-only wording is right; test that a live turn never renders the bare literal

## 5. `weave top`

- [x] 5.1 Return the additive `live` field from `GET /workers` (list and detail) beside the existing `activity`/`tests`
- [x] 5.2 Render each worker's live label and elapsed time from `live` (falling back to `activity`, then `statusLabel`) and fold `worker.activity` frames into the rows; test the fallback ladder and the elapsed formatting

## 6. `weave runs tail`

- [x] 6.1 Subscribe to the workspace `/events` stream for `run.delta` frames of the followed run, seed from `GET /runs/:id/live`, read the run's `runtimeId` once from `GET /runs/:id`, and print the live line when its state or label changes (not on every frame); the completed step stays with the existing transcript output and a superseded part stops; test printing each state and that a repeated frame prints nothing

## 7. Confirm the untouched surfaces

- [x] 7.1 Confirm and state in the PR that `packages/channels/cli` stays a no-op transport, that tmux/herdr/hyprland inherit the live row by launching `weave attach`, and that headless renders no view

## 8. Evidence and closing

- [x] 8.1 Text captures of `weave attach` and `weave runs tail` in each state (writing, thinking, running a tool, waiting, starting, whole steps only), rendered with a fake client / stub daemon outside the worktree, attached to the ticket
- [x] 8.2 `pnpm lint && pnpm typecheck && pnpm test` green, one full suite at a time with `--maxWorkers=4`, both suite blocks pasted in the report
