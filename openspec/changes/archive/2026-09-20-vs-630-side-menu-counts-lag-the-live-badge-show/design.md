## Context

See `proposal.md` — Why.

The rail is rendered by `V2Shell`, which sits above the routed workspace's `WorkspaceProvider`
(`router.tsx`: the shell layout is the parent route; `V2Workspace` wraps only the outlet). The rail's
counts come from `useV2Counts` (`V2Page.tsx`), which fans out per-workspace `useWorkersMany` and
`useDecisionsMany` queries plus the daemon-wide `useIncidents`. The Live floor (`LivePage.tsx`)
derives its own figures from the same query keys.

Two facts settle the cause, both reproduced with a scratch harness against the real
`QueryClient`, `WorkspaceProvider` and `EventStream`/`invalidateFor`:

- On a workspace page the only stream open is that workspace's (`/api/w/<ws>/events`). Delivering a
  `worker.spawned` for that same workspace on it moves the rail badge 1 → 2; a worker starting in a
  *different* workspace cannot reach the rail, and the badge stays at 1. On a global page the shell
  mounts the daemon-wide stream (`/api/events`), and the same other-workspace event moves the badge
  1 → 2.
- Opening Live is a global page: it mounts the daemon-wide stream and, more importantly, remounts
  the shared worker/decision queries, so TanStack's `refetchOnMount` re-reads the stale lists. That
  is the "it updates to two when I click Live" captain saw.

So the badge and the floor are already one derivation over the *same* data; what differed was the
data's freshness, because the rail had no stream carrying the other workspaces' events.

## Goals / Non-Goals

**Goals**

- The rail's counts are invalidated by every workspace's events on every signed-in page, without
  navigation, polling or a per-workspace fan-out.
- The rail's Live figure and the Live floor's roster figure share one derivation.
- The connection-budget test (`connectionBudget.test.tsx`) stays green.

**Non-Goals**

- Changing `/api/w/:ws/events`, the daemon-wide route, or the run-feed wiring (VS-509's decisions
  stand).
- Replacing the workspace-scoped run feeds with the daemon-wide source.
- Making Incidents event-driven: the daemon emits no incident event, so it has no equivalent lag to
  fix here. Its current `refetchOnWindowFocus` and the Incidents screen's own count are unchanged.

## Decisions

### The shell holds the daemon-wide stream on every signed-in page

`V2Shell` currently mounts `FanInStreams` only when `fanIn = !ws && !path.startsWith('/chats')`.
Drop the gate and mount it always. `FanInStreams` acquires the single VS-509 `GlobalEventStream`
entry per document (`streams.ts` refcounts it), and its `invalidateFor` already routes each event to
`qk.workers(evt.workspaceId)`, `qk.decisions(...)`, `qk.workspaces()` and the rest. Mounting it in
the shell — above the routed provider, always present — is what makes the rail's cross-workspace
queries answer to events.

*Connection cost.* A global page still holds exactly one connection. A workspace page now holds the
daemon-wide stream in addition to the workspace stream its provider already opens for run feeds:
two, constant, independent of workspace count. That is the same multiplexed connection VS-509
introduced ("one authenticated SSE connection per document"); it is not a per-workspace stream and
the budget test's cap (6) and its "fan-in is one connection" assertion are unaffected.

*Alternative considered:* leave the shell and teach it to read the counts the workspace stream
brings. Rejected — a workspace stream only carries its own workspace's events, so the counts for the
other workspaces can never arrive that way. *Alternative considered:* consolidate the workspace run
feeds onto the daemon-wide stream so a document holds exactly one connection. Rejected as scope
beyond this ticket: VS-509 deliberately kept workspace-scoped feeds on the workspace stream, and
changing that risks the run-tail/replay contract for a bug that a second constant connection fixes.

### One derivation for the rail badge and the floor figure

Today both `useV2Counts` and `LiveBody` already use `useRunningWorkerIds` over
`liveWorkingAgents` filtered by `agentIsWorking`; only the *counting* is written twice. Extract the
counting into a pure helper (in `lib/liveOrder.ts`, beside the working-set helpers):

```
liveCounts(lists, workingIds) -> { total, perList }
```

`useV2Counts` uses it for `live`/`liveByWs`; `LiveBody` uses it for its `N running` figure over the
scope-shown cards. With the stream fix the two now read the same fresh data; with one function they
cannot drift even if one side changes.

*Alternative considered:* leave the two counting loops and only fix the stream. Rejected because the
ticket's scope 3 makes one derivation a contract, and a shared helper is the cheapest way to hold
it.

### A `countsAsNeeds` note (out of scope)

The rail's Needs-you figure already differs from the Needs-you page's `waiting` figure by design
(VS-411: the badge excludes an unreviewed plan/merge/action card). That difference is not a lag and
is not touched; only the *freshness* gap is fixed.

## Risks / Trade-offs

- [Risk] A workspace page now holds two SSE connections (daemon-wide + workspace). → Mitigation: it
  is constant and one of them is the multiplexed stream; the cap is 6 and the budget test asserts
  one connection for fan-in. Recorded as a trade-off in the proposal's Impact.
- [Risk] The daemon-wide stream and the workspace stream both invalidate the current workspace's
  worker query. → Mitigation: TanStack Query deduplicates concurrent refetches for one key; the
  extra invalidate is a no-op.
- [Risk] Mounting the stream on `/chats` adds a connection beside the per-pane providers. →
  Mitigation: it is the same one-per-document stream, not one per pane; the shell's counts need it
  there too.
- [Risk] The shell test file mocks `FanInStreams`, so a regression in the real wiring would not be
  caught there. → Mitigation: the new live-counts test uses the real `WorkspaceProvider`,
  `FanInStreams`, `EventStream` and a `FakeEventSource`, as `v2decisionLive.test.tsx` does.

## Migration Plan

No data, config or API change; a normal frontend release. Rollback is reverting the commit.

## Open Questions

None.