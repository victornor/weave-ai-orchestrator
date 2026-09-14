## Why

Captain's 2026-09-14 report: the V2 Live floor again mixes cards by working state — a row can read
working, idle, working — and the `Live` number in the rail counts workers that are not working.

Root cause (see design.md): the card's visible status is `agentUiStatus(agent.status)` (working only
for `running`), but the running-first order is fed by `useRunningWorkerIds`, whose grace window keeps
a just-finished worker in the running group for 10s while its `status` has already fallen back to
`active`. The held card is ranked by `createdAt` inside the running group, so it can land between
two genuinely-running cards. The sidebar count is separate again: it sums `liveWorkingAgents`, which
includes `active` and `provisioning` workers that display as idle.

## What Changes

- Introduce one derived "working" state per Live cell and use it everywhere: the card's visible
  status, the running-first group, the floor's `running` figure and the rail/header `Live` count.
  A cell reads `working` while it holds the running group (a run in flight, or the handover grace),
  otherwise its own UI status.
- The rail `Live` count (and the per-workspace figure on a workspace page) counts only workers whose
  card reads working, and updates live.
- No change to the grace window itself: a worker handing over between turns still never bounces.

## Impact

- `packages/ui/src/lib/liveOrder.ts` — the derived working-state helpers.
- `packages/ui/src/v2/LivePage.tsx` — cell status, group and floor figure from the one state.
- `packages/ui/src/v2/V2Page.tsx` / `V2Shell.tsx` — the Live count from the same state, per scope.
- UI tests only; no server, shared, schema, route or API change.
