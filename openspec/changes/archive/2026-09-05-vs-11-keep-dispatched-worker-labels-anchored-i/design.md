## Context

See `proposal.md` — Why. The pieces this design leans on, all verified in the tree:

- The chat's worker row is `packages/ui/src/routes/Chat.tsx:218-230`: `(workers.data ?? []).map(...)` over `useWorkers({ status: 'running' })` (`:71`), rendered between the message list and the decision cards, inside the same scroll container but after everything else. It is the whole of today's behavior — there is no other dispatch surface in the chat.
- `thread_messages.run_id` is written for every message from the acting run: `insertMessage` takes `opts.runId ?? actor.runId ?? null` (`packages/core/src/threads/service.ts:57`), and the conductor's replies come through `ac_human_send`, which passes `{ runId: ctx.claims.runId }` explicitly (`packages/server/src/tools.ts:424`). The field is already on the `ThreadMessage` type the web consumes.
- An agent tool call is an actor with a run: `actorFor` maps a run principal to `{ kind: 'agent', id: claims.agentId, runId: claims.runId }` (`packages/server/src/types.ts:49-53`). A human's actor has no `runId`.
- Ticket rows already carry two run references, `checkout_run_id` and `execution_run_id` (`packages/db/src/migrations/0001_init.sql:62`), so a third is an existing shape rather than a new idea. `Db.insert` maps camelCase keys to snake_case columns and `Db.all` maps back, so a new column costs one migration line and one type field.
- Agent rows are never deleted; retirement sets `status = 'retired'` and `retired_at`. `workers.list` already accepts `includeRetired` (`packages/core/src/workers/index.ts:169`, route at `packages/server/src/routes/workers.ts:13`), and `tickets.list` already accepts `includeTerminal` (`packages/core/src/tickets/service.ts:417`, route in `packages/server/src/routes/tickets.ts`). Both are consumed here as they stand.
- `worker.*`, `ticket.*` and `run.*` workspace events already invalidate the workers and tickets queries (`packages/ui/src/api/events.ts:191-233`), so a label re-renders on a state change without any new event plumbing.
- The nine UI status tokens and their glyphs already include `done` and `failed` (`packages/shared/src/enums.ts:132`, `packages/ui/src/lib/status.ts`), and `WorkerChip` already renders a glyph plus a name (`packages/ui/src/components/Chips.tsx:35`). Nothing new is needed in the visual vocabulary.

The one thing that does not exist is the link from a dispatched worker back to the conductor turn that caused it.

## Goals / Non-Goals

**Goals**

- Satisfy `specs/conductor-chat/dispatch-labels/` in the web chat with the smallest durable addition to the data model, and none to the HTTP surface.
- Keep every label derivable from rows the daemon already persists, so reload correctness is a property of the design rather than a case to handle.
- Leave today's behavior in place for anything the new anchoring cannot explain.

**Non-Goals**

- No new event type, no new route, no change to the run engine, the supervisor or the worker spawn path.
- No shared component with the terminal chat; the ticket scopes this to the web app.
- No backfill of existing rows.

## Decisions

### 1. Anchor on the ticket's creating run, not on the worker

A label needs to know which conductor message caused it. The obvious candidate — record the spawning run on the agent — does not work, because the conductor does not spawn workers. The conductor files a ticket with a role; the supervisor's 1 s sweep picks up assigned, worker-less tickets and calls `workers.spawnForTicket({ kind: 'system', id: null }, ticket.id)` (`packages/core/src/supervisor/index.ts:145-156`). The spawn therefore happens outside any conductor run, with a system actor that carries no `runId`. The only two direct spawn paths from an agent actor are a human reply and an explicit retry (`packages/core/src/tickets/service.ts:346`, `:574`).

So the durable fact worth recording is the one the conductor actually performs: it created the ticket, inside its run. `tickets.create` already receives that actor and already writes `created_by_kind` / `created_by_id` from it (`packages/core/src/tickets/service.ts:385`); adding `created_run_id` is one more field from the same actor. The chat then reads: message → `run_id` → tickets with that `created_run_id` → each ticket's worker.

Consequences, accepted deliberately:

- A ticket worked by a second worker (a relaunch, or a fresh worker after a human reply) keeps **one** label, which follows the ticket's current state. That is the readable history the ticket asks for; two labels for the same piece of work under the same message would not be.
- The label appears as soon as the ticket exists, a beat before the supervisor spawns the worker. It shows the ticket's own state during that beat, which is honest — the work is filed and queued.
- A ticket the conductor filed unassigned is not a dispatch and is filtered out by the "has, or has had, a role" test (`assigneeRoleId || workerId`), so the chat does not claim work was started when it was not.

*Alternative considered: record the spawning run on the agent, falling back to the ticket's first run-attributed `activity` row when the spawn actor is the system.* Rejected: it needs the same ticket-side provenance to work at all, and gets it by querying the `activity` audit log from the spawn path — turning an audit table into a load-bearing lookup — to produce a label per worker instead of per dispatch, which is not the better rendering.

