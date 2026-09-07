# ADR 0014 — A project, and a ticket, may declare a landing branch distinct from the default branch

Date: 2026-09-07 · Status: accepted

## Context

Fernwood's branch flow is feature → `edge` → `main`: a ticket's PR targets `edge`, and `edge` is
promoted to `main` separately, in batches, by a human. That is the project's own rule, enforced by its
repository. Every place in the daemon that decides "has this ticket's work landed" read
`project.defaultBranch` directly and assumed it was also the branch a ticket's work lands on. VS-88
followed Fernwood's rule exactly — captain approved the merge, PR #459 correctly landed on `edge` — and
`ac_ticket_merge_done` refused to close the ticket because it verified against `origin/main`, where the
commit correctly was not. The worker was right to refuse rather than push to `main` to satisfy a check;
a human had to close the ticket by hand instead, and every Fernwood change ticket would hit the same
wall.

A survey of the codebase found eight call sites carrying the same assumption: merge verification
(`land.ts`), worktree creation (`workers/index.ts`), the landed-work retire test
(`worktrees/landed.ts`), the primary clone's fetch/fast-forward (`projects/index.ts`), the merge-queue
sync instruction and the worker's brief/`AGENTS.md` text (`prompts/index.ts` and the shipped
templates), and the `ac_worktree_status` tool's ahead/behind display (`tools.ts`).

While specifying the fix, captain added a second requirement on the ticket directly: "Unless
explicitly stated otherwise, Fernwood should land changes on edge... Sometimes I might ask you to do a
change that lands directly on main though." A single per-project override is not enough — a project's
landing branch needs its own per-ticket exception, set deliberately, for the occasional ticket that
skips the normal flow.

## Decision

Two declarations, one resolver:

- A project may declare `landingBranch` in its config (`ProjectConfigSchema`, a new nullable
  `projects.landing_branch` column). Unset, it behaves exactly as before — every check runs against the
  project's `defaultBranch`.
- A ticket may declare its own `landingBranch`, set only at creation (`TicketCreateInput`, a new
  nullable `tickets.landing_branch` column), overriding its project's. This is static and declared
  up front — never inferred from a pull request's base branch. A dynamic, PR-derived alternative was
  considered and rejected: a worktree is created, and a worker is briefed on what it must never push
  to, *before* a PR exists, so there is nothing to read a base ref from yet at the point those two
  things need to be correct. Inferring it from wherever a PR happens to be opened would also let a
  worker choose its own verification target by choosing its PR base — a real integrity problem, not
  just a sequencing one.
- `landingBranchOf(project, ticket?)` (`packages/shared`) is the one function that resolves the
  fallback chain — `ticket?.landingBranch ?? project.landingBranch ?? project.defaultBranch` — and
  every one of the eight call sites above reads it instead of `project.defaultBranch` directly. This
  repo has already hit the "several independent, drifting implementations of the same lookup" bug once
  (`NAMED_CARD_OPTION_KEYS`, VS-111/VS-114); a second field without a shared resolver would have
  reintroduced it immediately, since `land.ts`'s `verifyContained` and `worktrees/landed.ts`'s
  `landedWorkTest` were already two independent implementations of "has this branch landed" reading
  `defaultBranch` directly.
- The primary clone's own fetch/fast-forward (`projects/index.ts`'s `fetch()`) stays project-level,
  never resolving a ticket's override: it is called generically (a periodic sweep, or a raw
  `POST /projects/:id/fetch`) with no one ticket in mind, and a ticket's merge verification reads
  `origin/<ref>` as a remote-tracking ref directly — it does not need the shared clone's own checkout
  to match its landing branch. `fetch()` gained an explicit `git checkout <landingBranch>` before its
  existing fast-forward, so the clone (and what OpenSpec archives) tracks the project's landing branch
  even when the repository's actual default branch differs.
- Promoting a landing branch to the default branch (`edge` → `main`) stays entirely outside this: no
  worker, and no part of the daemon, ever pushes or merges that promotion. It remains the human's own
  step, exactly as it is today.

## Consequences

- A project or ticket that declares nothing is byte-for-byte unchanged: `landingBranchOf` falls all the
  way through to `defaultBranch`, so this is additive for every project that does not need it.
- Two new nullable columns (`projects.landing_branch`, `tickets.landing_branch`), no down-migration: an
  older daemon ignores them and reads `defaultBranch` again, which is the previous behavior.
- `fetch()`'s new explicit checkout changes which branch the primary clone is sitting on for every
  project on its next fetch, not only ones that declare a landing branch — harmless, since for a
  project with none declared the checkout target equals the branch the clone was already on (a no-op),
  which was already PLAN.md's invariant.
- Nothing surfaces a ticket's effective landing branch to a human beyond its worker's brief and the raw
  API/CLI fields (`conductor ticket show`, `conductor project show`): there is no ticket-creation UI to
  add a form field to, and a human's request reaches `ac_ticket_create` through conductor chat, the
  CLI, or the API either way.
