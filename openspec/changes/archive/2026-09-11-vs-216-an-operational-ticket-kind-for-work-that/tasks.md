## 1. Shared enum, graph and migration

- [x] 1.1 Add `operational` to `TICKET_KINDS` and alias `TRANSITIONS.operational` to the scout table in `packages/shared`. Verify the exhaustive `TICKET_KINDS × TICKET_STATUSES` loop in `tickets.test.ts` accepts `todo → in_progress → done` and rejects `proposing` / `proposed` / `in_review` / `merging`.
- [x] 1.2 Add `action_approval` to `DECISION_KINDS` and `NAMED_CARD_OPTION_KEYS.action_approval` (`approve` / `revise` / `reject`). Leave `ASKABLE_DECISION_KINDS` unchanged. Verify a create with those option keys matches the named-card test pattern used for `plan_approval`.
- [x] 1.3 Teach `Db.migrate()` the `-- ac:foreign_keys_off` opt-in (FK off before `BEGIN`, on after commit/rollback). Add `0023_operational_ticket_kind.sql` with that marker: rebuild `tickets` (wider kind CHECK, Decision 10 recipe, including `parent_id` self-FK), then rebuild `decisions` (0018 recipe + `action_approval`). Verify `migrations.test.ts`: every FK child's rows and `foreign_key_list` survive, the seeded `parent_id` pair survives, `foreign_key_check` is empty, persisted CHECKs equal `TICKET_KINDS` and `DECISION_KINDS` both ways, and a file without the marker still cannot `DROP TABLE tickets` while a child row exists.

## 2. Daemon lifecycle

- [x] 2.1 Skip OpenSpec bind for `operational` in `bindOpenspec` (same branch as `scout` / `question`). Verify `openspecChangeName` is null on create in an OpenSpec-enabled project.
- [x] 2.2 In `putDocument`, writing `action` on an `operational` ticket supersedes and raises a human-owned `action_approval` targeting that revision; writing `action` on any other kind only stores the document. Verify YOLO does not auto-answer; a second write supersedes.
- [x] 2.3 Implement `applyActionApproval`: `approve` / `revise` leave the ticket `in_progress` and wake the worker (revise records feedback); `reject` cancels. Verify each answer in `decisions.test.ts` / `tickets.test.ts`.
- [x] 2.4 Extend `repairApprovals` to re-raise `action_approval` when an operational ticket has an `action` document and none is open, and wake the conductor naming the kind. Verify a ticket that never wrote `action` is not repaired, and YOLO does not answer the repair.
- [x] 2.5 In `transition()`, refuse `operational → done` with `worktree_not_landed` when `unlandedCommitCount()` is > 0; allow `done` when there is no worktree. Verify the task-only note requirement is untouched.
- [x] 2.6 Assert an `in_progress` operational ticket with an open `action_approval` is absent from `livenessViolations()` and from `stalledWorkerScan`. Verify existing change / task / scout / question cases still pass.

## 3. Prompts, skills and docs

- [x] 3.1 Add `definitionOfDone('operational')` and an `operational` row to `templates/brief.md.tmpl`. Verify `prompts/template.test.ts` covers the new kind.
- [x] 3.2 Add the `todo` (`operational`) row to `skills/agent-conductor-worker/SKILL.md` and mention `operational` on the `todo` line and skills sentence of `templates/worker.AGENTS.md.tmpl` (VS-211: both templates).
- [x] 3.3 Add `operational` to the kinds list and routing bullet in `templates/conductor.AGENTS.md.tmpl` (and `conductor/AGENTS.md` if that file is not generated from the template).
- [x] 3.4 Update `docs/PLAN.md` §6.1 / §6.2 / §12.3 and write `docs/adr/0017-operational-ticket-kind.md` recording the before-the-action gate and the KB-not-repo docs rule.

## 4. UI, render, API surfaces

- [x] 4.1 Add an `action_approval` named variant to `packages/ui` DecisionCard and `packages/render` `decisionToCard` using only `NAMED_CARD_OPTION_KEYS.action_approval`. Verify the named-card key test fails if a button drifts.
- [x] 4.2 Label a finished operational ticket in `TicketCard.outcomeOf` (e.g. `ran`). Verify the board kind filter includes `operational` via `TICKET_KINDS` and does not mark an open `action_approval` as `autoApproving`.
- [x] 4.3 Confirm HTTP / MCP / CLI create and list already accept the new kind through `TICKET_KINDS` (add a focused create test if none exists). No new MCP tool.

## 5. Suite

- [x] 5.1 Run `pnpm typecheck`, `pnpm lint` and `pnpm test`. Post the actual output on the ticket. Existing kinds remain green.
