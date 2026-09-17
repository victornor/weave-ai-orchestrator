## 1. Daemon-wide event transport

- [x] 1.1 Add the authenticated daemon-level `/api/events` SSE route, including bounded per-workspace cursor parsing, subscription-before-replay, durable/ephemeral frame handling, heartbeats and abort cleanup; verify with server route tests for authorization, multi-workspace delivery, replay gaps and teardown.
- [x] 1.2 Register and document `/api/events` in the route table, OpenAPI description and API documentation; verify generated/openapi route tests continue to pass.

## 2. Client global stream

- [x] 2.1 Implement the global SSE client state machine and one-entry registry, reusing the existing backoff, connection status, visibility pause/resume and manual retry semantics; verify cursor encoding, reconnect replay requests and hidden-document behavior in focused UI tests.
- [x] 2.2 Change `FanInStreams` to acquire one global stream and route its unchanged workspace-tagged events to global query consumers; verify a ten-workspace mount creates exactly one `/api/events` source and releases it on unmount.
- [x] 2.3 Extend run-event subscription wiring with an explicit global-source mode that filters by workspace and run id, invalidates persisted run data after reconnect, and leaves workspace-scoped consumers on their existing registry; verify cross-workspace filtering and local-stream compatibility.

## 3. Global Live integration

- [x] 3.1 Wire global V2 Live worker feeds to the global stream while preserving per-workspace cards, roster/scope updates, between-turn handoff and connection-state rendering; verify a Live fixture with workers in multiple workspaces receives each matching run event.
- [x] 3.2 Add an integration regression test that mounts global Live with more workspaces than the six-connection HTTP/1.1 budget and proves ordinary thread-list, message and send requests complete; add a two/three-document manual or harness reproduction covering Live open, tab background/refocus and prompt recovery.

## 4. Verification

- [x] 4.1 Run strict OpenSpec validation and the affected server/UI tests, then run both repository test suites before delivery; verify the worktree is clean and report the observed HTTP protocol and connection counts in the ticket delivery.
