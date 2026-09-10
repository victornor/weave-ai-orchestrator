## 1. Size model

- [x] 1.1 Add `packages/ui/src/lib/liveCellSize.ts`: `{ cols, rows, expanded? }` clamped to the current column count (1 / 2 / 3) and rows 1|2; `read`/`write` against `sessionStorage` key `conductor.live.cellSizes.<wsId>`; corrupt values read as never-resized; drop keys for workers no longer in the live set on write. Unit-test clamp, corrupt, missing, and drop-stale.

## 2. Desktop drag-resize

- [x] 2.1 On `Live.tsx`, at `sm` and up, each cell mounts a bottom-right resize handle (`touch-none`, labelled, keyboard-steppable). Pointer drag snaps to the next `{ cols, rows }` span; a press without a move writes nothing; Escape / double-click resets to `{1,1}`. The grid uses those spans (`grid-column` / `grid-row`) with `grid-flow-dense`. Transcript `max-h` scales with `rows`.
- [x] 2.2 Tests in `liveFloor.test.tsx`: dragging the handle grows then shrinks the cell's span; neighbours stay in the document; press-without-move is a no-op; reset returns `{1,1}`; a reload in the same session restores the chosen size. Assert `touch-none`, not `touch-action`. Empty and loading still have no handle.

## 3. Phone tap-to-expand

- [x] 3.1 Below `sm`, do not mount the drag handle. Mount an Expand / Restore control in the cell header instead. Expand raises that cell's transcript share (`rows: 2` equivalent); Restore returns it. Other cells stay visible. Persist `expanded` in the same session map.
- [x] 3.2 Tests: at the phone path a live cell has expand and no drag handle; activating expand then restore toggles the larger transcript; empty/loading have neither control.

## 4. Cover it

- [x] 4.1 Existing live-floor membership, streaming, empty, loading and error tests still pass. `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm --filter @agent-conductor/ui exec vitest run` are green.
