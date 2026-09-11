## 1. Fire history from existing runs

- [x] 1.1 Add `fires(id)` to `RoutinesService` using the VS-220 wake→run join (no usage window; exclude `skipped`; `runId` from `COALESCE(w.run_id, parent.run_id)`), returning newest-first `{ wakeId, runId, firedAt, status, summary, sharedTurn }`. `sharedTurn` is true when `flattenWakes` of that run's claimed wakes includes any wake that is not this routine. Verify in `packages/core/src/routines/routines.test.ts`: a finished run's summary appears; a skipped enqueue does not; an in-flight run appears without a invented summary; two wakes on one run list as two fires; a fire coalesced with a human-message wake has `sharedTurn: true`; a fire that was the only claimed work has `sharedTurn: false`.
- [x] 1.2 Include a lifetime `fireCount` on `list()` items (grouped COUNT of those same non-skipped wakes). Verify a routine with three kept wakes lists `fireCount: 3` and a never-fired routine lists `0`.
- [x] 1.3 Expose `GET /api/w/:ws/routines/:id/fires` (session auth) and pass `fireCount` through the existing list response. Verify in `packages/server/test/routines.test.ts`. Do not change POST/PATCH/DELETE, MCP, or CLI.
- [x] 1.4 Re-run the existing firing cases in `routines.test.ts` (due enqueue, pause, missed-fire once, overlap, instruction-as-it-stands) and confirm they still pass unchanged.

## 2. Scheduled page

- [x] 2.1 Add `useRoutinesMany(ids)` and explicit-workspace create/patch/remove/fires hooks in `packages/ui/src/api/hooks.ts` (query keys stay `qk.routines(ws)` / a new `qk.routineFires(ws, id)`). Verify the hooks do not call `useWs()`.
- [x] 2.2 Add `GlobalScheduledRoute` at `/scheduled` (AppShell, no WorkspaceProvider): fan-out list with workspace attribution, schedule, next run, created-at, fire count and 7d spend; expand a row for fires (when + status + summary; when `sharedTurn`, the copy "this run also handled other work") and for edit/pause/resume/remove; add-form with a workspace picker (hidden when only one workspace). Empty, loading, and one-workspace-failed states match Global Live. Verify in a new `globalScheduled.test.tsx` that a mixed-turn fire is labelled and a solo fire is not.
- [x] 2.3 Register `/scheduled` in `router.tsx` as a `/live` sibling. Add `GLOBAL_NAV` entry `Scheduled` → `/scheduled` after Map and before Settings. Add `/scheduled` to `AppShell.onGlobalPage` (FanInStreams stays on, as for Live). Verify `router.test.tsx`, `appshell.test.tsx`, `workspacenav.test.tsx`, `moreSheet.test.tsx`.

## 3. Settings section removed

- [x] 3.1 Drop `scheduled` from `SETTINGS_SECTIONS`. Remove `ScheduledSection` from `Settings.tsx`. Redirect workspace-settings `?section=scheduled` to `/scheduled` with that workspace in the search (special-case in `redirectForSettingsRoute`, because the key is no longer a known section). Verify `settingsScopes.test.tsx` (tabs no longer include Scheduled tasks; old link redirects) and that `scheduledSettings.test.tsx` is retired or rewritten against the global page.

## 4. Gates

- [x] 4.1 `pnpm lint && pnpm typecheck && pnpm test`. Paste **both** suite blocks verbatim with their real totals (core and UI separately). Do not add them together. Existing firing tests must be in the green core run.
