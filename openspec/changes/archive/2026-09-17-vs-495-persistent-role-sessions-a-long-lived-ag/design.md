## Context

Every agent today is a row in `agents` with `kind IN ('weaver','worker','planner')`. A `worker` is always bound to a ticket (`agents_one_worker_per_ticket`, a partial unique index on `ticket_id` where `kind='worker'`) and is spawned through `workers.spawn()`, which provisions a worktree and counts against the project's `maxWorkers` pool. The weaver (`kind='weaver'`) is the one existing precedent for a long-lived, no-ticket agent: it always has `ticket_id = NULL`, its session is forced to `session_policy='persistent'` (`sessionPolicyFor` in `packages/core/src/runs/engine.ts`), and it resumes across daemon restarts through the same generic `agent_sessions` + queued-wake machinery every agent uses — no weaver-specific restart code exists. `roles.session_policy` already has a `'persistent'` value defined in the enum but it is currently only read as a hardcoded branch for `kind IN ('weaver','planner')`, never for a role-configured policy.

The project's transient-worker cap is enforced in two structurally different places, and they diverge in a way that matters for this change:
- **Spawn-time existence gate**: `liveInProject()` in both `workers/index.ts` and `roles/index.ts` counts rows `WHERE kind = 'worker'`. Anything not `kind='worker'` is already invisible here for free.
- **Dispatch-time concurrency gate**: the dispatcher's `projectRunning()` (`runs/dispatcher.ts`) counts **every currently-running agent in the project regardless of kind** and compares it to `project.maxWorkers` before letting a candidate's turn start. This gate has no kind filter at all. A `session`-kind agent with a `projectId` would be throttled by it exactly like a worker — silently violating the "does not consume or block a transient worker slot, however long it lives" requirement the moment two turns want to run at once. This is a real gap, not a hypothetical: it must be fixed as part of this change, not left as a pre-existing quirk.

## Goals / Non-Goals

**Goals:**
- A `session`-kind agent, one per role, that is invisible to every project-capacity check (existence and concurrency), resumes rather than recreates across restarts, and can be handed a ticket + worktree without going through `workers.spawn()`.
- Reuse the weaver's already-working `persistent` session-policy machinery and the existing generic restart/resume, attach/interrupt, and `compactSession` plumbing rather than building parallel versions of any of them.
- Keep the ticket phase table, plan-approval gate and merge-approval gate byte-for-byte the same once a session holds a ticket — a session's ticket must be indistinguishable from a worker's ticket to everything downstream of "which agent holds `tickets.worker_id`".

**Non-Goals:**
- No new context-management, summarization, or window-tracking mechanism — the manual compact control only calls the existing `compactSession(actor, id)` service, unchanged.
- No change to transient worker spawning, role hiring, or the weaver's own ticket-routing tools.
- No per-role worker cap — `roles.max_workers` remains the stored-but-unenforced field it already is (`worker-concurrency/project-cap`); this change does not revisit that decision.
- Multiple simultaneous persistent sessions per role are out of scope; one per role is the contract.

## Decisions

### A new agent kind, `session`, rather than reusing `worker` with a null ticket

Reusing `kind='worker'` with `ticket_id = NULL` was considered and rejected: `liveInProject()` and every other `kind='worker'` filter would then count it, requiring those call sites to add a second condition (e.g. `AND ticket_id IS NOT NULL`) everywhere they currently just check `kind='worker'` — a wider, easier-to-regress surface than adding one kind value. A new kind mirrors how `weaver`/`planner` already opt out for free, and keeps `kind='worker'` meaning exactly what it already means: a transient, ticket-bound agent. `AGENT_KINDS` becomes `['weaver', 'worker', 'planner', 'session']`.

### One live session per role via a partial unique index, mirroring `agents_one_conductor`

