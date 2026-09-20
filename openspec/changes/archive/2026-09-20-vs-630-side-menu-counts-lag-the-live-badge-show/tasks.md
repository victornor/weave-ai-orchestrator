## 1. Failing tests first

- [x] 1.1 Add a UI test that mounts the real shell with the rail and no Live page, on a workspace path, against the real `QueryClient`/`FanInStreams`/`EventStream` and a `FakeEventSource`; deliver a `worker.spawned` on the daemon-wide stream for a worker starting (and a `worker.retired` for leaving the roster) and assert the rail's Live count changes with no navigation and no refetch call from a page. Verified it fails on the current code (the shell mounted no fan-in stream on a workspace path).
- [x] 1.2 Add a UI test that, on a workspace page, delivers another workspace's worker event on the daemon-wide stream and asserts the Everywhere Live badge rises while the current workspace's own rows are unchanged. Verified it fails on the current code.
- [x] 1.3 Add a UI test that the rail's Live badge equals the number of Live floor cards reading `data-v2-live-status="working"`, across two workspaces and with a worker inside the handover grace (fake timers), by rendering the shell and the Live body against one query client and one fixture. Verified it passes on the current code (the derivation already agrees) so it locks the contract.
- [x] 1.4 Add a UI test that, on a workspace page, a `decision.created` in another workspace, delivered on the daemon-wide stream, raises the rail's Everywhere Needs-you count. Verified it fails on the current code.

## 2. Fix

- [x] 2.1 In `V2Shell.tsx`, mount `FanInStreams(ids)` on every signed-in page (drop the `!ws && !path.startsWith('/chats')` gate) so the rail's cross-workspace queries answer to every workspace's events; 1.1, 1.2 and 1.4 pass and `connectionBudget.test.tsx` stays green. `v2shell.test.tsx`'s two "does not fan in" assertions were updated to the new contract (fan-in mounts on a workspace page and on Chats).
- [x] 2.2 Add a pure `liveCounts(lists, workingIds)` helper in `lib/liveOrder.ts` and use it for `live`/`liveByWs` in `useV2Counts` and for the floor's `N running` figure in `LiveBody`; 1.3 passes and the two surfaces read one function.

## 3. Verify

- [x] 3.1 Iterate on the changed test files until green, then run the UI suite once with `--maxWorkers=4` and paste the suite block verbatim. Ran the full `pnpm test` (core/server + UI) at the end; both green (core/server: 328 files, 4799 tests, 2 skipped; UI: 169 files, 1996 tests).
- [x] 3.2 Run `pnpm typecheck` and `pnpm lint` and confirm both are green.
- [x] 3.3 Open the PR stating the cause in a sentence a person can follow, the two verification tests, and which rail counts were checked (Live and Needs you fixed; Incidents stated as a different cause — the daemon emits no incident event). PR #513.
