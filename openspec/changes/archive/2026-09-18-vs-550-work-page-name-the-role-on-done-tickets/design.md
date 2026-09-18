## Context

See `proposal.md` for motivation. The current state that shapes the approach:

- `packages/ui/src/v2/work/Work.tsx` builds a `WorkRow` whose `workerName` comes from the live
  worker (via `liveWorkersByTicket`) or from any worker the `/workers` list returned. Retired workers
  are excluded from that list by default, so a landed ticket has no name and falls back to
  `'unassigned'`. The ticket already carries `assigneeRoleId`; the UI already loads every role via
  `useRoles()`.
- Tickets already carry `mergeStartedAt`, `mergeQueuedAt`, `mergeBypasses`, `priority`, `number` and
  `delivery.ciState`/`ciStateAt`. `mergeStrip` (`packages/ui/src/lib/board.ts`) already counts
  landing/waiting over the loaded set and names the next ticket, but nothing per-card and nothing
  linkable. The shared `compareMergeQueue` is the one queue order rule (PLAN §11.4).
- Plan provenance is stored only in `plan_drafts`: `created_ticket_id` links a draft to the ticket it
  became, and `plans` carries `submitted_at`. `PlanningService.findDraftByTicket` already does the
  reverse lookup server-side (VS-517). Nothing is on `tickets`, and the ticket forbids adding a
  column there.
- There is no URL for a plan on main. Plans are opened by `PlanModal`, which `ChatPage` renders and
  opens from its own local state; no route or search param addresses a plan. A sibling ticket in the
  same roadmap block will replace that modal with plan tabs in the weaver chat.

## Goals / Non-Goals

**Goals:**

- A done ticket names the role that did it, everywhere Work and the ticket page show that label.
- The board tells landing from waiting by `merge_started_at`, shows a waiting ticket's queue
  position, shows a landing ticket what it waits on, and makes every merge summary figure reach the
  tickets it counts.
- A planner-dispatched ticket is distinguishable from a weaver-filed one and from a submission-time
  ticket, names its plan, and shows nothing when it has no plan.
- One shared read model for plan origin, so the board and the ticket page can never disagree.

**Non-Goals:**

- No new database column on `tickets`; no migration at all.
- No new plan viewer, plan route or plan tab. The plan link targets the surface plans open on today.
- No change to merge-queue admission, ordering or the merge pipeline — presentation only.
- No change to how the generic ticket list is shaped for other consumers.

## Decisions

### 1. Role label precedence: live worker, then role, then unassigned

A pure function resolves the label from `{ liveWorkerName, roleName, historicalWorkerName }`:
live worker name → role name → historical worker name → `'unassigned'`. Work's `WorkRow` gains a
`roleName` looked up from the already-loaded `useRoles()` list, and the card/table/phone/ticket-page
all call the same function.

- Why role over the historical worker name once the worker is gone: the acceptance asks for the role
  that *did* the ticket, and the role survives the worker; the spec's card anatomy already calls that
  row the "worker role".
- Why live worker first: an in-progress ticket must keep the running worker's identity, which is an
  explicit acceptance criterion.
- Alternative rejected: fetch workers with `includeRetired: true` and show the last worker's name.
  That answers "which agent" but not "which role", and the ticket names the role as the required
  answer.

### 2. Plan origin is a read model, derived from the draft link

One core read joins `plan_drafts` (where `created_ticket_id IS NOT NULL`) to `plans` and `tickets` and
returns `{ ticketId, planId, planTitle, planStatus, dispatched }`, exposed as a single-ticket lookup
and a workspace-wide list.

- `dispatched` is derived as: the plan has no `submitted_at`, **or** the ticket's `created_at` is
  earlier than the plan's `submitted_at`. Dispatch can only happen while the plan is `drafting`
  (enforced by `dispatchDraft`), so a ticket linked while the plan was drafting predates
  `submitted_at`; a ticket the weaver creates from `creationOrder` is created after submission.
- Why no new storage: a `dispatched_at` column on `plan_drafts` would duplicate timing already
  recorded (`plans.submitted_at` and `tickets.created_at`), and the ticket explicitly says to read the
  existing link rather than duplicate it. Both compared fields are immutable once set.
- Why one shared read: the board and the ticket page both need the same answer; computing it twice
  invites them to disagree.

### 3. Delivery: a workspace-scoped origins read plus `plan` on ticket detail

- The board loads `GET /api/w/:ws/plan-origins` once and maps `ticketId → origin`. The board shows
  tickets from several projects at once, so a per-project route would loop; a bulk read keeps it to
  one request.
- The ticket detail route adds `plan` from the same core lookup, so the ticket page needs no extra
  request.
- Alternative rejected: populating a plan field on every row of the generic ticket list. It would
  touch a shared shape consumed by the chat and CLI, and force the join on every list call to
  serve a board-only need.

### 4. The plan name links to the weaver chat

The link target is the workspace chat (`/w/$ws/chat`), the surface that opens a plan today via the
Plan modal. It is resolved by one small helper so a later ticket that gives plans their own URL
changes one line. No route, modal or viewer is added here.

- Why not the project page: it does not open plans, so it would be a misleading link.
- Why not a `?plan=` deep link into the modal: a sibling ticket is reworking exactly that surface,
  and the ticket says not to build a plan viewer.

### 5. Merge state is one pure function over the loaded tickets

A pure function groups the loaded `merging` tickets by `projectId`, classifies each as landing
(`mergeStartedAt` set) or waiting, orders the waiting ones with `compareMergeQueue`, and returns, per
ticket and for the strip: landing/waiting, a 1-based position, and — for a landing ticket — the wait
phase and start from `delivery.ciState`/`ciStateAt` (reusing `mergeWaitPhase`/`mergeWaitLabel`). The
strip renders its counts, the active landing ticket and the next waiting ticket as links to
`/w/$ws/tickets/$ticketId`.

- Why over the loaded set: it is the same set the strip already counts, so card positions and the
  summary stay consistent; the ticket detail keeps the daemon's exact `mergeQueue.position` for the
  one-ticket view.

## Risks / Trade-offs

- **Board queue position can differ from the daemon's exact position** when a project has more
  waiting tickets than the loaded page holds → the board's position is over the same loaded set the
  strip counts and is labelled as the queue position; the ticket page keeps using the exact
  `mergeQueue.position`. A project large enough to overflow 300 open tickets is already an edge case
  the strip shares.
- **`dispatched` is a derived comparison** rather than a stored flag → the two fields are set only at
  dispatch/submission time and are not editable afterwards; unit tests cover the before/after
  boundary and the null-`submittedAt` (drafting or discarded) case.
- **The plan link does not open the specific plan** because no URL addresses one today → ship the
  link to the current surface, keep the target in one helper, and note it as a known limitation the
  sibling plan-tabs ticket can tighten.
- **Role names may not be loaded on first paint** → the label falls back to the historical worker
  name, then "unassigned", and resolves when the roles read lands.

## Migration Plan

No schema or data migration. Ships in the normal UI/server build; `weave daemon upgrade` deploys it.
Rollback is the previous release build; nothing persisted changes shape.

## Open Questions

None that change the specs or the task breakdown.
