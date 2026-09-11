## Context

See `proposal.md` for why. Constraints that shape the approach:

- `packages/shared/src/transitions.ts` is the only ticket graph. `scout` / `question` already have the table this kind needs; `question` aliases `SCOUT`. Acceptance criterion 2 forbids adding `proposed` just to hang a plan approval on.
- `plan_approval` is raised only on `change → proposed`, applied by `applyPlanApproval` into `approved` / `proposing` / cancel, auto-granted under YOLO, and targeted at the daemon-reserved `plan` document. None of that is valid for an irreversible host action.
- A worker cannot reach the human through `ac_ask` (VS-127: worker asks are conductor-owned; system-raised kinds are not constructable). The pre-action gate therefore has to be system-raised.
- `tickets.kind` and `decisions.kind` are SQLite CHECKs. SQLite cannot ALTER a CHECK, so both widenings are table rebuilds. 0010/0018 is the recipe only for `decisions` (a leaf). `tickets` is referenced; see Decision 10.
- VS-215 already has `unlandedCommitCount()` and a `transition()` async gate keyed on `kind === 'task'`. Operational needs the same protection, not a second git helper.
- Stalled-worker detection and `livenessViolations()` already ignore a ticket with an `open` decision. The operational wait is therefore free once `action_approval` exists as a real open decision — the work is naming it so a later edit cannot drop it.

## Goals / Non-Goals

**Goals:**

- One new ticket kind and one new decision kind, both persisted, both on every surface that already enumerates kinds.
- A raise path the worker cannot forget to pair with the document it writes.
- Human-only approval, even when YOLO or `proposalApproval: none` would skip a plan.
- Daemon-enforced "no unlanded commits" on `done`; contract-enforced "don't act first" (same honesty as "don't implement during propose").

**Non-Goals:**

- Deployment tooling, inventories, credentials, rollback.
- A new MCP tool. The raise is a side effect of `ac_ticket_document_put`.
- A new installed skill package. Procedure lives in the worker skill row, the brief table, and `definitionOfDone`.
- Changing how `change` / `task` / `scout` / `question` transition, bind OpenSpec, or finish.

## Decisions

### 1. Transition table is the scout table, aliased like `question`

```ts
export const TRANSITIONS = { change: CHANGE, task: TASK, scout: SCOUT, question: SCOUT, operational: SCOUT };
```

Why not a private copy: `question` already aliases `SCOUT`; a third copy would drift. Why not add `proposed` to operational: acceptance criterion 2, and `proposed` is what `repairApprovals` and YOLO treat as "waiting on a plan". Staying `in_progress` plus an open decision is already an action path (`livenessViolations` skips open decisions; stall scan skips them too).

`LIVENESS_STATUSES` and `WORKER_STATUSES` are status lists, not kind lists — no change.

### 2. New decision kind `action_approval`, not a reuse of `plan_approval`

Reuse the *machinery* (decisions table, `create`/`answer`/`supersedeForTarget`, `NAMED_CARD_OPTION_KEYS`, DecisionCard, repair scan, terminal withdraw, wake-on-answer). Do not reuse the *kind*.

`applyPlanApproval` does `transition(to: 'approved')` / `to: 'proposing'`. Those statuses are empty on the scout graph (`invalid_disposition`). YOLO calls `autoApprove` for every `plan_approval` it creates. The reserved `plan` key is the OpenSpec digest. Each of those would need an `if (ticket.kind === 'operational')` branch inside change-ticket code.

