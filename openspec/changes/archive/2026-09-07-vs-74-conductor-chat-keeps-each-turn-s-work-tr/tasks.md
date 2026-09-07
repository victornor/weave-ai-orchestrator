## 1. The daemon serves a run's trace summary

- [x] 1.1 `RunTrace` in `packages/shared/src/types.ts`: run id, status, agent, `createdAt`/`startedAt`/`finishedAt`, `durationMs`, `toolCalls`, `files`, `errors`, `texts`, `events`, `summary`.
- [x] 1.2 `RunsService.traces({ids, agentId, since, limit})` — one grouped aggregate over `run_events`, scoped to the workspace, omitting unknown ids; the agent window is a union with the ids, so a turn that left no message is described too. Interface on `packages/core/src/api.ts`.
- [x] 1.3 `GET /runs/traces?ids=&agent=&since=&limit=` on `packages/server/src/routes/runs.ts`, registered before `/:id`, and documented in `docs/API.md`.
- [x] 1.4 Core test (`packages/core/src/runs/traces.test.ts`): counts and duration off recorded events, an unknown id omitted, a run with no events reporting zero, the agent window and its limit.

## 2. The chat rows

- [x] 2.1 `useRunTraces` in `packages/ui/src/api/{keys,hooks}.ts`, keyed by the run ids it is asked for, invalidated when a run finishes.
- [x] 2.2 `chatRows` in `packages/ui/src/lib/dispatch.ts`: messages and trace-only rows ordered by time, a trace attached to the last message of its run, silent turns filtered by the preference and never rendered for a run still in flight.
- [x] 2.3 `packages/ui/src/lib/traceExpansion.ts` — the expanded set in `sessionStorage`, scoped to the workspace, guarded like the other storage helpers.
- [x] 2.4 `packages/ui/src/lib/chatPrefs.ts` — the per-device "show turns with no reply" preference, defaulting to on.

## 3. The section itself

- [x] 3.1 `packages/ui/src/components/TurnTrace.tsx`: the collapsed one-line summary with a tappable expand control, and the expanded transcript through `RunTranscript`, fetching the run's events only while expanded.
- [x] 3.2 `packages/ui/src/routes/Chat.tsx` renders rows: a reply with its trace section, a trace-only row for a silent turn, the pinned decisions, drafts and scroll-follow untouched.
- [x] 3.3 Hold the live block until the row that replaces it is on screen, so the turn's end is continuous.
- [x] 3.4 The preference toggle in Settings → This device.

## 4. Cover it

- [x] 4.1 UI tests (`packages/ui/src/test/chat.test.tsx`, `settingsScopes.test.tsx`): the collapsed summary after a finished run; no events requested until expanded; expansion remembered across a remount; a trace-only row and its ordering; the preference hiding those rows and its switch in Settings; the live-to-collapsed transition leaving no gap; a message with no run showing nothing extra.
- [x] 4.2 `pnpm lint`, `pnpm typecheck` and `pnpm test` green.
