## Context

See proposal.md - Why. Every place in the daemon that decides "where does a ticket's work land" reads
the single `Project.defaultBranch` field (`packages/shared/src/types.ts:4`). A survey of the codebase
found eight call sites carrying that assumption:

| Concern | File:line | Reads |
|---|---|---|
| Merge verification ref | `packages/core/src/tickets/land.ts:57,68,71` | `project.defaultBranch` |
| Worktree creation base | `packages/core/src/workers/index.ts:94` | `project.defaultBranch` |
| Landed-work test (retire gate) | `packages/core/src/worktrees/landed.ts` via `packages/core/src/workers/index.ts:402`, `packages/server/src/routes/worktrees.ts:29,33` | `project.defaultBranch` |
| Primary clone fetch/ff | `packages/core/src/projects/index.ts:310` | `project.defaultBranch` |
| OpenSpec archive commit/push target | `packages/core/src/openspec/index.ts:155` (via the clone's checked-out branch, set by `fetch()`) | indirect |
| Merge-slot-holder sync instruction | `packages/core/src/prompts/index.ts:206-216,270` | `project.defaultBranch` |
| Worker brief/`AGENTS.md` text | `packages/core/src/prompts/index.ts:102`, `packages/core/src/prompts/defaults.ts:91,93`, `templates/brief.md.tmpl`, `templates/worker.AGENTS.md.tmpl` | `project.defaultBranch` |
| `ac_worktree_status` ahead/behind | `packages/server/src/tools.ts:608` | `project.defaultBranch` |

All eight already have, or can cheaply obtain, the ticket in scope except the primary-clone
fetch/fast-forward, which is called generically (a project-wide sweep, or a raw `POST /projects/:id/fetch`)
with no one ticket in mind — see Decisions below for why that site stays project-level.

Three places were checked and found **not** to carry the assumption, so they are untouched:
`packages/core/src/projects/history.ts` (labels the actual default branch for display, unrelated to
where work lands, backed by `git log <ref>` rather than the clone's checkout); `packages/core/src/tickets/merge-queue.ts`
(pure DB-ordered admission, never touches git); `resolveBaseRef`/`worktreeState` in
`packages/core/src/util/git.ts` (already parameterized by a branch name, not hard-coded to
`defaultBranch`).

## Goals / Non-Goals

**Goals:**
- Every one of the eight call sites above reads a single resolver, `landingBranchOf(project, ticket?)`
  (`packages/shared`), instead of `project.defaultBranch` directly, so this class of bug cannot
  reappear one call site at a time the way it did here.
- A project with no `landingBranch` declared, and a ticket with no `landingBranch` declared, is
  byte-for-byte unchanged: `landingBranchOf` falls back all the way to `defaultBranch`.
- Fernwood's actual failure (VS-88) closes on its own once `landingBranch: edge` is declared on the
  project.
- Captain's stated case — "sometimes I might ask you to do a change that lands directly on main" —
  closes on its own once that one ticket is created with `landingBranch: main`, without changing
  Fernwood's project-level default of `edge` for every other ticket.

**Non-Goals:**
- Automating or assisting the `edge` → `main` promotion itself. It stays a human running their own
  git commands against their own repository, exactly as today.
- A **dynamic**, PR-derived landing branch — inferring the target from wherever a ticket's PR happens
  to be opened. See Decisions below for why this is rejected in favor of a static, creation-time
  declaration; the two are not the same proposal, and only the latter is in scope here.
- A web UI to edit `landingBranch` after a project or ticket is created. No `ProjectConfig` field is
  editable from the web app today (`defaultBranch`, `maxWorkers`, etc. are all `add`-time-only or
  raw-PATCH-only), and there is no ticket-creation form in the web app at all — a human's request
  reaches `ac_ticket_create` through conductor chat, the CLI, or the API. `landingBranch` follows that
  existing precedent on both sides rather than inventing a new one just for itself.
- Validating a declared `landingBranch` (project's or ticket's) against the repository's actual refs at
  declaration time. Neither existing `defaultBranch` nor the project-level `landingBranch` this change
  already adds is validated up front either; a nonexistent branch fails clearly at the first git
  operation that touches it, the same way a mistyped `defaultBranch` would today.

## Decisions

**A static declaration at two levels — project and ticket — not a dynamic per-PR base ref.**
`packages/core/src/pull-requests/index.ts:293` already reads a PR's real `baseRefName` for diff
rendering, so a tempting alternative is to verify a ticket's merge against whatever branch its actual
PR was opened against, rather than a value declared up front. Rejected, and this rejection is narrower
than it first looks: a worktree is created, and a worker is briefed on what it must never push to,
*before* a PR exists — there is nothing to read a base ref from yet, so a PR-derived value cannot drive
worktree creation or the worker brief, which are exactly the two places VS-88 also needs fixed (a
worker told "never push to `main`" who is actually landing on `edge` is being told the wrong thing).
It would also let a worker choose its own verification target by choosing where it opens its PR, which
is a real integrity problem, not just a sequencing one. Neither objection applies to a value declared
on the ticket at creation, which is knowable before the worktree is ever cut and is not the worker's
own choice — so a ticket-level override is not the rejected proposal; it is a second, independent
static declaration, one level below the project's.

**One resolver, two optional inputs: `landingBranchOf(project, ticket?)`.** Not two separate functions
(`projectLandingBranchOf` / `ticketLandingBranchOf`) and not a `ticket.landingBranch ?? landingBranchOf(project)`
one-liner repeated at each of the seven ticket-aware call sites. `landingBranchOf` resolves
`ticket?.landingBranch ?? project.landingBranch ?? project.defaultBranch` in one place; every call site
that has a ticket in scope passes it, and the one that does not (the primary-clone fetch, next
decision) simply omits the second argument. This repo has already hit the "several independent,
drifting implementations of the same lookup" bug once (`NAMED_CARD_OPTION_KEYS`, VS-111/VS-114): three
call sites each hand-rolled a decision card's valid option keys and two of them disagreed with the real
options. The fix there was one shared source of truth every consumer cites. `land.ts`'s
`verifyContained` and `worktrees/landed.ts`'s `landedWorkTest` are already two independent "has this
branch landed" implementations reading `project.defaultBranch` directly; a second field, let alone a
third input (the ticket), without one shared resolver would create the same drift risk immediately.
`packages/shared` is the right home because `core`, `server` and `cli` may all import it, and `shared`
itself imports nothing, so there is no boundary reason to put it anywhere else.

**The primary clone's own fetch/fast-forward stays project-level, never ticket-level.** `fetch()`
(`packages/core/src/projects/index.ts:305`) is called generically — a periodic sweep over every ready
project, or a raw `POST /projects/:id/fetch` — with no single ticket in mind, so there is no ticket to
resolve against even if one were wanted. It calls `landingBranchOf(project)` with the second argument
omitted. This is not a gap: `land.ts`'s own verification of a specific ticket's merge reads
`origin/<ref>` directly as a remote-tracking ref, which `git fetch` alone already makes available
without needing the clone checked out on that branch — so a ticket whose override differs from its
project's landing branch still verifies correctly even though `fetch()` never checks out that
override. The only thing `fetch()`'s checkout affects is which branch the *shared* primary clone
happens to be sitting on for OpenSpec archiving and other clone-wide operations, which is inherently a
project-level fact, not a per-ticket one — archiving one ticket's change while a different ticket's
override branch happens to be checked out would be its own, unrelated bug.

**The primary clone's "keep on default branch" invariant becomes "keep on the project's landing
branch", enforced by `fetch()` itself rather than by the `project_add` pipeline.** `docs/PLAN.md:264`
currently states `projects/<id>` MUST be kept on the default branch and only fast-forwarded by the
daemon. Rather than add a new `project_add` sub-step that checks out the landing branch right after
cloning (which would also need a `workspace-setup/setup-jobs` spec change, since that capability
enumerates the pipeline's exact sub-steps), `fetch()` gains an explicit `git checkout <landingBranch>`
immediately before its existing `git merge --ff-only origin/<landingBranch>`. For a project with no
declared landing branch this is `git checkout main` while already on `main` — a no-op. For Fernwood,
`git clone` leaves the primary clone on whatever the repository's actual HEAD is (typically still
`main`), and the very first `fetch()` call (already invoked before every OpenSpec archive, and
periodically by `reconcilePass`) checks out `edge`, creating a local tracking branch from `origin/edge`
via git's default DWIM behavior. No change to the `clone()` step or the `project_add` pipeline is
needed.

**`worktrees/landed.ts`'s `LandedInput.defaultBranch` field is renamed to `landingBranch`.** Its
current name implies the wrong branch once a project or a ticket declares one. Callers
(`packages/core/src/workers/index.ts:402`, `packages/server/src/routes/worktrees.ts:33`) pass
`landingBranchOf(project, ticket)` into it under the new name — both now look the ticket up first
(by `agent.ticketId` / `row.ticketId`) since neither had it in scope before. `land.ts`'s internal `def`
variable is similarly renamed to `landing` for the same reason; its exported shape (`LandResult`) is
unchanged.

## Risks / Trade-offs

- **A project or a ticket could declare a landing branch that does not exist in its repository.**
  `landDelivery` and `fetch()` already surface a clear git error (`merge_unverified` / a warned failed
  fast-forward) when a ref cannot be resolved; a nonexistent `landingBranch` fails the same way a
  mistyped `defaultBranch` would today. No new validation is added at declaration time — consistent
  with how `defaultBranch` itself is not validated against the remote until the first git operation
  touches it.
- **`fetch()`'s new explicit checkout changes the primary clone's on-disk branch for every existing
  project, not just ones that declare a landing branch.** Mitigated by it being a no-op when the
  landing branch equals whatever branch a project-with-no-declaration's clone is already on (which it
  always is, since nothing else ever checks out anything else in that clone — PLAN.md's existing
  invariant).
- **A ticket-level override with no project-level `landingBranch` declared still resolves correctly**
  (`ticket.landingBranch ?? project.landingBranch ?? project.defaultBranch` short-circuits past the
  unset middle term), so captain can ask for a single main-targeted ticket in a project that has never
  declared a project-level landing branch at all, not only in Fernwood's already-declared case.
- **Nothing surfaces a ticket's effective landing branch to a human outside its brief and the raw API
  response.** There is no ticket-creation UI to show it in, and `conductor ticket show`'s curated field
  list may not include it yet (task 7, group 11). Accepted for this change: the conductor (which sets
  the field from the human's chat instruction) and the worker (which reads it in its own brief) are the
  two parties that actually need it; a human inspecting the ticket later can still read it from
  `ac_ticket_get`'s JSON.

## Migration Plan

- `packages/db/src/migrations/0016_project_landing_branch.sql` adds `landing_branch TEXT` (nullable,
  no default) to `projects`, and `packages/db/src/migrations/0017_ticket_landing_branch.sql` adds the
  same column to `tickets`. Both additive, both reversible by a follow-up `DROP COLUMN` migration if
  ever needed; no backfill required since `NULL` is the correct value for every existing row.
- No data migration for existing rows: `landingBranchOf` treats `NULL` at either level as "fall through
  to the next one", ending at `defaultBranch` for every project and ticket that predates these columns.