A new kind costs a `decisions.kind` CHECK rebuild (same as VS-127's `concern`) and a named-card entry. It keeps YOLO's "those two kinds only" rule true without a special case, and `ASKABLE_DECISION_KINDS` stays `question|concern|gate_finding`.

Options: `approve` / `revise` / `reject` — same keys as `plan_approval`, added to `NAMED_CARD_OPTION_KEYS.action_approval`. Owner is always `human` (`defaultOwner` case, ignoring `proposalApproval` and YOLO).

`applyActionApproval`:

- `approve` → comment, wake `askedByAgentId`. Ticket stays `in_progress`.
- `revise` → comment with the feedback, wake. Ticket stays `in_progress`.
- `reject` → `tickets.cancel`.

No status change on approve/revise, so `blockedFromStatus` is irrelevant.

### 3. Raise path: `putDocument` of `action` on an operational ticket

`putDocument` already supersedes `plan_approval` when `key === 'plan'`. Extend that hook:

- if `key === 'action'` and `t.kind === 'operational'`: supersede `action_approval:${t.id}`, then `decisions.create({ kind: 'action_approval', owner: 'human', target: { documentId, revision }, correlationKey: 'action_approval:${id}', options: NAMED_CARD_OPTION_KEYS.action_approval, askedByAgentId: t.workerId })`.
- Never YOLO-auto-answer.
- On a non-operational ticket, `action` is just a document.

Why not a new tool: the ticket asked for the kind and its lifecycle, not more MCP surface. Why not `transition(to: 'blocked')`: extra step the worker can skip; `blocked` also needs an already-open decision or an unblock path, which is a chicken-and-egg with the raise. Why not reuse the reserved `plan` key: VS-104 forbids external writes to `plan`.

The worker contract says: write `action`, end the turn. Enforcement that they did not already run the command is contractual — the daemon cannot see a `systemctl` the way it can see a commit.

### 4. Repair: operational + `action` document + no open `action_approval`

`repairApprovals()` today walks `proposed` (plan) and `in_review` (merge). Add: tickets where `kind === 'operational'` and an `action` document exists and `openApproval(id, 'action_approval')` is null. Re-raise with the same options, `askedByAgentId: t.workerId`, context noting it was re-raised. Include `action_approval` in the repaired-kind union the conductor wake already names. Do not auto-approve.

Do not repair an operational ticket that has never written `action` — it may still be investigating, or it may finish with "no action taken".

### 5. Documentation: knowledge base, not the repo

Captain asked to update documentation after the operation when applicable. Repo docs are commits, and this kind exists so there is no PR. So:

- What was done, when, to what, and the next operator's lesson → `ac_knowledge_note` / a project document (`ac_knowledge_doc_put`), per `agent-conductor-knowledge`.
- Repo documentation that genuinely needs changing → the worker files a follow-up `change` ticket (`ac_ticket_create`) and says so in the `report`. It does not commit on the operational branch.

The `report` document is the ticket-local record (approved vs actual). Not daemon-enforced: scouts are not refused `done` for a missing report either, and a missing-report gate would block the legitimate "cancelled by reject" path. The brief and `definitionOfDone('operational')` require it.

### 6. Unlanded-commit gate reuses VS-215's helper, keyed on this kind

In `transition()`, next to the task gate:

```
if (to === 'done' && t.kind === 'operational') {
  const commits = await unlandedCommitsFor(t);
  if (commits > 0) throw new OcError('worktree_not_landed', …);
}
```

No required note (that is a task-only "which ending" rule). Same fail-open when git cannot be read. `change` / `task` / `scout` / `question` gates are untouched.

### 7. OpenSpec bind treats operational like scout

`bindOpenspec`: `if (t.kind === 'scout' || t.kind === 'question' || t.kind === 'operational') return null;`

### 8. Surfaces

- `TICKET_KINDS` drives Board filter, CLI `--kind`, HTTP/MCP create schemas. Adding the enum value is the API change.
- `TicketCard.outcomeOf`: `operational` → `{ label: 'ran', tone: 'done' }` (scout is `report`, question is `answered`).
- DecisionCard + `packages/render` `decisionToCard`: named variant `action_approval` with the three keys. Title/context copy talks about the action, not an OpenSpec plan. Context is already markdown (VS-139) — commands in the action are copyable.
- `definitionOfDone('operational')`: write `action`, wait, execute only what was approved, write `report` + knowledge, never commit, `done`.
- Worker skill phase table: new row `todo` (`operational`) → write action, wait, execute, report, `done`.
- `templates/brief.md.tmpl` done table: new `operational` row. `templates/worker.AGENTS.md.tmpl`: add `operational` to the `todo` (`task` / `scout` / `question`) line and the skills sentence. `templates/conductor.AGENTS.md.tmpl`: add the kind to the kinds sentence and the classify/create bullet (VS-211: both templates).
- PLAN §6.1 kinds, §6.2 kinds line and `done` row, §12.3 a new `operational` bullet, conductor routing in §13. ADR 0017 recording why the gate is before the action and why docs go to the KB.

### 9. Tests that pin existing kinds

The exhaustive `TICKET_KINDS × TICKET_STATUSES` loop in `tickets.test.ts` gains the new kind automatically. Add explicit cases: operational `in_progress → proposing|proposed|in_review|merging` rejected; `openspecChangeName` null; `putDocument('action')` raises `action_approval` and does not YOLO; approve stays `in_progress`; reject cancels; `done` with unlanded commits refused; `done` with no worktree allowed; liveness/stall ignore an open `action_approval`; `change`/`task`/`scout`/`question` fixtures still pass their existing tests. Migration tests: Decision 10.

### 10. Widening `tickets.kind` requires a rebuild; there is no cheaper route and no in-repo precedent

**Does it require a rebuild?** Yes. SQLite has no `ALTER TABLE … DROP/REPLACE CHECK`. The `kind` CHECK is compiled into `tickets`. Inserting `operational` against today's CHECK fails. Removing the CHECK, replacing it with a trigger, or validating only in TypeScript all still need the same DROP-and-recreate to change the compiled constraint. There is no cheaper correct route.

**Can we copy 0010/0018?** No. Those rebuilds are safe only because `decisions` is a leaf — 0010's own comment: `PRAGMA foreign_keys` is a no-op inside a transaction, `Db.migrate()` wraps every file in `BEGIN…COMMIT`, so foreign keys stay ON, and `DROP TABLE decisions` has no children. `tickets` is not a leaf. With foreign keys ON, `DROP TABLE tickets` fails as soon as any child row exists.

**Actual `REFERENCES tickets(id)` clauses in this schema** (verified against `packages/db/src/migrations/`, not guessed):

| Source | Column(s) |
|---|---|
| `tickets` (self) | `parent_id` |
| `ticket_relations` | `ticket_id`, `related_ticket_id` |
| `ticket_comments` | `ticket_id` |
| `ticket_documents` | `ticket_id` |
| `ticket_work_products` | `ticket_id` |
| `decisions` | `ticket_id` |
| `runs` | `ticket_id` |
| `knowledge_revisions` | `ticket_id` (added 0014) |

`wakeups` has no `ticket_id`. `agents`, `worktrees`, `activity`, `usage_events`, `knowledge_usage_events`, and `incidents` store a ticket id as plain TEXT with no FK; those rows are not at risk from `DROP TABLE tickets` and are not part of the survival proof.

**Precedent.** None. This repo has never rebuilt a referenced table. We are establishing one.

**Recipe** (SQLite's documented "other kinds of table schema changes" procedure, plus a migrator change that 0010 deferred):

1. **Teach `Db.migrate()` a file-level opt-in**, not a global FK-off. Before `BEGIN`, if the file's first non-empty line is `-- ac:foreign_keys_off`, run `PRAGMA foreign_keys = OFF`. After `COMMIT` (and on rollback), run `PRAGMA foreign_keys = ON`. Files without the marker keep today's behaviour: a `DROP` of a referenced table with children still fails. 0010/0018 stay as they are.
2. **Migration file** `0023_operational_ticket_kind.sql` (next free prefix at apply time; 0022 is current), first line `-- ac:foreign_keys_off`:
   1. `CREATE TABLE tickets_new (…)` — every column in **today's** order (`sqlite_master` / `PRAGMA table_info(tickets)` at apply time, including `created_run_id`, `merge_queued_at`, `merge_started_at`, `interactive_session`, `blocked_from_status`, `landing_branch`, `summary`, `worker_model_id`). The only edit is the `kind` CHECK, adding `operational`. Keep `parent_id TEXT REFERENCES tickets(id)` written exactly that way: during the copy it names the old table; after the rename it is a self-reference again. `INSERT … SELECT *` matches by position, same as 0010.
   2. `INSERT INTO tickets_new SELECT * FROM tickets` — copies `parent_id` values as-is. A child ticket whose `parent_id` is another ticket's `id` still points at that same id after the copy.
   3. `DROP TABLE tickets` — legal only because this file opted into FK-off. Child tables are not dropped. Their `sqlite_master` SQL still says `REFERENCES tickets(id)`.
   4. `ALTER TABLE tickets_new RENAME TO tickets` — the name `tickets` exists again, so every child's existing FK clause binds to the new table. No child table is rewritten. The self-FK on `parent_id` now points at this table.
   5. Recreate the indexes that died with the drop: `tickets_origin_open`, `tickets_ws_status`, `tickets_project`, `tickets_merge_queue`.
   6. Rebuild `decisions` in the same file the 0018 way (it is still a leaf; FK-off does not hurt it), adding `action_approval` to its CHECK. Column list is 0018's plus nothing new since — confirm at apply time.
3. **Do not recreate child FK clauses.** They already name `tickets`. Recreating them would be a second, unpreceded rebuild of every child.

**How `parent_id` survives.** It is a value copy, not a pointer rewrite. Seed a parent ticket and a child whose `parent_id` equals the parent's `id`. After migrate, both rows exist, the child's `parent_id` is unchanged, and `PRAGMA foreign_key_check` reports no violation on `tickets`.

**How child FKs survive.** Child rows are never copied or deleted. After rename, `PRAGMA foreign_key_list(<child>)` still shows `table = tickets`. The test seeds one row in every FK child (both columns of `ticket_relations`; a `runs` row; a `knowledge_revisions` row with `ticket_id` set) and asserts those ids and ticket_id values are unchanged.

**Tests** (more than an empty `foreign_key_check`):

- Before/after row counts and primary keys for `tickets` and every FK child listed above.
- The seeded `parent_id` pair still matches.
- `PRAGMA foreign_key_list` on each child still names `tickets`.
- `PRAGMA foreign_key_check` is empty.
- Insert `operational` / `action_approval` succeeds; a typo kind still fails CHECK.
- Persisted CHECKs equal `TICKET_KINDS` and `DECISION_KINDS` both ways.
- A migration file *without* `-- ac:foreign_keys_off` still cannot `DROP TABLE tickets` while a child row exists (the marker is opt-in).

## Risks / Trade-offs

- [A worker runs the command before writing `action`] → Mitigation: contractual, same as "no code during propose". The daemon cannot see a host command. The `done` gate still refuses leftover commits; the report is expected to match the approved action.
- [YOLO users expect every approval to skip] → Mitigation: PLAN and the auto-approval spec already limit YOLO to plan + merge. The action card is presented as waiting on the human; the board must not mark it `autoApproving`.
- [Rebuilding `tickets`, a referenced table] → Accepted. No cheaper route exists. Mitigated by: FK-off is opt-in per file (other migrations keep today's DROP protection); child tables are not rebuilt; survival is proven per child table, not only by `foreign_key_check`; `parent_id` is asserted as a live pair. First time this repo does it — the test is the precedent.
- [Fail-open unlanded-commit read] → Same as VS-215: `retireIfLanded` still keeps the worktree.
- [Workers invent host credentials or deploy tooling] → Out of scope; the charter already forbids host-level work. The action document is what the human reads before anything runs.

## Migration Plan

1. Change `Db.migrate()` to honour `-- ac:foreign_keys_off` *before* `BEGIN` and restore FK-on after the transaction. No other migration file is marked.
2. Add `0023_operational_ticket_kind.sql` (or next free prefix) with that marker: rebuild `tickets` (wider kind CHECK, Decision 10 recipe), then rebuild `decisions` (0018 recipe + `action_approval`).
3. Tests as in Decision 10.
4. Rollback: a revert commit restores the previous CHECK and the unmarked migrator. Rows of the new kinds would then fail to insert; none exist until someone files an operational ticket.

## Open Questions

None. The migration question is resolved in Decision 10.
