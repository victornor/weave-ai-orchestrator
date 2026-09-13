## Context

See `proposal.md` — Why. V2 is a parallel frontend under `packages/ui/src/v2/`, lazily mounted at
`/v2` (VS-343). `V2RolesPage` today is the placeholder from `v2/pages.tsx`; its route
`/v2/w/$ws/roles` and its rail row already exist and highlight correctly. VS-345 shipped
`v2/WorkerFeed.tsx` (the shared run-event feed with a `compact` variant) precisely so Roles could
embed it.

The data and mutations already exist and are reused, not forked:

- `api/hooks.ts`: `useProjects`, `useWorkers`, `useRoles`, `useRole` (`RoleDetail`: role, charter,
  revisions, workers, concurrency), `useRoleAction` (pause/resume/retire), `useUpdateRole` (PATCH,
  including `maxWorkers`), `usePutCharter`, `useRollbackCharter`, `useStartSession`, `useTickets`,
  `useThreads`, `useCreateThread`, `usePostThreadMessage`, `useWeaver`.
- `v2/WorkerFeed.tsx`: `WorkerFeed` + `useWorkerRun` (VS-345).
- `@weave-ai/shared`: `Role`, `RoleDetail`, `Project`, `projectLabel`, `agentUiStatus`.

V1's `routes/Roles.tsx` implements the same management surface in V1's visual language. V2 must not
change V1, so V2 gets its own components reusing the same hooks; the two are allowed to diverge
visually by design.

## Goals / Non-Goals

- Goal: the V2 Roles screen, grouped by project, with each role's state, count and charter; and the
  kept management actions.
- Goal: a working worker's shared feed expanding in place, so VS-345's feed is reused rather than
  re-implemented.
- Goal: the Hire a role modal whose preview and sent message are the same built string, posted to the
  weaver's chat thread, plus the skill rule that makes the weaver recognise it.
- Non-goal: the V2 Live screen, the Chat pane, the Work/board screen, the worker page's own content.
- Non-goal: any daemon, HTTP route, MCP tool, CLI, migration or V1 change.

## Decisions

### One `v2/RolesPage.tsx` module, re-exported like Needs you

`V2RolesPage` moves out of `v2/pages.tsx` into `v2/RolesPage.tsx` and is re-exported there, exactly
as `V2NeedsPage` is (`pages.tsx` keeps the lazy-route contract). Pure helpers live in the module (or
a sibling) and are exported so they can be unit-tested without a browser:
`groupRolesByProject(projects, roles)`, `liveWorkersOf(workers, roleId)`,
`roleStateLabel(status)`, `buildHireRequest(slug, description)`, and (shared with the chat route)
`defaultThread(threads)` in `lib/threads.ts`.

_Alternative considered:_ one giant component with inline logic. Rejected: the acceptance asks for
tests of grouping and of preview-equals-sent, and pure functions are the cheapest honest way to
assert both.

### The feed is the VS-345 component, wrapped, not copied

Each worker row calls `useWorkerRun(workerId, ws)` (VS-345) to know whether the worker is live and to
read the run's `model`, `usage` and `costCents`. A live worker's row is a toggle; expanding renders
`<WorkerFeed agentId={workerId} ws={ws} compact />` under a header (model + the worker's ticket
title, from `useTickets` mapped by id) and over a footer (spend + **Open in Live**). A non-live
worker's row is a link to `/v2/w/$ws/workers/$workerId`, the old behaviour. Expansion state is a
`Set<string>` on the page keyed by worker id, so each worker toggles independently.

_Alternative considered:_ add a `run` prop to `WorkerFeed` to avoid resolving twice. Rejected: it
edits a VS-345 component this ticket does not own; `useWorkerRun`'s queries are cached and deduped by
React Query, so resolving in the row costs no extra request.

### **Open in Live** targets the V2 Live destination

The mockup wires this control to `go('live')` — the global Live screen. V2's Live screen is its own
ticket and still a placeholder, so the link points at `/v2/live`; it reaches the destination and
gains the worker context when that screen ships. It does not deep-link a worker this ticket cannot
name in that screen's contract.

### The hire message is built once, by one function

`buildHireRequest(slug, description)` returns `` `/hire-role project=${slug}\n\n${description}` ``.
The modal renders its preview from that function and posts its return value verbatim through
`usePostThreadMessage`; there is no second formatting site to drift. Send is disabled until a project
is picked and the description is non-empty, so an empty request never reaches the weaver.

### The weaver thread is resolved from the existing thread list

`useThreads()` returns the workspace's web threads, ordered most-recently-active first.
`ThreadSummary` carries no `is_primary`, so the daemon's primary flag is not on the wire and cannot
be the rule here. The rule is the chat's own: the default thread is the first row, factored into
`packages/ui/src/lib/threads.ts` (`defaultThread`) and used by both V1's chat route and this modal,
so a request posted without an explicit thread lands where the human is looking. If the workspace has
no thread yet, the modal creates one with `useCreateThread` before posting. No new endpoint, no
server change.

### Management actions use the existing endpoints and hooks

- **Pause / resume / retire** — an overflow menu per role calls `useRoleAction`; the API's `reason`
  is the same web-app string V1 sends.
- **Charter drawer** — `useRole(roleId)` for charter and revisions, `usePutCharter` to save an edit
  (a required reason is passed, as the route requires), `useRollbackCharter` for rollback. The
  drawer lists every revision with its reason and time.
- **Max workers** — a number input calls `useUpdateRole({ patch: { maxWorkers }, reason })`; the route
  requires a reason, so the change carries a fixed, descriptive one ("max workers set from the V2
  Roles page").
- **Start session** — the V1 flow: a title (and optional description) calls `useStartSession` with
  the role's project and role, then opens the new worker's page.
- A failed mutation renders an `ErrorState` (the existing `components/States`), never a swallowed
  error.

### The skill rule is prose, and only prose

`skills/weave-ai-hire/SKILL.md` gains a short section: a human message whose first line is
`/hire-role project=<slug>` is a hire request for that project; follow the normal overlap check and
drafting flow, and submit through `weave_role_hire` so the charter still waits for approval.
`templates/weaver.AGENTS.md.tmpl`'s hiring bullet gains one sentence pointing at the format. No
parser, tool or route is added; the weaver already receives the message as ordinary conversation.

_Alternative considered:_ a server-side `/hire-role` command parser. Rejected by captain's decision
and by the ticket's out-of-scope: the format is a request the weaver classifies, not a command the
system interprets.

## Risks / Trade-offs

- **[Many workers make many `useWorkerRun` subscriptions]** → The queries are keyed and deduped, so
  N rows share three server queries; if this ever shows up as cost, the resolution can be lifted to
  the page without changing the feed. Not a concern at current workspace sizes.
- **[`pending_activation` wording]** → The status is mapped to "awaiting hire approval" in one
  `roleStateLabel` function so the row, any chip and the drawer cannot disagree.
- **[The skill rule is only as good as the weaver's reading]** → The rule states the exact first-line
  format the modal emits, and the modal's preview shows it, so a mismatch would be visible to the
  human before sending.
- **[No HTTP route change]** → The thread-message endpoint, the roles routes and the workers routes
  are all existing; this ticket adds no API surface.

## Migration Plan

Frontend-only and additive, plus agent-facing prose. No data migration and no deploy step beyond the
normal UI build. Rollback is reverting the V2 module and the skill text; V1 is unaffected either way.

## Open Questions

_None that change the specs, approach or task breakdown. The V2 Live screen's worker focus is its own
ticket, and "Open in Live" reaches the Live destination until then._
