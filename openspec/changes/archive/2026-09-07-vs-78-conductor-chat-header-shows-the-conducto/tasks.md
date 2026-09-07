## 1. The view model

- [x] 1.1 `formatCountdown` in `packages/render/src/format.ts`: `47m` · `2h 10m` · `4d 8h` · `now`, null for no target and for an unparseable one.
- [x] 1.2 `RuntimeLimitStripView` in `packages/render/src/types.ts` and `runtimeLimitStrip(accounts, runtimeId, now)` in `packages/render/src/usage.ts`: the session window (or the first window reported) with its countdown and tone, null for a metered account and for a runtime with no snapshot, and one `reason` with no meter for limits unavailable and for a failed probe.
- [x] 1.3 Render tests (`packages/render/src/{format,usage}.test.ts`): the countdown at each granularity and past the reset, the window fallback and its scope label, the 80/95 tones, the clamp, and each of the null and reason cases.

## 2. The strip in the header

- [x] 2.1 `packages/ui/src/components/SessionLimit.tsx`: the meter with its bar and countdown, a local clock ticking at `COUNTDOWN_TICK_MS`, the runtime/plan/capture time on hover, and the detail sheet rendering every window through `PlanLimits` and `accountLimits`.
- [x] 2.2 `ACCOUNTS_REFRESH_MS` and an opt-in `refetchIntervalMs` on `useUsageAccounts` in `packages/ui/src/api/hooks.ts`, matching the supervisor's own probe cadence.
- [x] 2.3 `packages/ui/src/routes/Chat.tsx`: the strip in the page header, reading the conductor agent's own `runtimeId`; the worker/decision meta is desktop-only so a phone header stays one line.

## 3. Cover it

- [x] 3.1 `packages/ui/src/test/sessionLimit.test.tsx`: subscription with limits, the countdown ticking and passing the reset, metered, unprobed, limits unavailable, failed probe, the hover title, and the detail sheet carrying the weekly and per-model windows.
- [x] 3.2 `packages/ui/src/test/chat.test.tsx`: the header meters the conductor's runtime and not another workspace runtime.
- [x] 3.3 `pnpm lint`, `pnpm typecheck` and `pnpm test` green.

## 4. The context meter (scope addition, 2026-09-07)

- [x] 4.1 `RuntimeModel.contextWindowTokens` and `RuntimeCapabilities.contextCompactionAt` in `packages/runtime-sdk/src/index.ts`, both optional so a runtime that cannot state them omits them.
- [x] 4.2 The Claude adapter fills both: `CONTEXT_COMPACTION_AT = 0.92` on its capabilities, 200k on every model entry, with a comment saying the compaction point is a constant we maintain rather than something the CLI reports.
- [x] 4.3 `ContextStripView`, `contextStrip()`, `contextTokens()` and `resolveModel()` in `packages/render`: the last turn's input plus cache reads over the model's window, the distance to compaction, the tone taken from that distance, and a reason instead of a meter for an unknown window and for an unreported size.
- [x] 4.4 `packages/ui/src/components/ContextMeter.tsx`, rendered beside the plan meter in the chat header with a divider, the token count on hover, and the compaction clause off the phone header.
- [x] 4.5 `run.started`/`run.finished` invalidate `qk.conductor` in `packages/ui/src/api/events.ts`, so the meter follows each finished turn.
- [x] 4.6 Tests: `packages/render/src/usage.test.ts` (the computation, the model resolution, both reason cases, the clamp, the tone), `packages/ui/src/test/contextMeter.test.tsx`, `chat.test.tsx` (the wiring and the unknown-window case) and `events.test.tsx` (the invalidation).
- [x] 4.7 `pnpm lint`, `pnpm typecheck` and `pnpm test` green; the header checked in headless Chromium at 360 px and 1440 px with both meters.
