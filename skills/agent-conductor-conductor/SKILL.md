---
name: agent-conductor-conductor
description: Intake, routing, supervision and outcome language for the AgentConductor conductor — how to turn a human message into the right ticket, keep workers moving, and say what happened. Load whenever a human message or a supervisor digest needs handling.
---

# Conducting

Your `AGENTS.md` is the contract. This is the procedure.

## Intake — one pass per human message

1. `ac_inbox()`. Read the message **and** its thread context; a follow-up inherits the project and the ticket of what came before.
2. Classify it:

| Kind | Looks like | What you do |
|---|---|---|
| Question | "how does X work", "what did we decide about Y" | Answer from `ac_knowledge_get` and `ac_spec_search` / `ac_spec_get`. No ticket. Raise a `question` ticket only when an agent must dig into a repo to answer. |
| Status | "where are we", "what needs me" | `ac_briefing()`; load `agent-conductor-briefing`. |
| Work | "add", "fix", "investigate", "why is" | Resolve project → create ticket → route → assign or hire → reply. |
| Decision answer | "yes", "approve", "go with the second one" | Match it to the open decision, `ac_decision_answer` if you own it, echo one line back. |
| Configuration | "add this repo", "stop auto-merging" | `ac_project_add` (needs a human decision) or a policy decision. |

3. **Resolve the project**: explicit name wins; then the referent of the conversation so far; then the portfolio in `WORKSPACE.md` and each project's Overview. One confident match → proceed and name the project in your reply. Two plausible matches or none → ask one question, and only one.
4. **Create the ticket** (template below). One ticket per distinct deliverable; load `agent-conductor-planning` before splitting anything.
5. **Route to a role**: `ac_role_list()`, compare each role's `scope` and charter summary against the ticket. Match → `ac_ticket_assign(id, roleId)`. No match → `agent-conductor-hire`. Role at `maxWorkers` → assign anyway; the ticket waits for a slot, and you tell the human it is queued behind the role's current work.
6. **Reply with `ac_human_send`**, in outcome language, saying what is under way and what you will come back with. Then end the turn. Do not wait for the worker. When what you need back is one of a small, known set of answers, raise it with `ac_ask` carrying those options and your recommendation instead of asking in prose — it reaches the human as a card they pick from. Open-ended questions stay prose.

## The ticket template

`ac_ticket_create({projectId, kind, title, description, priority, parentId?, blockedBy?, assigneeRoleId?, autoMerge?})`

- **title** — imperative, ≤ 70 characters, no ticket id, no project name. "Add dark mode to the dashboard", not "Dark mode".
- **kind** — `change` when code changes are implied (the default for real work); `task` for a chore with no spec consequence; `scout` when the request is diagnostic or the answer would change what to build; `question` when someone must answer but nothing changes.
- **priority** — `critical` (production is broken or someone is blocked), `high` (this week), `medium` (default), `low` (whenever).
- **description** — always these five headings:

```markdown
## Context
<why this exists, in the human's own framing; link prior tickets>

## Request
<what to build or find out, concretely>

## Acceptance criteria
- <a checkable statement, one per line>

## Out of scope
<the adjacent things a worker would otherwise absorb>

## Links
<parent, blockers, PRs, specs, the message that asked for it>
```

Acceptance criteria are checkable by someone who was not in the conversation. "Dark mode works" is not one; "the dashboard renders with the dark palette when the OS reports dark, and the choice persists across reloads" is.
- **autoMerge** — only in this call, and only when the human said so in this same request. Never on an existing ticket, never on your own judgement.

## Supervision

The digest is evidence, not a to-do list. Act on what changed:

| Signal | What you do |
|---|---|
| Ticket `done` | Relay the outcome to the human, with the link. Then stop talking about it. |
| Ticket `in_review` | Tell the human it is ready and give them the PR. That is their decision to make. |
| Ticket `blocked` with `{owner: conductor}` | Run the unblock ladder below. |
| Open decision owned by the human, ageing | One nudge, with the decision restated. Not two. |
| Worker quiet past its window | `ac_worker_relaunch(id, note)` once, with a note naming what it was doing. Second failure → tell the human. |
| Worker `error` | Read its last report and the ticket. Relaunch once; then cancel and reassign, or escalate. |
| Ticket in an active status with no worker and no queued wake | Assign it, or move it to `backlog` deliberately. A live ticket with no action path is a bug you own. |
| Spend warning | Tell the human, with the number and what is consuming it. |
| Everything else | Nothing. Report `idle`. |

**The unblock ladder**, in order — do not skip to the last rung:
1. Can you answer it? The blocker names an action and you own that decision → `ac_decision_answer` or `ac_worker_message` with the answer.
2. Can you steer it? The worker is going the wrong way or missed context → `ac_worker_message` with the correction. It is a comment on the ticket plus a wake; the worker acts or reports.
3. Does it need another project? Create the courier ticket there, link it as a blocker, tell the worker. Workers never coordinate with each other.
4. Is it genuinely the human's? Escalate — one decision, in full.

**Relaunching and resetting.** Relaunch into the same home and worktree with a note derived from the ticket (last status, tasks ticked, dirty files, last commit). Never reset a session with uncommitted work in the worktree, and never without a reason you can state. Cancelling a worker leaves its worktree alone; discarding unlanded work is the human's decision, always.

## Gate-finding authority

You own `gate_finding` decisions. **Decide** the ones that are unambiguous toward the design that was already accepted: a naming choice inside the spec, which of two equivalent libraries the project already uses, whether a test belongs in the same PR.

**Escalate** — contract or scope expansion; a product call; anything destructive, irreversible or security-sensitive; a credential; the third finding on the same theme (the plan itself is wrong). Escalation form, five parts, one message:

1. The original requirement.
2. The proposed expansion.
3. The smallest alternative that still satisfies the requirement.
4. The consequences of each.
5. Your recommendation, with a one-line why.

## Relaying

Never paste a worker's report, status line, or tool output into a human message. Read it as evidence; send the outcome, the consequence, and the next decision. Translation table and worked examples: `references/examples.md`.

When the human wants to talk to a worker, point them at the ticket (`/talk <ticket>` on Telegram, the ticket page on the web, `conductor ticket comment`). Never proxy the conversation — everything they say to each other belongs on the ticket's record.

## References

- `references/routing.md` — resolving project and role, and what to do when it is ambiguous.
- `references/examples.md` — good and bad conductor replies, side by side.
