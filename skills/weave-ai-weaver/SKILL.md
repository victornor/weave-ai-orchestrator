---
name: weave-ai-weaver
description: Intake, routing, supervision and outcome language for the Weave AI weaver — how to turn a human message into the right ticket, keep workers moving, and say what happened. Load whenever a human message or a supervisor digest needs handling.
---

# Conducting

Your `AGENTS.md` is the contract. This is the procedure.

## Intake — one pass per human message

1. `weave_inbox()`. Read the message **and** its thread context; a follow-up inherits the project and the ticket of what came before.
2. Classify it:

| Kind | Looks like | What you do |
|---|---|---|
| Question | "how does X work", "what did we decide about Y" | Answer from `weave_knowledge_get` and `weave_spec_search` / `weave_spec_get`. No ticket. Raise a `question` ticket only when an agent must dig into a repo to answer. |
| Status | "where are we", "what needs me" | `weave_briefing()`; load `weave-ai-briefing`. |
| Work | "add", "fix", "investigate", "why is" | Resolve project → create ticket → route → assign or hire → reply. |
| Decision answer | "yes", "approve", "go with the second one" | Match it to the open decision. If you own it, `weave_decision_answer`, echo one line back. If it is your own `question`, `concern` or `gate_finding` to the human, record their words with `weave_decision_answer` and `relayMessageId` = the message they sent; echo one line back only once it is recorded. A plan, merge or action approval still needs their own tap — never record one from a message. |
| Configuration | "add this repo", "stop auto-merging" | `weave_project_add` (needs a human decision) or a policy decision. |
| Scheduled task | `weave_inbox` `routines` bucket, wake source `routine` | An alarm. Default is **report** to the human. `file_work` on the fire's payload is the only filing licence; honour `maxTicketsPerFire`. Tools: `weave_routine_list` / `create` / `update` / `remove`. Do not invent routines unless the human asked. |

3. **Resolve the project**: explicit name wins; then the referent of the conversation so far; then the portfolio in `WORKSPACE.md` and each project's Overview. One confident match → proceed and name the project in your reply. Two plausible matches or none → ask one question, and only one.
4. **Create the ticket** (template below). One ticket per distinct deliverable; load `weave-ai-planning` before splitting anything.
5. **Route to a role**: `weave_role_list()`, compare each role's `scope` and charter summary against the ticket. Match → `weave_ticket_assign(id, roleId)`. No match → `weave-ai-hire`. If the project is at its Settings max-workers cap the ticket waits for a project slot — tell the human it is queued, and raise throughput from Settings, not by raising a role's stored `maxWorkers`. A role whose description or scope has gone stale is maintained with `weave_role_update` (spec fields) and `weave_role_update_charter` (charter prose) — see `weave-ai-hire` §4 — never by hiring a second role for the same work.
6. **Reply with `weave_human_send`**, in outcome language, saying what is under way and what you will come back with. Then end the turn. Do not wait for the worker. When what you need back is one of a small, known set of answers, raise it with `weave_ask` carrying those options and your recommendation instead of asking in prose — it reaches the human as a card they pick from. Open-ended questions stay prose.

## The ticket template

`weave_ticket_create({projectId, kind, title, description, summary?, priority, parentId?, blockedBy?, assigneeRoleId?, autoMerge?, workerModelId?})`

Call `weave_worker_models` first when any named worker options exist, and pass the fitting `workerModelId`; omit it to use the workspace workers default.

- **title** — imperative, ≤ 70 characters, no ticket id, no project name. "Add dark mode to the dashboard", not "Dark mode".
- **kind** — `change` when code changes are implied (the default for real work); `task` for a chore with no spec consequence; `scout` when the request is diagnostic or the answer would change what to build; `question` when someone must answer but nothing changes; `operational` when the work changes a running system (deploy, upgrade, restart) and has no diff to review — the worker gates with `action_approval` before acting.
- **priority** — `critical` (production is broken or someone is blocked), `high` (this week), `medium` (default), `low` (whenever).
- **summary** — one sentence, ≤ 200 characters, why the ticket exists. Shown on the plan-approval card so the human can decide without opening it. Always set it when you file a ticket; never derive it from the description later.
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
| Ticket `blocked` with `{owner: weaver}` | Run the unblock ladder below. |
| Open decision owned by the human, ageing | One nudge, with the decision restated. Not two. |
| Worker quiet past its window | `weave_run_inspect(<ticket>)` first — a worker in `turn` with recent tool calls is working, not stuck. Only if the run is idle or failing: `weave_worker_relaunch(id, note)` once, the note naming what the transcript showed it doing. Second failure → tell the human. |
| Worker `error` | `weave_run_inspect` for the failure, then `weave_run_list` if you need the retry ladder. Relaunch once; then cancel and reassign, or escalate. |
| Worker `paused` after a failure | Not stuck — waiting on the human, who has a retry card naming the failure. Your open-work line says what stopped it (`paused: provider_quota — …`). Nudge the human about the card; do not relaunch into a usage limit. `weave_worker_relaunch` on a parked worker resumes it, so it never starts a fresh session — but it also does not clear a quota. |
| Ticket in an active status with no worker and no queued wake | Assign it, or move it to `backlog` deliberately. A live ticket with no action path is a bug you own. |
| Spend warning | Tell the human, with the number and what is consuming it. |
| Everything else | Nothing. Report `idle`. |

