## Why

Every agent in the system today is disposable and ticket-bound: a worker is spawned for one ticket and retires when it lands. There is no way for a human to hold a standing conversation with a role over days — asking questions, thinking out loud, only occasionally turning that conversation into ticketed work. The weaver already proves the shape (a long-lived, no-ticket, `persistent`-session agent) works; this change gives every role the same shape, reachable per-project, without disturbing how transient workers are spawned, gated or landed.

## What Changes

- New agent kind `session`: one persistent, no-ticket agent per (role, project), opened on demand from the project/role surface and reused thereafter — never recreated, including across a daemon restart, exactly like the weaver's own `persistent` session already resumes.
- A `session`-kind agent is **not** a `worker`-kind agent, so it is invisible to every place that counts or gates the project's `maxWorkers` pool (`liveInProject` in `workers/index.ts` and `roles/index.ts`, the dispatcher's project-cap check) — no code in that pool needs to change; the exemption falls out of the existing `kind='worker'` filters.
- Ticketless by default: every turn gets the same conversational posture `interactive-sessions` already gives a ticket-flagged worker, but as the unconditional default rather than a first-turn hold — it answers, investigates, and explains, and never runs the ordinary delivery phases, until asked.
- On request only, the session files a ticket (`weave_ticket_create`), takes it as its own — via a new self-take path rather than the weaver-only `weave_ticket_assign` — and is given a worktree the same way a spawned worker is. From that point its turns follow the exact same phase table, plan-approval gate and merge-approval gate as any worker; nothing about landing is relaxed. When the ticket reaches a terminal status, the session's `ticket_id` clears and it returns to ticketless conversation, keeping its session history.
- Filing the ticket does not wake the weaver (already true of ticket creation today); the plan-approval and merge-approval decisions the ticketed work goes through wake it exactly as they do for a transient worker (already true of those decision paths today) — this change must not regress either.
- A manual compact control for a session's own turns, reusing the existing generic `compactSession` service (already runtime-agnostic) the weaver's own "Compact now" button already calls — a UI/route addition, not a new context-management mechanism.
- Interrupt-mid-turn reuses the existing agent-kind-agnostic attach mechanism; no new interrupt plumbing.
- A "Chat" entry point per role on the project/roadmap role surface (`RolesPage.tsx`) that opens (or creates, if absent) that role's persistent session.
- The role's prompt for a `session`-kind agent states, as a standing instruction, that it should offer a worktree and a ticket when the human proposes work rather than working informally — this document names exactly where that instruction lives.

## Capabilities

### New Capabilities

- `persistent-sessions`: a long-lived, per-role, no-ticket agent — its lifecycle (open/resume/restart-survival), its exemption from the project's transient-worker cap, how it takes a ticket on request and returns to ticketless conversation afterward, and its interrupt/compact controls.

### Modified Capabilities

- `role-management`: a role now has at most one persistent session, reachable from the role's surface; the "Start session" affordance decides between opening the persistent session and starting an ordinary ticket-bound interactive session.

## Impact

- **Schema**: `agents.kind` enum gains `session`; a new partial-unique index (one live `session`-kind agent per role, mirroring `agents_one_conductor`); `agent_sessions`/session-policy resolution extended to force `persistent` for `kind='session'` the same way it already does for `weaver`/`planner`.
- **Core**: `packages/core/src/runs/engine.ts` (`sessionPolicyFor`), `packages/core/src/workers/index.ts` (worktree provisioning factored out so a `session` agent can be handed one without going through `spawn()`), `packages/core/src/tickets/service.ts` (a self-take path), `packages/core/src/prompts/*` (ticketless-conversation prompt for `session`, and the standing offer-a-worktree instruction).
- **Server**: `packages/server/src/tools.ts` (a scoped self-take tool; a route/tool for manual compact of a session agent), dispatcher candidate query (verify `kind='session'` is included, not just tolerated).
- **UI**: `packages/ui/src/v2/RolesPage.tsx` (entry point), the chat surface reused for the session's thread, a manual-compact button generalized from `useCompactWeaver`.
- **No change** to transient worker spawn, the role hiring flow, the weaver's own ticket routing, or how a ticket lands.
