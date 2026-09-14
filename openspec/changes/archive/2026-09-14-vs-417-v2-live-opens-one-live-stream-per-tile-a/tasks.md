# Tasks — VS-417

## 1. The daemon broadcasts run events on the workspace stream

- [x] 1.1 `packages/shared/src/events.ts`: move `'run.event'` from `EVENT_TYPES` to
      `EPHEMERAL_EVENT_TYPES`, so a run frame is live-only and never moves a replay cursor.
- [x] 1.2 `packages/core/src/runs/active.ts`: `emitRunEvent` also calls
      `ctx.events.broadcast('run.event', 'run', runId, ev)`, guarded so a broadcast failure never
      fails the turn.
- [x] 1.3 `docs/API.md`: document `run.event` beside `worker.activity` as a live-only frame.
- [x] 1.4 Core test: after a turn records events, the harness's workspace events contain one
      `run.event` frame per recorded event, carrying that `RunEvent`.

## 2. One shared workspace stream

- [x] 2.1 `packages/ui/src/api/streams.ts`: a refcounted registry — `acquireWorkspaceStream(ws, qc)`
      returns the one `EventStream` for a workspace, `releaseWorkspaceStream(ws)` stops it at zero.
- [x] 2.2 `packages/ui/src/api/events.ts`: `EventStream` gains `retryNow()`, and an ephemeral frame
      (seq 0) no longer re-notifies status listeners while already connected.
- [x] 2.3 `packages/ui/src/api/context.tsx`: `WorkspaceProvider` and `FanInStreams` acquire the
      shared stream instead of constructing their own, so providers and fan-in never stack.

## 3. Run events over the shared stream

- [x] 3.1 Rewrite `useRunEventStream` (`api/runStream.ts`) to acquire the shared workspace stream and
      filter its `run.event` frames by run id, keeping `{ events, status, retryNow }` and the
      persisted + tail merge by `seq`.
- [x] 3.2 When the shared stream reconnects, the hook invalidates its persisted run-events query so
      a frame missed while dropped is refetched.

## 4. Tests

- [x] 4.1 A test subscribes several run hooks — what several Live tiles do — in one workspace and
      asserts one `EventSource`, and that unmounting one leaves the shared stream open and the others
      receiving frames.
- [x] 4.2 Rewrite `packages/ui/src/test/runStream.test.tsx` for the shared transport.
- [x] 4.3 Update the Live tests that asserted a per-run `EventSource` URL (V1 `globalLive`/
      `liveFloor`, V2 `v2live`/`v2roles`/`v2decisionLive`/`liveTranscript`) to the shared stream.

## 5. Verify

- [x] 5.1 `pnpm lint` and `pnpm typecheck` green.
- [x] 5.2 Both suites run and pasted verbatim.
- [x] 5.3 A real browser against a scratch daemon: V2 Live with at least 8 tiles over two
      workspaces holds at most 2 long-lived connections, and a second tab (Chat) and a third (Live)
      load and stay live. Connection count recorded and pasted in the report.
