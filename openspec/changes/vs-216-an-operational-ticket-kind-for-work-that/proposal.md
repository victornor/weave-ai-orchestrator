## Why

Deployments, upgrades and service restarts have no diff to review: by the time there is something to read, the running system has already changed. `change` and `task` both end in a PR; `scout` has the right shape (`todo → in_progress → done`) but its deliverable is a report about the world, not a change to it. Captain asked for an operational ticket that never produces a PR, with the gate *before* the action and documentation afterwards.

## What Changes

- A new ticket kind `operational` exists end to end (enum, SQLite CHECK, transitions, API, CLI, UI).
- Its graph is the scout graph: `todo → in_progress → done`. No `proposing`, `proposed`, `in_review` or `merging`. No OpenSpec change is bound or demanded.
- Before an action that changes a running system, the worker writes an `action` document (concrete commands, host or service, expected outcome). Writing it raises a human-owned `action_approval` — the existing approval machinery pointed at an action, not a new parallel stack. The worker waits; it does not act first.
- `plan_approval` is **not** reused as the decision kind. Its apply path (`approved` / `proposing`), YOLO auto-grant, reserved `plan` document and OpenSpec copy are all change-ticket-specific. Overloading it would auto-approve irreversible ops under YOLO and invent status transitions this kind must not have.
- YOLO, `proposalApproval: none` and conductor-owned proposal policy do **not** apply. An operational action always waits for the human.
- After acting, the worker writes a `report` (what was approved, what actually happened, any difference) and records operational knowledge in the knowledge base. Repo documentation is a follow-up `change` ticket, never a commit on this branch.
- `operational → done` is refused (`worktree_not_landed`) while the branch carries unlanded commits — same helper VS-215 added for tasks, keyed on this kind.
- An open `action_approval` is an action path: not a liveness violation, not a stalled worker.
- Existing kinds are unchanged.

## Capabilities

### New Capabilities

- `ticket-lifecycle/operational`: the kind, its graph, the pre-action `action` document and `action_approval`, the post-action report and knowledge rule, the unlanded-commit `done` gate, and the OpenSpec / stall / liveness exemptions.

### Modified Capabilities

- `human-decisions/approval-integrity`: `action_approval` is a named, system-raised, human-owned kind with approve/revise/reject; an operational ticket that has an `action` document but no open `action_approval` is repaired; terminal close lists the new kind.
- `human-decisions/auto-approval`: YOLO still covers only `plan_approval` and `merge_approval`; an `action_approval` is never auto-granted.
- `worker-supervision/stalled-worker-detection`: an operational ticket waiting on its `action_approval` is not flagged as stalled.

## Impact

- `packages/shared` — `TICKET_KINDS`, `TRANSITIONS` (scout table), `DECISION_KINDS`, `NAMED_CARD_OPTION_KEYS.action_approval`, ASKABLE list unchanged.
- `packages/db` — `Db.migrate()` honours `-- ac:foreign_keys_off` before `BEGIN`. One migration rebuilds `tickets` (referenced; no in-repo precedent — Decision 10) then `decisions` (0018 recipe). Tests prove every child FK and the `parent_id` self-reference survive, not only an empty `foreign_key_check`.
- `packages/core` — `bindOpenspec` skips operational; `putDocument(key: 'action')` on an operational ticket raises/supersedes `action_approval`; `applyActionApproval` (approve/revise wake the worker and stay `in_progress`; reject cancels); `repairApprovals` covers a stranded operational action; `transition()` unlanded-commit gate also keys on `operational`; `definitionOfDone('operational')`.
- `packages/server` — create/list schemas already take `TICKET_KINDS`; no new HTTP route. MCP `ac_ticket_create` accepts the kind. No new tool — the raise path is `ac_ticket_document_put` of `action`.
- `packages/ui`, `packages/render` — kind filter and badges pick up the enum; `outcomeOf` labels a finished operational ticket; DecisionCard / `decisionToCard` get an `action_approval` named variant (same keys as plan approval).
- `packages/cli` — `conductor ticket create --kind` already joins `TICKET_KINDS`.
- Skills and prompts — worker phase table, conductor kind list, `templates/brief.md.tmpl`, `templates/conductor.AGENTS.md.tmpl`, `templates/worker.AGENTS.md.tmpl` (VS-211: both templates).
- `docs/PLAN.md` §6.1/§6.2/§12.3 and a short ADR (new planned kind).
- **Out of scope:** deployment tooling, host inventories, credential handling, rollback automation.
