## 1. The daemon syncs on demand, at most so often

- [x] 1.1 `AccountSync`, `AccountSyncThrottle` and `AccountSyncFailure` in `packages/shared/src/types.ts`.
- [x] 1.2 Extract the per-runtime probe out of `refresh()` in `packages/core/src/usage/accounts.ts` so it can report its own failure, and keep `refresh()`'s behaviour exactly as it is: a failure is logged and the previous snapshot stays.
- [x] 1.3 `MANUAL_SYNC_INTERVAL_MS` and `AccountsService.sync(runtimeIds?)` in `packages/core/src/{usage/accounts.ts,api.ts}`: probe each requested runtime that is outside its window, return every requested runtime's current snapshot, and report the throttled ones with when the next sync is allowed and the failed ones with the reason.
- [x] 1.4 `packages/core/src/usage/accounts.test.ts`: a sync probes and replaces the snapshot, a second sync inside the window does not probe and reports the wait, the window is per runtime, the supervisor poll neither consumes nor is blocked by it, and a probe that throws is reported while the previous snapshot stands.

## 2. The route

- [x] 2.1 `POST /w/:ws/usage/accounts/refresh` in `packages/server/src/routes/usage.ts`, optional `runtimeId` in the body, snapshots carrying `displayName` as `GET /usage/accounts` does.
- [x] 2.2 The entry in `packages/server/src/routetable.ts` and in `docs/API.md`.
- [x] 2.3 `packages/server/test/usage.test.ts`: the response shape, one runtime versus all, and the second call inside the window coming back throttled with the snapshot rather than as an error.

## 3. The control on both surfaces

- [x] 3.1 `useSyncUsageAccounts` and its query key in `packages/ui/src/api/{hooks,keys}.ts`, writing the returned snapshots into the `usageAccounts` cache.
- [x] 3.2 `packages/ui/src/components/PlanLimits.tsx`: the per-runtime sync control with its pending and message states, `synced …` beside the numbers, and the line saying the daemon refreshes every five minutes.
- [x] 3.3 `packages/ui/src/routes/Usage.tsx` and `components/SessionLimit.tsx` + `routes/Chat.tsx` wire the mutation into the block on each surface.
- [x] 3.4 `packages/ui/src/test/{usage,sessionLimit}.test.tsx`: the control fires with the runtime id, disables and spins while pending, shows the failure reason and the throttle wait, and is absent when no handler is given.

## 4. The CLI

- [x] 4.1 `--sync` on `conductor usage` in `packages/cli/src/commands/usage.ts`: re-probe first, then print, saying what was synced, throttled and failed.
- [x] 4.2 `packages/cli/src/usage-command.test.ts`: the flag posts and prints; without it nothing is posted.

## 5. Green

- [x] 5.1 `pnpm lint`, `pnpm typecheck` and `pnpm test` green.