*Alternative considered: no schema change, attribute by time — a worker created after conductor message N and before N+1 belongs to N.* Rejected: it is a guess that becomes wrong exactly when it matters. A worker the supervisor spawns hours later (a retry, a role that was full, a reopened ticket) would attach to whatever the newest message happens to be, and the chat would assert a causal link that never existed.

### 2. Anchor to the last message of the run

A run can produce several outbound messages, and the tickets it filed may have been created before, between or after them. Attaching a label to the first message would put it above text that has not yet mentioned the work; attaching per-timestamp would interleave labels through a single reply for no gain. The label goes after the **last** message carrying the run id — the point at which the turn's account of itself is complete. In practice the conductor sends one message per turn, so this only matters at the edges, and it is one line of grouping either way.

### 3. Outcome = the worker while it is live, the ticket once it is not

The label must read truthfully when the work ends, and neither record alone can say so:

- `agentUiStatus` maps both `done` and `retired` to `done` (`packages/shared/src/ui-status.ts:26`), so a retired worker on a cancelled ticket would claim success.
- The ticket alone cannot show that a worker is mid-turn right now.

The rule is therefore: while the worker is live (`provisioning`, `active`, `running`, `paused`, `error`) the label shows `agentUiStatus(worker.status)` — which already yields `failed` for `error` and `working` for `running`; once the worker is `done` or `retired`, or when no worker exists yet, it shows `ticketUiStatus(ticket.status)` — `done` for a completed ticket, `failed` for a cancelled one, and `needs-you` / `blocked` / `merging` for work that has stopped without finishing. Both functions are the existing shared mapping; this change adds no status vocabulary and no new mapping table, only the choice of which record to ask.

*Alternative considered: derive the outcome from the worker's last run status (`succeeded` / `failed`).* Rejected: a run failing is not the dispatch failing — the daemon retries runs, and a worker that hit a usage limit is not a failed piece of work. The ticket is the record of whether the work succeeded.

### 4. Render labels inside the message list; keep the pinned row as the fallback

The message list becomes a list of entries rather than a list of messages: each message, followed by the labels anchored to it. Position is then structural — a later message is a later entry, and no re-render can move a label to the bottom.

Dispatches that no message in the loaded thread accounts for keep the existing row below the conversation, unchanged in appearance and still filtered to live workers. This is what makes the change strictly additive: a worker the human started from the board, and every ticket created before this migration, behave exactly as they do today. Removing that row instead would be a smaller diff and a regression.

The thread query loads the most recent 200 messages (`useThreadMessages`), so a dispatch older than that window has no anchor on screen and falls to the fallback row if it is still live, or is simply not shown if it is not. That is the same horizon the conversation itself has.

### 5. Widen the two queries the labels read

`useTickets` in the chat must pass `includeTerminal: true`, or a ticket disappears from the client the moment it is done and takes its label with it — the exact bug being fixed, one layer down. `useWorkers` must drop `status: 'running'` and pass `includeRetired: true` for the same reason. Both flags exist on the routes and on `workers.list` / `tickets.list`; only `TicketQuery` in `packages/ui/src/api/hooks.ts:311` needs the field declared. The cost is a larger payload on two workspace-scoped queries that are already cached and invalidated by SSE, on the order of the workspace's lifetime ticket count.

*Alternative considered: a dedicated `GET /threads/:id/dispatches` endpoint returning exactly the labels.* Rejected for this change: it adds a route and a view model to `docs/API.md` to save two query parameters, and the chat already holds both lists for its ticket chips and its worker row.

## Risks / Trade-offs

- **The label is one per ticket, not one per worker** → Accepted and specified: a relaunched or replaced worker updates the existing label in place. If per-worker history is ever wanted, it belongs on the ticket page, which already lists runs.
- **Widened queries grow with the workspace's history** → Both are workspace-scoped lists already fetched by the chat, capped by the existing `limit` (200 tickets), cached by TanStack Query and invalidated only on relevant events. If a workspace ever outgrows it, the answer is the dedicated endpoint in Decision 5's alternative, not a narrower filter that reintroduces the bug.
- **`created_run_id` is null for every existing ticket** → By design; those dispatches fall to the fallback row, which is today's behavior. No backfill is attempted, because the activity log's run attribution is not reliable enough to invent history from.
- **A conductor turn that dispatches without replying leaves no anchor** → The label falls to the fallback row while the work is live. The alternative — inventing a synthetic chat entry for a turn the human never saw — would put text in the conversation that the conductor never said.
- **A migration on a live database** → Additive and nullable, so an older daemon build reading the same file is unaffected and rollback is a release revert with no data step. This matches the release model in the project knowledge base: no down-migrations, roll back by reinstalling the previous release.

## Migration Plan

One additive migration file in `packages/db/src/migrations/`, applied by `Db.migrate()` at daemon start in filename order, adding a nullable `created_run_id` to `tickets`. No data migration and no backfill. Rollback is reverting the release; the extra column is ignored by the previous build, and the chat in that build falls back to the pinned row it always used.

## Open Questions

None. The three judgement calls that could have become questions — anchoring on the ticket rather than the worker, choosing the record that decides the outcome, and keeping the pinned row as a fallback — are settled above with their rationale.