**The unblock ladder**, in order — do not skip to the last rung:
1. Can you answer it? The blocker names an action and you own that decision → `weave_decision_answer` or `weave_worker_message` with the answer.
2. Can you steer it? The worker is going the wrong way or missed context → `weave_worker_message` with the correction. It is a comment on the ticket, attributed as yours, and by default tries to reach the worker's running turn before falling back to a wake at its next one — the call returns `mid_turn` or `queued`, so you know which happened rather than assuming; `queued` means the worker acts on it starting next turn, not now.
3. Does it need another project? Create the courier ticket there, link it as a blocker, tell the worker. Workers never coordinate with each other.
4. Is it genuinely the human's? Escalate — one decision, in full.

Answering a block (`weave_decision_answer`) or steering the worker (`weave_worker_message`) wakes that
worker; the ticket's status is restored to what it held before the block when the worker's turn
starts, so you never transition the ticket yourself and a still-stuck worker re-blocks it.

**Inspecting a run.** `weave_run_inspect(ref)` takes a ticket identifier, a worker id or a run id and
returns the run's phase and elapsed time, the worker's status and pause reason, and a compact
transcript of its recent events; `weave_run_list(ref)` returns its recent runs with their outcomes and
durations. Both are read-only and weaver-only. Inspect when a worker has gone quiet past its
window, when the human asks what is happening on a ticket, or when a digest item does not match what
you expected — **before** you relaunch, cancel or escalate, so the note you write says what the
worker was actually doing. The output is bounded; when it says it was truncated, page with `since`
rather than asking for more at once.

What you read there is **evidence, not a message**. Never paste a transcript, a tool call or an
error body to the human — send the outcome and the decision, exactly as with a worker's report.

**Relaunching and resetting.** Relaunch into the same home and worktree with a note derived from the ticket (last status, tasks ticked, dirty files, last commit). Never reset a session with uncommitted work in the worktree, and never without a reason you can state. Cancelling a worker leaves its worktree alone; discarding unlanded work is the human's decision, always.

## A worker's ask

Every `weave_ask` a worker raises — `question`, `concern` or `gate_finding` — is yours, never the
human's, and wakes you the moment it is raised, not at the next digest. **Decide** the ones that are
unambiguous toward the design that was already accepted: a naming choice inside the spec, which of
two equivalent libraries the project already uses, whether a test belongs in the same PR, or a
`concern` where the situation and what the worker already tried are enough to point it forward
yourself. Answer with `weave_decision_answer`; the worker is woken with your answer on its own next
turn, no relaunch needed.

**Escalate** — contract or scope expansion; a product call; anything destructive, irreversible or
security-sensitive; a credential; the third finding on the same theme (the plan itself is wrong).
Escalation form, five parts, one message to the human:

1. The original requirement.
2. The proposed expansion.
3. The smallest alternative that still satisfies the requirement.
4. The consequences of each.
5. Your recommendation, with a one-line why.

Escalating is not leaving the worker's decision open with no signal. Raise the escalation as your own
`weave_ask` to the human, naming the worker's ticket, then use `weave_worker_message` to tell the worker,
on its own ticket, that this is now with the human — waiting, not forgotten. Once the human answers,
relay the resolution back with `weave_decision_answer` on the worker's own decision, which wakes it with
the answer the same way a direct answer would. None of this is authorisation: relaying an answer
never grants a plan or merge approval the ticket still needs on its own.

## Reviewing a plan, merge or action card

When inbox or the digest names an open `plan_approval`, `merge_approval` or `action_approval`, read the plan document for a plan approval, the PR for a merge approval, and the ticket's `action` document (`weave_ticket_document_get(id, "action")`) for an action approval, then `weave_decision_review`. An action approval reviews the commands that will run on a live system — the host and service they target, whether they are reversible, and whether the stated expected outcome follows from them; `looked` there says you read the commands, not that the intent sounds reasonable. Both marks need a note that appears on the card: `concerns` carries what you object to; `looked` carries the one or two sentences you would otherwise write in chat about why the work is clean. The mark says the review found nothing to object to — not an endorsement, never your approval. Do not mark at turn start or in a batch. You still never `weave_decision_answer` those kinds.

## Relaying

Never paste a worker's report, status line, or tool output into a human message. Read it as evidence; send the outcome, the consequence, and the next decision. Translation table and worked examples: `references/examples.md`.

When the human wants to talk to a worker, point them at the ticket (`/talk <ticket>` on Telegram, the ticket page on the web, `weave ticket comment`). Never proxy the conversation — everything they say to each other belongs on the ticket's record.

## References

- `references/routing.md` — resolving project and role, and what to do when it is ambiguous.
- `references/examples.md` — good and bad weaver replies, side by side.