`agents_one_session_per_role`: `UNIQUE(role_id) WHERE kind = 'session' AND status NOT IN ('retired')`. Opening a role's session looks up this row first; a miss creates it, a hit resumes it — the same find-or-create shape `agents_one_conductor` already gives the weaver at the workspace level, one level down at the role level.

### `sessionPolicyFor` treats `kind='session'` as `persistent`, unconditionally

Extend the existing branch in `runs/engine.ts`:
```
if (agent.kind === 'weaver' || agent.kind === 'planner' || agent.kind === 'session') return 'persistent';
```
`roles.session_policy` is not read for this decision — a persistent session is persistent by definition, not by role configuration. (The pre-existing unused `role?.sessionPolicy` branch for `kind='worker'` is untouched.)

### Fix `projectRunning()` to exclude `kind='session'`

The dispatcher's concurrency gate (`runs/dispatcher.ts`, the `if (agent.projectId)` block) must stop counting a `session`-kind agent's active run against `project.maxWorkers`. The minimal fix scopes the existing count to `kind='worker'` there too (matching `liveInProject`'s existing filter) rather than leaving it kind-blind — restoring the two gates to a single, consistent definition of "counts as a transient worker" instead of adding a second special case.

### Taking a ticket: a self-take path that bypasses `workers.spawn()`

`weave_ticket_create` already accepts `assigneeRoleId` and is `scope: 'all'`, so a session agent can file and assign a ticket to its own role in one call today. What is missing is turning "assigned to my role" into "I am the worker" without going through `workers.spawn()` (which would create a second, `kind='worker'` agent — the opposite of what's wanted). A new tool, scoped so only a `session`-kind actor may call it and only for its own role's tickets, sets `tickets.worker_id` to the session's own agent id directly and provisions a worktree for it using the same worktree-provisioning path `spawn()` uses today (factored out so both call it, rather than duplicated). Ordinary `weave_ticket_assign` (`scope: 'weaver'`) is untouched; a session never calls it, and a human or weaver assigning a role to a ticket still goes through the normal spawn path unchanged.

**Found while implementing (load-bearing, not optional):** `supervisor.spawnPending()` sweeps every tick for `tickets WHERE assignee_role_id IS NOT NULL AND worker_id IS NULL` and calls `workers.spawnForTicket()` for each — the exact mechanism that turns an assigned-but-unspawned ticket into a live worker today. Its per-row guard, `liveWorkerFor()`, only looks at `kind='worker'` agents, so a `kind='session'` agent holding a ticket is invisible to it. If a session's ticket ever sits with `assignee_role_id` set and `worker_id` still `NULL` across an `await` — i.e. across two separate MCP tool calls, or one tool call with an async gap between assigning the role and binding `worker_id` — the very next supervisor tick can spawn a competing transient worker on the same ticket. The self-take tool's handler must therefore call `tickets.create`/`tickets.assign` and the `worker_id` bind **synchronously, in the same tick, with no `await` between them** (both are synchronous DB calls today; the hazard is only ever introduced by adding one). This is why self-take is one tool, not "create, then take" as two — two separate tool calls are two separate turns of the event loop, and the sweep runs on its own 1 s timer regardless of what an agent is doing.

When the ticket reaches a terminal status, the session's `ticket_id` and worktree binding are cleared the same way a retiring worker's would be, except the agent itself is not retired — it returns to being an idle, ticketless `session` row, ready for the next conversation turn or the next ticket.

### Ticketless prompt posture: unconditional, not a first-turn hold

`interactive-sessions`' conversational posture is a ticket-level flag applied for exactly one first turn before escalating to the worker's normal delivery phases. A `session`-kind agent needs the inverse default: conversational on every turn for as long as it holds no ticket, switching to the ordinary worker phase instructions only once `ticket_id` is set, and switching back once the ticket resolves. This is a new branch in the prompt builder keyed on `agent.kind === 'session' && !agent.ticketId`, not a reuse of the `interactiveSession` ticket flag — the two stay independent capabilities. The standing "offer a worktree and ticket, don't work informally" instruction lives in this same prompt branch, in `packages/core/src/prompts/` alongside the other role/kind-specific prompt fragments.

### `kind = 'worker'`-only lookups: a second category of hazard, opposite in shape to the dispatcher one

The dispatcher gap (above) needed a query to stop counting `kind='session'`. Several other places have the mirror-image problem: they need to **start** recognizing it. `merge-queue.ts`'s `workerFor()` — "the worker that will perform the merge, spawning one when the ticket has none" — filtered strictly to `kind='worker'`, so a session's ticket reaching the merge queue would find nothing live on it and spawn a second, real `kind='worker'` agent bound to the same ticket, which nothing prevents (the one-agent-per-ticket unique index is itself `kind='worker'`-scoped). `tickets/service.ts`'s `latestWorkerFor()` (retry, reply-while-active) and `livenessViolations()` (stalled-ticket detection) had the same gap, as did `workers.spawn()`'s own "already spawned" check and `decisions/service.ts`'s `askedByWorker()` (routes a `question`/`concern` to the weaver instead of the human). All were widened to `kind IN ('worker','session')` — except `askedByWorker()`, which additionally requires the session to be currently ticketed, since a ticketless session's ask should route like the weaver's own, not like a worker's.

The one place this widening must **not** happen is `releaseWorkersForTerminal()` (marks a terminal ticket's worker `done`) — a session must never be marked done, it returns to ticketless conversation instead (see "Taking a ticket" above). Getting this exactly backwards in either direction was the risk: too broad and a session gets retired like a worker; too narrow anywhere else and the ticket silently spawns a duplicate agent or falls out of stall detection.

### Wake behavior needs no new code

Ticket creation already does not wake the weaver (`tickets.create()` has no `wake()` call), and plan-approval/merge-approval decisions already wake the weaver through `decisions/service.ts` and the merge-queue path, keyed on the decision, not the agent kind. Both are exercised as regression tests for this change rather than new plumbing.

### Attach, interrupt and compact need no new backend plumbing

`agent-attach` is already agent-kind-agnostic. `compactSession(actor, id)` is already generic over any agent id and already drives the runtime's own compaction. The only work here is UI: a chat surface for the session's thread (reusing whatever component renders the weaver's/a worker's conversation), and a manual-compact button generalized from `useCompactWeaver` to accept an agent id, added to that surface and to the `RolesPage.tsx` entry point.

## Risks / Trade-offs

- **[Risk]** Missing the `projectRunning()` gap would silently reintroduce the exact "consumes a worker slot" bug this change exists to prevent, and it would only show up under concurrency (two turns racing), not in a simple single-turn test. → Mitigation: the acceptance-criteria test must assert concurrent behavior (a project at its cap running a worker turn *and* a session turn at the same time), not just a spawn-time check.
- **[Risk]** A prompt branch keyed on `kind==='session' && !ticketId` versus `kind==='session' && ticketId` is two new prompt paths to keep from drifting out of sync with the ordinary worker prompt and the `interactive-sessions` conversational prompt as those evolve independently. → Mitigation: the ticketed-session prompt reuses the same delivery-phase instruction builder a worker's prompt uses, parameterized by agent rather than forked.
- **[Risk]** Factoring worktree provisioning out of `workers.spawn()` touches a code path every transient worker goes through. → Mitigation: extract the provisioning call with no behavior change for the `worker` path first, covered by the existing worker-spawn tests, before adding the `session` call site.

## Migration Plan

Additive: new enum value, new partial unique index, new tool, new prompt branch. No existing `agents`, `tickets`, or `agent_sessions` rows change shape or meaning. No feature flag — the entry point simply does not exist on `RolesPage.tsx` until this change ships, so it has no user-visible effect until then. Rollback is reverting the migration and the code together; no backfill either direction.
