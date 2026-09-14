# Tasks

- [x] 1. Add the Live tile-height preference to `packages/ui/src/v2/prefs.ts` (read/write with a `null` sentinel for "still on the per-row ladder", key `weave.v2.live.height`, min, viewport-share max, clamp and step).
- [x] 2. Let `RunTranscript` take an exact pixel height and `WorkerFeed` fill its tile: the body becomes a fixed-height box and the transcript scrolls inside it (`RunTranscript.tsx`, `WorkerFeed.tsx`).
- [x] 3. Add the desktop resize grip to `LivePage.tsx`: pointer drag, up/down arrow keys, double-click reset, clamped, driving one shared `bodyHeight` for every tile, and keep phone at natural height.
- [x] 4. Test the preference (`packages/ui/src/test/v2prefs.test.ts`) and the behaviour on Live (`packages/ui/src/test/v2live.test.tsx`): drag changes every tile, clamps, persists across a remount, survives a per-row change, double-click resets, arrows adjust, no grip on phone.
- [x] 5. Rendered check at desktop width, two per-row counts at a small and a large height, dark and light; then `pnpm lint`, `pnpm typecheck` and both suites.
