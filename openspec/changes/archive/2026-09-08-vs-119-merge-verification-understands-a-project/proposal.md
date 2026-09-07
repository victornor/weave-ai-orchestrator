## Why

Fernwood's branch flow is feature → `edge` → `main`: a ticket's PR targets `edge`, and `edge` is
promoted to `main` separately, in batches, by a human. That is the project's own rule, enforced by
its repository. VS-88 followed it exactly, captain approved the merge, and PR #459 correctly landed
on `edge` — but `ac_ticket_merge_done` refused to close the ticket because every place in the daemon
that decides "has this ticket's work landed" hard-codes the project's *default* branch as the *landing*
branch, and for Fernwood those are two different branches. The worker was right to refuse rather than
push to `main` to satisfy a check; a human had to close the ticket by hand instead. Every Fernwood
change ticket will hit this until the daemon can tell the two branches apart.

## What Changes

- A project may declare a `landingBranch` in its config, distinct from its `defaultBranch`. A project
  that declares none keeps behaving exactly as today: `landingBranchOf(project, ticket?)` (new,
  `packages/shared`) is the one place that resolves it, falling back to `defaultBranch` when unset.
- A ticket may declare its own `landingBranch` at creation, overriding its project's. This is captain's
  explicit case: Fernwood's project-level landing branch is `edge`, but a ticket captain asks to land
  directly on `main` carries that instead. The override is static and set only at creation — never
  inferred from where a worker happens to open its PR, which would let a worker pick its own
  verification target. `landingBranchOf(project, ticket)` resolves `ticket.landingBranch ?? project.landingBranch
  ?? project.defaultBranch`: the same one function as above, now also given the ticket where one of the
  eight call sites below has one in scope.
- Merge verification (`landDelivery`/`verifyContained` in `packages/core/src/tickets/land.ts`) checks
  a ticket's work against that ticket's effective landing branch instead of always against
  `origin/<defaultBranch>`, so a ticket whose work genuinely reached its landing branch closes on its
  own, and one that has not still fails exactly as clearly as today — including when its work reached
  the default branch, or another ticket's landing branch, by some other route but never its own.
- Every other place that assumed "default branch" meant "where a ticket's work lands" moves to the
  same landing branch: a new worker's worktree is created from it, the landed-work test that gates
  worktree/worker retirement checks the branch against it, the primary clone is fetched and
  fast-forwarded to it (so OpenSpec archiving commits and pushes there, not to the default branch),
  the merge-queue wake that hands a worker the merge slot tells it to sync with it, and the worker's
  own brief/`AGENTS.md` say the worktree was created from it and that it must never be pushed to
  directly.
- Promoting the landing branch to the default branch stays entirely outside this change: nothing added
  here ever pushes or merges that promotion; it is unchanged as the human's own step.
- Audited and found **not** to carry this assumption, left unchanged: the commit-graph and
  repository-reads history views (`packages/core/src/projects/history.ts`), which correctly display
  the project's actual default branch and are not about where work lands; the merge queue's own
  admission/ordering logic (`packages/core/src/tickets/merge-queue.ts`), which never touches git and
  is branch-agnostic; and `resolveBaseRef`/`worktreeState` (`packages/core/src/util/git.ts`), which
  already take a branch name as a parameter rather than assuming `defaultBranch`.
- Found, reported, **not** fixed (unrelated pre-existing defect, out of scope): `renderCharter`
  (`packages/core/src/prompts/index.ts`) never populates `project.defaultBranch`/`deliveryMode`/
  `mergeMethod` into the charter template at all, so `templates/charter.md.tmpl`'s "Project: … default
  branch …" line has always rendered blank. This is a missing-population bug unrelated to which branch
  a ticket's work lands on; worth its own ticket.

**BREAKING:** none. A project with no `landingBranch` declared is byte-for-byte the same behavior as
before this change; the new field is optional everywhere it is read.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `ticket-delivery/landing-verification`: gains the landing-branch concept itself (a project may
  declare one, falling back to its default branch, and a ticket may declare its own, falling back to
  its project's), and the existing merge-verification requirement, plus new requirements covering
  worktree creation, the landed-work test, and the primary clone's fetch/fast-forward/archive target,
  all move from "default branch" to a ticket's effective landing branch (the primary clone's own sync
  target stays project-level; see design.md - Decisions).
- `ticket-delivery/merge-queue`: the requirement that tells the admitted worker it holds the merge slot
  now names that ticket's effective landing branch as what it must re-sync with, instead of always the
  default branch.

## Impact

- `packages/db/src/migrations/0016_project_landing_branch.sql` — new nullable `projects.landing_branch`.
- `packages/db/src/migrations/0017_ticket_landing_branch.sql` — new nullable `tickets.landing_branch`.
- `packages/shared/src/types.ts` — `Project.landingBranch`, `Ticket.landingBranch`, new
  `landingBranchOf(project, ticket?)` helper.
- `packages/shared/src/config.ts` — `ProjectConfigSchema.landingBranch`.
- `packages/core/src/api.ts` — `TicketCreateInput.landingBranch`.
- `packages/core/src/tickets/service.ts` — `create()` persists it.
- `packages/core/src/tickets/land.ts`, `land.test.ts` — verification target and new coverage.
- `packages/core/src/worktrees/landed.ts`, `worktrees.test.ts` — landed-work test target.
- `packages/core/src/workers/index.ts` — worktree creation base, `retireIfLanded` (looks up the
  ticket).
- `packages/server/src/routes/worktrees.ts` — `/worktrees/:id/verify` (looks up the ticket too).
- `packages/core/src/projects/index.ts`, `projects.test.ts` — `fetch()`'s checkout/ff target
  (project-level only; see design.md - Decisions).
- `packages/core/src/prompts/index.ts`, `render.test.ts` — `workerData`, `mergeQueueLine`.
- `templates/brief.md.tmpl`, `templates/worker.AGENTS.md.tmpl`, `packages/core/src/prompts/defaults.ts`
  — worker-facing text (states the ticket's actual landing branch, override or not).
- `packages/server/src/tools.ts` (`ac_project_add`, `ac_ticket_create`, `ac_worktree_status`),
  `packages/server/src/routes/projects.ts` (`AddSchema`) and `packages/server/src/routes/tickets.ts`
  (if it duplicates the tool's schema) — declaration and ahead/behind reporting surfaces.
- `packages/cli/src/commands/project.ts` — `--landing-branch` on `project add`, shown in `show`/`list`.
- `packages/cli/src/commands/ticket.ts` — `--landing-branch` on `ticket create`, shown in `ticket show`
  if that command curates a field list.
- `packages/core/src/testing/context.ts`, `packages/server/test/fakes.ts`, `packages/ui/src/test/factories.ts`
  — fixtures gain the new fields.
- `docs/PLAN.md` (§11.3–§11.5, §12.2, term glossary, example config, `ac_ticket_create`'s field list),
  `docs/API.md`, new `docs/adr/0014-project-landing-branch.md`.
