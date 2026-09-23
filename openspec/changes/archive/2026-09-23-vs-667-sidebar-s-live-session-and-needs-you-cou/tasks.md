## 1. Emit the missing live-readiness events (daemon)

- [x] 1.1 Emit `worker.status` (`status: 'running'`) from the run engine beside the run start, so a
      worker beginning a turn reaches every consumer that keys on the worker itself.
- [x] 1.2 Emit `worker.status` (`status: 'active'`) from the supervisor's boot recovery and its
      watchdog kill recovery, matching the reason strings the other resume paths use.
- [x] 1.3 Core coverage: a started run and both supervisor recoveries each leave a `worker.status`
      event naming that worker's workspace.

## 2. Close the decision invalidation gap (web)

- [x] 2.1 Make `invalidateFor` invalidate a workspace's parameterised decision lists explicitly, so an
      answered/superseded/expired/auto-granted decision makes the rail's per-workspace Needs-you read
      stale without the Needs you screen being open.
- [x] 2.2 Extend `events.test.tsx` so a `decision.answered` and a `decision.superseded` each
      invalidate the parameterised `{ status: 'open', owner: 'human' }` list, and an event that cannot
      change the count does not.

## 3. Extract the rail's counting rules and cover both directions (web)

- [x] 3.1 Extract the `useV2Counts` derivation after its hook calls into a pure function; the hook
      becomes a thin wrapper.
- [x] 3.2 Unit-test the derivation: a decision closing drops the count on the Everywhere figure and on
      that workspace's own row; a worker joining the working set raises the Live count on the
      Everywhere figure and on its own row; `countsAsNeeds` still excludes an unseen approval.

## 4. Reconcile a global page's worker read from the daemon-wide stream

- [x] 4.1 Mount a small `useWorkspaceEvents` consumer in the shell when the scope is global, so a
      seq-0 `worker.activity`/`run.event` frame reconciles that frame's own workspace worker read,
      rAF-coalesced and never a second connection.
- [x] 4.2 Extend `v2raillive.test.tsx`: on a global page, a worker activity frame for a workspace with
      no workspace stream mounted moves the rail's Live badge; an idle frame does not add a worker.

## 5. Deliver and verify

- [x] 5.1 Run the UI suite and the core suite; record both blocks verbatim.
- [x] 5.2 Write the PR and state plainly what was verified against a simulated daemon (fake
      `EventSource`, fake runtime harness) versus a real running daemon.