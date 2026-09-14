## Why

Captain plans large work (a feature set, a redesign, a restructure) by talking it through in
ordinary chat, then dictating tickets to the weaver from memory, one at a time. There is no place to
see the whole shape of a plan before any ticket exists, no way to reorder, retarget or re-tier work
before it is committed, and no structured way to hand a finished plan to the weaver as one unit. VS-398
gives captain a dedicated planning conversation — a read-only planning agent plus a live, editable
draft-ticket list — that submits to the weaver as a single, structured handoff.

## What Changes

- Add a **Plan** button to the V2 chat composer's toolbar, beside "⌕ Search". It opens a modal on
  desktop and a full-screen sheet on phone.
- Introduce a new **`planner`** agent kind (`weaver`, `worker`, `planner`): read-only against the
  project's repo, knowledge base, specs, open tickets and roles; it never edits the repo, never
  creates real tickets, never messages workers, never answers decisions, and never submits its own
  plan. It runs on the **same model and runtime as the weaver** — the workspace's configured weaver
  model, not a separate per-workspace planner setting — and follows that setting if it changes.
  Read-only is enforced, not assumed on convention: its runtime turn denies every write-capable
  built-in tool (`Write`/`Edit`/`NotebookEdit`/`Bash`/…), and it reads from its own disposable
  worktree, never the project's shared clone.
- Introduce a **planning session**: `plans` (one per project at a time while drafting) and
  `plan_drafts` (an ordered, editable list of draft tickets — title, description, kind, priority,
  order, intra-plan blocked-by, target role, and a suggested tier plus a captain tier override) that
  persists across closing and reopening the modal, until submitted or discarded.
- **Submit is a captain action, not a planner tool.** Captain submits from the modal (an HTTP action,
  so it never depends on an agent turn succeeding); it hands the whole plan to the weaver as a new
  wake source (`plan_submitted`), never a pasted chat message. The weaver creates real tickets in
  dependency order with blocked-by links, the chosen tier and role, reports the outcome in its own
  chat, and links each draft to its created ticket — or records why a draft could not be created,
  rather than silently dropping it.
- The planner's own reads (knowledge, tickets, specs) are scoped to its plan's project plus
  workspace-`shared` knowledge only — never `workspace`- or `decisions`-scope knowledge, and never
  another project's tickets or specs.
- Update `templates/weaver.AGENTS.md.tmpl` and the `weave-ai-weaver` skill: how to handle a submitted
  plan, including not re-planning sequencing or scope captain already approved in it.

**BREAKING:** none. Everything here is additive — a new agent-kind value, new tables, new tools, a new
UI surface. No existing capability's requirements change.

## Capabilities

### New Capabilities
- `planning-sessions/storage`: the `plans` / `plan_drafts` / `plan_draft_blockers` tables, the
  `planner` agent kind (same model/runtime as the weaver, its own disposable worktree), one planner
  session per plan, project scoping, and draft-plan persistence and resume.
- `planning-sessions/planner-tools`: the planner's read-only tool scope (enforced by denying
  write-capable runtime tools, not by omission alone) and its plan-editing tools (add / edit / remove
  / reorder draft — no submit tool), all scoped to its own plan and its own project's knowledge/
  tickets/specs only, and the guarantee that it can never create a real ticket, message a worker,
  answer a decision, or submit its own plan.
- `planning-sessions/weaver-handoff`: the `plan_submitted` wake contract, weaver-side ticket creation
  in dependency order with blocked-by, tier override and role honoured, per-draft failure surfacing,
  and draft-to-created-ticket linking.
- `planning-sessions/v2-modal`: the Plan button, the modal (desktop) / full-screen sheet (phone)
  layout, the live chat plus editable draft-ticket list, tier override, and submit gating.
- `agent-prompts/plan-intake`: weaver guidance for handling a submitted plan — read it, create from
  it, report on it — without re-planning scope or sequencing captain already decided.

### Modified Capabilities
(none — a draft links to the ticket it produced by storing the link on the draft, not on the ticket,
so no existing ticket-lifecycle or tool-scope requirement changes.)

## Impact

- **Schema**: one new migration (next free number after `main` and the two in-flight branches that
  already reserved `0039`/`0040` — `0041` as of 2026-09-14; verify at apply time) adding `plans`,
  `plan_drafts`, `plan_draft_blockers`, `agents.plan_id` and its unique partial index, and widening
  `agents.kind`'s CHECK to include `'planner'` (a full-table rebuild with FKs off, as `0027` did for
  the `conductor`→`weaver` rename).
- **Shared** (`packages/shared/src/enums.ts`, `tools.ts`): `AGENT_KINDS` gains `'planner'`;
  `WAKE_SOURCES` gains `'plan_submitted'`; new `weave_plan_*` tool names.
- **Core** (`packages/core/src`): a new `planning/` service (create/get/list plan, draft
  add/update/remove/reorder, discard), a planner spawn path with a disposable worktree and no ticket,
  resolving the weaver's model/runtime config at spawn and each turn, a weaver-side plan-creation
  flow, and a prompt-renderer case for the `plan_submitted` wake.
- **Server** (`packages/server/src`): new `weave_plan_*` MCP tool handlers (planner: get/add/update/
  remove/reorder only; weaver: get/draft_link), `toolListFor` widened to a third kind, and new HTTP
  routes for the modal's own reads, captain's direct edits, and the submit action itself — submit is
  an HTTP route, not an agent tool.
- **UI** (`packages/ui/src/v2`): `ChatComposer.tsx` (new toolbar button), a new `PlanModal` (chat pane
  plus a resizable, reorderable draft-ticket list, reusing `chatSplit.ts`, `useThreadMessages` /
  `usePostThreadMessage`, and the native-drag-events reorder pattern from `chats/ChatsPage.tsx`), new
  `plans` query keys and hooks.
- **Prompts/skills**: `templates/weaver.AGENTS.md.tmpl`, `skills/weave-ai-weaver/SKILL.md`, and a new
  planner system prompt that reuses `skills/weave-ai-planning`'s ticket-decomposition heuristics (one
  ticket per owner by default, qualifying split reasons, checkable acceptance criteria) as its own
  drafting guidance.
- **Naming collision to flag**: the repo already uses "plan" for a ticket's own OpenSpec proposal
  document (`ticket_documents.key = 'plan'`, the `plan_approval` decision kind, VS-104/VS-154/VS-361
  and others). The new `plans` / `plan_drafts` tables are a distinct, pre-ticket concept. Captain
  named the entry point **"Plan"** and that button label stays; every *other* label, tool description
  and doc calls this a **draft plan** or **planning session**, to keep the two concepts apart without
  relabeling what captain already chose. See `design.md`.
