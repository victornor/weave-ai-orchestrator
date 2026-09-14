# Tasks

- [x] 1. Generalize the grip: export `ResizeGrip` from `packages/ui/src/v2/WorkerFeed.tsx` with caller-supplied `min`/`max`/`step`/`label` and an optional commit callback, keeping Watch and Roles panes unchanged.
- [x] 2. Put the corner grip on every Live tile and bind it to the one shared `customHeight`, persisting on release, arrow step and double-click reset; remove the hidden 8px separator bar and its `LiveBody` handlers.
- [x] 3. Tests: dragging one tile's grip resizes every tile together, height persists across a remount, arrow keys step it, double-click resets it, the grip is inside each tile (not a bar above the grid), and there is no grip on the phone.
