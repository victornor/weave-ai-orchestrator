## Context

VS-398 is tiered `deep` for two reasons: a new agent kind with its own session, tools and storage
(costly to undo), and two systems that must agree (the planner's submitted plan and the weaver's
ticket creation). This document makes and justifies the four decisions the ticket asks the plan phase
to settle, then lists collisions with in-flight work.

Researched precedents, all read directly from `main` before deciding:
- **Interactive sessions** (`openspec/specs/interactive-sessions/`): the existing "new conversational
  agent" pattern. It is explicitly *not* a new agent kind — `start/spec.md` requires "A session always
  has a ticket" and provisions the session's agent "exactly as spawning a worker for that ticket
  would." Its conversational posture is a prompt/tool-allowlist gate on an ordinary worker
  (`packages/core/src/runs/engine.ts`'s `FIRST_TURN_ALLOWLIST`, `conversational-posture/spec.md`), not
  a parallel runtime.
- **Agent kinds today**: exactly two, `AGENT_KINDS = ['weaver', 'worker']`
  (`packages/shared/src/enums.ts:7`), enforced end to end — `agents.kind` has a SQLite `CHECK`
  (`packages/db/src/migrations/0001_init.sql:36`, widened once already by `0027_agent_kind_weaver.sql`
  for the `conductor`→`weaver` rename), tool scope is switched on `agentKind` in
  `packages/server/src/tools.ts`/`mcp.ts`, and `agents.ticket_id` is how a worker's identity, worktree
  and session all key off the same row.
- **The roadmap feature** (VS-397, unmerged, `origin/ac/vs-397-...`): the closest existing analog for
  "a parked, project-scoped idea that later links to a ticket" — `roadmap_items.ticket_id` set once a
  ticket is filed. Its migration (`0040_roadmap_items.sql`) and service
  (`packages/core/src/roadmap/index.ts`) are the pattern this proposal's storage and dense-position
  reordering copy.

## Decision 1 — Planner model: a new `planner` agent kind, with its own curated tool list

**Decision:** `AGENT_KINDS` gains a third value, `'planner'`. It is not a mode of `worker` and not the
`weaver` in disguise. Its tools are an explicit, hand-picked list — not `COMMON_TOOLS` plus
subtractions.

> **Revision (2026-09-14, captain + weaver review):** two corrections from captain and two concerns
> from the weaver's plan review land in this decision. Captain: (1) a draft carries no reason string
> for its suggested tier — see Decision 2; (2) the planner runs on **the weaver's own model and
> runtime** (the workspace's configured weaver model), not the `deep` worker-model option, with **no
> separate per-workspace planner setting** — it simply follows the weaver's model/runtime config,
> including a later change to it. This removes an entire axis of configurability from the original
> decision and is reflected below. Weaver review: read-only must be *enforced*, not left to "the
> planner has no write tool" as the only guarantee, and the planner's reads must be scoped to its own
> project, not every project in the workspace. Both are folded in below.

**Why not reuse the interactive-session pattern (a flagged worker):** that pattern's central
invariant — "a session always has a ticket" — is the wrong shape here on purpose. Planning happens
*before* any ticket exists; that is the entire point of the feature. A ticket-less worker is not
something the current model allows (or should allow: a worker's tool scope, worktree and
`ticket_id`-keyed identity are all ticket-shaped). Special-casing "a worker with no ticket and a
different tool list" would mean auditing every place that assumes a worker has one, for a shape that
is conceptually a different thing. A distinct kind keeps the ticket-bound invariant intact for workers
and gives planning its own, smaller invariant instead: a planner session always has a plan.

**Why not the weaver:** the ticket is explicit ("a new agent kind, not the weaver"), and the weaver's
tool scope (`WEAVER_TOOLS`) is real authority — `weave_ticket_create`, `weave_worker_message`,
`weave_decision_answer`. Giving the planner the weaver's identity, even temporarily, means auditing
every one of those tools for whether "acting as the weaver, but read-only" actually holds — riskier
than a clean, small allowlist.

**Why a hand-picked tool list, not `COMMON_TOOLS` minus writes:** most of `COMMON_TOOLS` is ticket- or
worktree-shaped (`weave_ticket_checkout`, `weave_ticket_document_put`, `weave_worktree_status`,
`weave_ticket_merge_done`, `weave_artifact_kit`) and meaningless for an agent with neither. The
planner's list is built up, not filtered down:

- Read-only, reused as-is: `weave_inbox`, `weave_ticket_list`, `weave_ticket_get`, `weave_spec_list`,
  `weave_spec_get`, `weave_spec_search`, `weave_spec_change_get`, `weave_openspec_status`,
  `weave_knowledge_docs`, `weave_knowledge_doc_get`, `weave_knowledge_get`, `weave_knowledge_search`,
  `weave_role_list`, `weave_role_get` (the latter two move from `WEAVER_TOOLS`-only to
  `weaver`-or-`planner` scope — no behavior change for the weaver). Every one of these is called with
  the plan's own `projectId` implicitly bound from `agent.planId → plans.project_id`, never a
  caller-supplied one — see "Read scope" below.
- New, and the only MCP tools that write, scoped to the calling agent's own plan (`agent.planId`) —
  refused with `forbidden` for any other plan id: `weave_plan_get`, `weave_plan_draft_add`,
  `weave_plan_draft_update`, `weave_plan_draft_remove`, `weave_plan_draft_reorder`. There is
  deliberately **no `weave_plan_submit` in this list** — see Decision 3's revision.
- Explicitly absent: `weave_ticket_create` (even though it is `scope: 'all'` today — the planner is
  the one agent kind carved out of it), `weave_worker_message`, `weave_decision_answer`,
  `weave_human_send`, `weave_ask`, `weave_report`, `weave_schedule_wakeup`,
  `weave_ticket_open_pull_request`, and everything else in `WEAVER_TOOLS` / `WORKER_ONLY_TOOLS`.

> **Addendum (2026-09-14, apply-phase finding):** the planner needs a way to talk to captain at all,
> and this decision's tool list originally had none — `weave_human_send` is weaver-only and
> `weave_ticket_comment` needs a ticket the planner never has. Added `weave_plan_reply` (posts to the
> plan's own `thread_id` via `ThreadsService.outbound`), and generalized
> `isHumanReplyToolEvent`/`HUMAN_REPLY_TOOLS` (`packages/shared/src/tools.ts`) so transcript rendering
> treats it the same way as `weave_human_send`. This is inside the accepted design (captain chats
> with the planner in the modal, per the ticket) — a completion, not a scope change. Two more latent
> bugs surfaced while wiring the spawn path, both in code that switched on `agentKind` and silently
> defaulted anything non-`weaver` to worker-shaped behavior: `modelSettingFor`
> (`packages/core/src/models/resolve.ts`) would have run the planner on `models.workers`, and
> `sessionPolicyFor` (`packages/core/src/runs/engine.ts`) would have given it `per_ticket` (fresh
> session every turn) instead of `persistent`. Both fixed.

**Read scope: the plan's own project, plus `shared` knowledge — never `workspace`/`decisions`, never
another project.** `weave_knowledge_get`/`_search`/`_docs`/`_doc_get` filter `knowledge_files` to
`scope IN ('project', 'shared')` and `project_id = plans.project_id` for a `planner`-kind caller,
excluding the `workspace` and `decisions` scopes entirely (those carry cross-project and
approval-history content a planning conversation for one project has no business reading).
`weave_ticket_list`/`_get` and `weave_spec_*` likewise resolve to the plan's own `project_id`,
ignoring or rejecting a different one if a tool call somehow supplied it. This is the same shape as
`weave_ticket_list`'s existing worker-vs-weaver project binding
(`packages/ui`/knowledge base note: "a worker reads own project, weaver must pass `projectId`") — the
planner is pinned like a worker, never given the weaver's cross-project reach.

**Isolation: a disposable worktree, never the shared clone — plus denied write tools, not either/or.**
The weaver's review is right that "the planner reads from `clone_path`" (this decision's original
text) is unsafe on two counts: that path is mutated by the daemon's own fetch and by landing workers
concurrently, and a Claude/Codex/OpenCode runtime brings real `Write`/`Edit`/`NotebookEdit`/`Bash`
tools that a curated MCP tool list does nothing to restrict. Both are fixed, independently:

1. **A disposable worktree, provisioned exactly like a worker's**, via the existing
   `WorktreeProvider` interface, checked out from the project's default branch, with `agents.plan_id`
   set instead of `ticket_id` (already nullable on `worktrees.ticket_id` — no schema change needed
   there). It is never the project's shared `clone_path` and is never used for a commit, a branch
   worth keeping, or a PR. It exists solely so the planner's file reads are consistent and unaffected
   by concurrent daemon git operations. Removed when the plan is submitted or discarded — the same
   moment its `agents` row retires.
2. **Every write-capable built-in runtime tool is denied for the entire session**, via the same
   `TurnInput.permission.deniedTools` mechanism `packages/core/src/runs/engine.ts` already uses for
   the interactive-session `FIRST_TURN_ALLOWLIST` ("Enforced by the runtime's own `--allowedTools`,
   not by prompt wording" — `engine.ts:27`). A planner turn sets `permission.mode: 'restricted'` with
   an explicit allowlist (`Read`, `Grep`, `Glob`, plus its MCP tool names) rather than a denylist, so
   a runtime that adds a new built-in write tool later is safe by default, not by omission. This is
   the actual guarantee behind "never changes the repo" — the worktree is what makes an attempted
   write inconsequential even in the hypothetical where enforcement itself had a bug; the denied-tools
   list is what makes the attempt not happen at all. Both together, not one instead of the other.

   **Failing closed (apply-phase addition, per the weaver's review):** the allowlist mechanism only
   protects a planner if the resolved runtime actually enforces it. Before building a planner's turn,
   the engine checks the runtime's own declared `capabilities.permissionModes` for `'restricted'`; if
   it is absent, the turn refuses to run at all (`runtime_unreachable`) rather than falling back to an
   unrestricted mode. Every built-in adapter declares `'restricted'` today, so this is dormant unless
   a future adapter omits it — which is exactly the point of checking rather than assuming.

**Session lifecycle:** one `agents` row per plan (`kind = 'planner'`, `plan_id` set, `ticket_id`
`NULL`), `sessionPolicy: 'persistent'` (same semantics the weaver already uses — resumed across turns
until retired). `model`/`runtime_id` are **not** read from `models.workers`/`workerModelId` at all —
they are resolved from the workspace's `models.weaver` config, the same source the weaver's own turns
read, at spawn and again on every turn, so a captain change to the weaver's model takes effect on the
planner's very next turn without touching the plan's own row. Opening the modal: if the project has a
`drafting` plan, resume its existing live planner agent (mirrors interactive-sessions' "return the
existing worker, do not create a second one"); if not, create the plan row, provision its worktree and
its planner agent immediately, in the same action — mirroring `start/spec.md`'s "does not wait for the
next scheduled spawn." Each human message in the modal is a `human_message` wake for that agent, one
turn, resuming the same session ref (`packages/core/src/sessions/index.ts`) — this is exactly how the
weaver's own persistent session already works, so no new resume mechanism is needed. The agent is
retired, and its worktree removed, when the plan is submitted or discarded.

## Decision 2 — Storage: three new tables, plus one column on `agents`

> **Revision (2026-09-14, captain correction):** the original schema below carried a `tier_reason`
> column ("a one-line reason" for the suggested tier). Captain removed that field from the feature
> entirely — a draft carries `suggested_tier` and an optional `tier_override`, nothing explaining the
> suggestion. Removed from the DDL below, and from every tool, UI surface and spec that referenced it.

**Decision:** migration `0041_plan_drafts.sql` (see note under Collisions on the number). Follows the
`0040_roadmap_items.sql` house style: doc comment explaining each choice, `CREATE TABLE IF NOT EXISTS`,
inline `CHECK` for enums, explicit index statements.

```sql
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES channel_threads(id),
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  title TEXT,
  status TEXT NOT NULL CHECK (status IN ('drafting','submitted','discarded')) DEFAULT 'drafting',
  created_by_kind TEXT NOT NULL, created_by_id TEXT NOT NULL,
  submitted_at TEXT, discarded_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS plans_one_drafting_per_project ON plans(project_id) WHERE status = 'drafting';
CREATE INDEX IF NOT EXISTS plans_project_status ON plans(project_id, status);

CREATE TABLE IF NOT EXISTS plan_drafts (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('change','task','scout','operational')),
  priority TEXT NOT NULL CHECK (priority IN ('critical','high','medium','low')) DEFAULT 'medium',
  target_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
  suggested_tier TEXT NOT NULL CHECK (suggested_tier IN ('quick','standard','deep')),
  tier_override TEXT CHECK (tier_override IN ('quick','standard','deep')),
  status TEXT NOT NULL CHECK (status IN ('pending','created','failed')) DEFAULT 'pending',
  created_ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
  failure_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_drafts_plan_position ON plan_drafts(plan_id, position);

CREATE TABLE IF NOT EXISTS plan_draft_blockers (
  plan_draft_id TEXT NOT NULL REFERENCES plan_drafts(id) ON DELETE CASCADE,
  blocks_on_draft_id TEXT NOT NULL REFERENCES plan_drafts(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_draft_id, blocks_on_draft_id)
);

ALTER TABLE agents ADD COLUMN plan_id TEXT REFERENCES plans(id);
CREATE UNIQUE INDEX IF NOT EXISTS agents_one_planner_per_plan ON agents(plan_id) WHERE kind = 'planner' AND status NOT IN ('retired');
```

Plus a full-table rebuild of `agents` (FKs off, same treatment as `0027`) to widen `kind`'s `CHECK` to
`('weaver','worker','planner')`.

Notes on choices:
- `project_id NOT NULL`, no `workspace_id`-only-scoped variant — copies `roadmap_items`'s reasoning
  (`0040`'s comment): the database is already one per workspace and the project already carries it. A
  plan cannot span projects (out of scope per the ticket), so `project_id NOT NULL` is the right scope,
  not a nullable workspace-level option.
- `plans_one_drafting_per_project`: at most one *drafting* plan per project at a time — this is what
  makes "closing and reopening the modal resumes the conversation and the list" well-defined (there is
  only ever one to resume). Submitted/discarded plans are kept as history, not deleted, so multiple
  historical plans per project are normal.
- `plan_drafts.kind` deliberately excludes `question` — the ticket's own field list names exactly
  `change/task/scout/operational`. Read literally, not an oversight to raise as an ask: a plan is
  drafting a body of work with dependencies and tiers, and a `question` ticket (answered in a comment,
  no code) does not carry a tier or a worktree-shaped plan of attack the same way. If this needs
  revisiting, it is a one-line `CHECK` change later, not a blocker now.
- `plan_drafts.status` (`pending/created/failed`) plus `created_ticket_id`/`failure_reason` is the
  "linked to its created ticket, or the weaver says why it couldn't be" mechanism from the ticket's
  acceptance criteria — deliberately one-directional (draft → ticket). No column is added to `tickets`
  for the reverse link, so no ticket-lifecycle capability changes.
- `tier_override` overrides `suggested_tier`; the effective tier (`tier_override ?? suggested_tier`)
  is what becomes the created ticket's `workerModelId`. Both use the three canonical tier ids
  (`DEFAULT_WORKER_TIERS`, `packages/shared/src/config.ts`) per the ticket's own wording; a workspace
  that has renamed or removed those default catalog entries is a pre-existing edge case for
  `workerModelId` generally, not new here.
- `plans.thread_id` reuses `channel_threads`/`thread_messages` (a `web`-kind thread bound to the
  project, not a ticket) so the modal's chat reuses `useThreadMessages`/`usePostThreadMessage`
  unchanged. **Audited (2026-09-14):** reading, posting and listing (`get`/`postMessage`/`list` in
  `packages/core/src/threads/service.ts`) carry no weaver assumption — they operate on whatever
  `agent_id` a thread already has. Thread *creation* does: `bindOrGet` is the only place a
  `channel_threads` row is inserted, and it hardcodes `agentId: conductor().id`. There is today no
  path to create a thread owned by any other agent. A plan's thread cannot be created through
  `bindOrGet` as it stands — the spawn/create-plan orchestration (task 2.3 / the modal's "start or
  resume" HTTP action) needs either a new creation path or a parameter on this one naming the owning
  agent. This is a real, specific finding, not a residual "go check" — recorded as its own tasks.md
  item so it is not lost inside the larger spawn task.

## Decision 3 — Handoff: `plan_submitted` wake, weaver reads back through the same read tools

> **Revision (2026-09-14, weaver review):** the original text below gave the planner its own
> `weave_plan_submit` tool. The weaver's review is right to reject this: an agent-tool submit means
> the planner *could* submit without captain asking (nothing about the tool list stops it from calling
> a tool it has), and it means the Submit button's reliability depends on a planner turn actually
> completing — a live agent call in the critical path of an action that should be as simple as a form
> submission. **Submit is a plain HTTP action captain takes from the modal, not a tool any agent
> calls.** The planner has no submit capability at all — not gated by a runtime check, but by the tool
> simply not existing in its list (Decision 1). Rewritten below.

**Decision:** `WAKE_SOURCES` gains `'plan_submitted'`. Captain's **Submit** button calls an
authenticated HTTP route (`POST /projects/:id/plans/:planId/submit`, human-only — no agent has a path
to it), which: (1) sets `plans.status = 'submitted'`, `submitted_at`; (2) freezes further draft edits
from the planning conversation (`weave_plan_draft_*` refuse once `plans.status !== 'drafting'`); (3)
retires the plan's planner agent through the same stop/retire path already used to end a live agent's
turn and remove its worktree (interrupting a turn in progress if one is running — submitting does not
wait for the planner to finish speaking); (4) enqueues:

```
ctx.wake.enqueue(weaverAgentId, {
  source: 'plan_submitted',
  reason: `Draft plan "<title>" submitted for <project>`,
  payload: { planId },
  requestedBy: { kind: 'human', id: <captain's operator id> },
})
```

The payload carries only `planId`, not the drafts themselves — the weaver reads the current state
back with `weave_plan_get(planId)` (the same tool the planner uses, `weaver`-or-`planner` scoped),
which is the single source of truth and cannot drift from what the payload snapshotted at submit time.
`packages/core/src/prompts/index.ts` gets a case for `wake.source === 'plan_submitted'` that renders
the turn's instructions: read the plan, create tickets in dependency order via the ordinary
`weave_ticket_create`, call `weave_plan_draft_link(draftId, { ticketId })` after each success or
`weave_plan_draft_link(draftId, { failureReason })` after each failure, and continue with the rest
rather than stopping. Dependency order is a topological sort of `plan_draft_blockers` — cycles are
rejected at `weave_plan_draft_add`/`_update` time (mirrors `assertNoCycle`,
`packages/core/src/tickets/service.ts:251`), so the weaver never has to detect one. Blocked-by on the
created tickets is `weave_ticket_create`'s existing `blockedBy: string[]` — the weaver maps
draft ids to the ticket ids it already created earlier in the same pass (later drafts always have
their blockers created first, by construction of the topological order).

No new "the weaver is done" tool: the weaver's own report to captain happens through its ordinary
chat/`weave_human_send` in its own thread, exactly as it reports anything else today. The modal itself
derives "done" from every draft reaching a terminal `status` (`created`/`failed`) — no separate
plan-level "processed" state is needed, which keeps this decision to one new weaver-only MCP tool
(`weave_plan_draft_link`) plus the shared `weave_plan_get`, and one new human-only HTTP route (submit)
that no agent tool wraps.

## Decision 4 — Live updates: the existing workspace event stream, not a new channel

**Decision:** reuse `packages/ui/src/api/events.ts`'s `EventSource`
(`WorkspaceProvider`/`useWorkspaceEvents`, already open for every V2 workspace) for the modal's live
updates, the same way ticket and decision changes already reach the UI. New event types —
`plan.draft.created`, `plan.draft.updated`, `plan.draft.removed`, `plan.draft.reordered`,
`plan.submitted`, `plan.draft.linked` — append to the existing closed event-type enum
(`packages/shared/src/enums.ts`, alongside the other domain events) and are emitted from the same
`activity`/`events` outbox path every other mutation already writes to. `PlanModal` subscribes the way
`ChatPage.tsx` subscribes to `run.*` for the weaver's live status, and invalidates the `plans`/
`plan_drafts` TanStack Query keys on a matching event — this is what makes "captain's edits" visible to
a planner turn already in flight, and the planner's own tool-driven edits visible in the modal without
a manual refresh. No second `EventStream`, no polling, no bespoke WebSocket.

## Collisions with in-flight work

- **Migration number**: `0039` is reserved by unmerged `origin/ac/vs-390-...` (`ticket.merge_bypasses`)
  and `0040` by unmerged `origin/ac/vs-397-...` (`roadmap_items`). This proposal uses `0041` as of
  2026-09-14; **re-check `packages/db/src/migrations/` immediately before writing the migration file
  at apply time** — either branch may have merged by then, freeing or shifting the number.
- **VS-397 (roadmap, unmerged)**: no file-level collision, but it is the closest existing analog
  (parked idea → linked ticket, dense-position reordering, a project-scoped table with no
  `workspace_id`) and its `packages/core/src/roadmap/index.ts` is the pattern this change's
  `planning/` service copies for `renumber`/`nextPosition`-style reordering. Also introduces
  `specs/agent-prompts/roadmap-intake/spec.md` as a sibling to this change's
  `specs/agent-prompts/plan-intake/spec.md` — no conflict, just worth the apply-phase worker reading
  both if VS-397 has landed by then.
- **VS-390 (merge-queue priority, unmerged)**: touches `tickets.merge_bypasses` only; no overlap with
  this change's tables or tools.
- **Naming**: "plan" already means a ticket's own OpenSpec proposal document
  (`ticket_documents.key = 'plan'`, the `plan_approval` decision kind — see VS-104, VS-154, VS-361,
  VS-364 in ticket history). This change's `plans`/`plan_drafts` tables are unambiguous at the schema
  level (different table names, different capability namespace `planning-sessions/*`). Captain named
  the entry point **"Plan"**, and that button label is kept exactly as chosen; every *other*
  human-facing string this change introduces — secondary UI copy, tool descriptions, the weaver
  template update — says **"draft plan"** or **"planning session,"** never bare "plan," so a reader of
  chat or docs is never left guessing which concept is meant.
- **Agent-kind surface area**: `AGENT_KINDS` has had exactly two values since `0027`
  (`agent-kind-rename`); every `'weaver' | 'worker'` union in `packages/server/src/tools.ts`,
  `packages/server/src/mcp.ts`, and `packages/core/src/workers/home.ts` needs widening to include
  `'planner'`. This is mechanical but touches enough call sites that the apply-phase tasks break it
  out explicitly (see `tasks.md`) rather than folding it into "add the tools."
