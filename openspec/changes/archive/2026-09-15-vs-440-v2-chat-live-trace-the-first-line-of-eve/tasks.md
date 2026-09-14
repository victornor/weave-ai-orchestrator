# Tasks — VS-440

## 1. Baseline scoped to the run

- [x] 1.1 `packages/ui/src/lib/streamReveal.ts`: `useNewLiveIds(events, runId?)` keys its baseline
      by run id — taken on the first render for a run, reset to empty when the run changes — and
      filters events by run id so a previous run's stale frames are never "new".
- [x] 1.2 `packages/ui/src/v2/ChatTrace.tsx`: `ChatTrace` takes `runId` and passes it to the hook;
      `reveal` still gates all animation, and an empty live trace renders no history placeholder.

## 2. Mount the live trace before its first event

- [x] 2.1 `packages/ui/src/v2/ChatPage.tsx`: track `fromStart` on the live run (`run.started` sets
      it; the resume effect does not), and mount the live `<ChatTrace>` when the run was seen
      starting even with zero events. A resumed run still mounts only once its events are present,
      so its existing lines render whole.

## 3. Tests and verification

- [x] 3.1 `packages/ui/src/test/streamReveal.test.ts`: `useNewLiveIds` — a run watched from its
      start has its first event new; a run joined mid-turn has its present events as baseline; a
      run change resets the baseline.
- [x] 3.2 `packages/ui/src/test/v2chattrace.test.tsx`: a turn's first line streams when the trace
      mounted with zero events; a second run without unmount streams its lines; existing VS-433
      tests still pass.
- [x] 3.3 `pnpm lint && pnpm typecheck` green; both suites run and pasted verbatim.
- [x] 3.4 Evidence: real-browser captures (stubbed run events) in dark and light of a turn's first
      line mid-reveal. Absolute paths in the PR.