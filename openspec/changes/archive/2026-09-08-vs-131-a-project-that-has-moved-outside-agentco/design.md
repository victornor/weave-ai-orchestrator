## Context

`projects.fetch(id)` (`packages/core/src/projects/index.ts:307-325`) is the one place that already
talks to a project's remote: `git fetch origin`, checkout `landingBranchOf(project)`, `git merge
--ff-only origin/<landing>`. It is called from three places today — the hourly `reconcilePass()`
(`supervisor/index.ts:513`), `openspec/index.ts:155` (kept current before an OpenSpec archive-sync),
and nothing in `packages/ui` at all; `POST /projects/:id/fetch` exists as a route
(`packages/server/src/routes/projects.ts:32`) and a CLI command but no UI ever calls it. Its result —
`{ head, fastForwarded }` — already distinguishes "moved forward" from "did nothing", and `merged.ok`
already distinguishes "fast-forwarded or already there" from "cannot fast-forward". None of this is
persisted or broadcast: a failed merge is a `log.warn` and nothing else.

Both `ac_ticket_get` context and the KB entry recorded 2026-09-08 already establish that this clone
is fetched and fast-forwarded only by the hourly sweep, and that a diverged clone fails silently —
that finding is what this ticket is filed against.

## Goals / Non-Goals

**Goals:**
- Tell `behind` and `diverged` apart, precisely, and say so everywhere the state is shown.
- Make a diverged clone visible — to a human on the overview page and as a sidebar signal — instead
  of a single `log.warn` nobody reads.
- Give a human a one-click way to run the existing fetch-and-fast-forward from the overview page.
- Do this without adding a network call per render, and without alarming captain every time an
  entirely ordinary merge lands (the common case, for a project developing itself this fast).

**Non-Goals:**
- Auto-resolving a diverged clone in any form (explicitly out of scope in the ticket).
- Changing when or how a worker's worktree is cut, or touching a worktree a worker already holds
  (explicitly out of scope). The "fetch before cutting a worktree" idea the ticket asks me to
  consider is answered below, but not implemented here.
- Shortening `RECONCILE_EVERY_MS` globally. See Decisions.
- A commit-by-commit diff or ahead/behind count beyond "how many commits behind" for display copy.

## Decisions

### 1. `behind` vs `diverged`, defined precisely

`behind`: the clone's `HEAD` (on `landingBranchOf(project)`) is an ancestor of
`origin/<landing>` — `git merge-base --is-ancestor HEAD origin/<landing>` succeeds — and the two
differ. Remedy: fast-forward (safe, additive, already what `fetch()` does).

`diverged`: `HEAD` is **not** an ancestor of `origin/<landing>` — the clone holds at least one commit
the remote's current tip does not recognise as its own history, almost always because
`<landing>` was force-pushed or rebased on the remote. Remedy: a human decides what to do with the
clone (reset it to match, or investigate); AgentConductor does neither automatically, and never
discards a local commit to force a match, per the ticket's explicit rule.

`in_sync`: `HEAD === origin/<landing>` after the check below.

These three are exhaustive and mutually exclusive for a two-way comparison against one ref, which is
all `landingBranchOf` ever names for fetch purposes.

### 2. Detection has two tiers, deliberately kept apart: a read-only check, and the mutating sync

**The read-only check (`checkSync`, new)** — `git fetch origin <landing>` (downloads objects, updates
the `origin/<landing>` remote-tracking ref) then classifies locally via `git rev-parse` and `git
merge-base --is-ancestor` as above. It never runs `checkout` or `merge`: `HEAD` and the working tree
are untouched. This backs `GET /projects/:id/sync` and the project overview page.

**The mutating sync is `fetch()` (existing, unchanged in shape)** — the same fetch, then `checkout
<landing>` and `merge --ff-only`. This backs the hourly sweep (unchanged), the OpenSpec archive-sync
caller (unchanged), and the new manual "Sync" button (`POST /projects/:id/fetch`, already a route,
just never called from the UI until now).

Why split them: criterion 2 asks the overview to *show the state* and separately *offer* a sync
action — that only makes sense if looking is not itself the fix. If the on-open check silently
fast-forwarded, `behind` could never be observed as a state a human chooses to act on, and criterion 7
("the sync action clearing the behind state") would have nothing to test against a prior state.
Splitting also keeps the read-only path honestly read-only for the "repository is read, not written"
convention already established for the history reader (`project-overview/repository-reads`) —
`checkSync` follows the same shape, one tier lighter than a full sync.

Both `fetch()` and `checkSync()` persist `Project.syncState` and emit `project.updated` — the one
event type the UI already tracks and invalidates `qk.projects(ws)` on
(`packages/ui/src/api/events.ts:169-171`). No new `EventType` is added to
`packages/shared/src/events.ts`; the payload just gains `syncState`.

### 3. What the check costs, per project per hour

- **Unchanged baseline:** one real `git fetch` + `merge --ff-only` per ready project per hour, from
  the existing `reconcilePass()` — the same operation, same cadence, that runs today. The only change
  is that its outcome is now persisted and broadcast instead of discarded.
- **New, bounded by human navigation, not by render:** at most one additional `git fetch` (read-only,
  no merge) per project per distinct overview visit, via `useProjectSync`'s `staleTime: 60_000` —
  switching tabs, re-rendering, or reopening the same project's overview within 60s costs nothing.
  A project nobody is looking at costs exactly the unchanged hourly baseline and nothing more.
- **The Sync button:** reuses the existing `POST /projects/:id/fetch` route — the same network cost
  the hourly sweep already pays, just human-triggered, at most as often as clicked.
- **The sidebar dot:** zero additional network cost. It reads `syncState` off the `Project` rows the
  sidebar already fetches (`useProjects` / `useWorkspaceProjects`), refreshed by the existing SSE
  `project.updated` invalidation — no new poll, no new query.

### 4. Severity is asymmetric on purpose — this is how criterion 6 is met

`behind` is the routine case: it is the state of every project between an ordinary merge landing on
its remote and the next hourly sweep (or overview visit) catching it up. For a project under active
development — this repository is a live example, merging several times a day — treating `behind` as
an alert would mean captain sees a warning after nearly every merge, which is exactly what criterion 6
forbids.

So: `behind` renders with the same tone already used for an unremarkable in-progress state (`Badge
tone="modified"` on the overview, `--status-working` for the sidebar dot — the same colour the rail
already uses for ordinary work in flight, never an alarm). `diverged` — rare, and the one case that
actually needs a human — gets the alarm treatment already established elsewhere in this app
(`Badge tone="removed"`, `--status-blocked` for the sidebar dot, the same colour "needs you"/"blocked"
already use). Both states still show *something* per criterion 4's literal "a project that is out of
sync" wording; only the visual weight differs. A project that is `in_sync` shows nothing at all, in
the overview's badge row and in the sidebar, so a fine project is never permanent furniture.

Alternative considered: suppress `behind` in the sidebar entirely, showing it only on the overview
page. Rejected — criterion 4 asks for a marker whenever a project is out of sync, not only when it is
diverged; the asymmetric-tone approach satisfies both criteria 4 and 6 without contradicting either.

Alternative considered: a debounce that only shows `behind` once it has persisted across two
consecutive checks. Rejected as unnecessary complexity for this change — it would need a new
timestamp field and a threshold nobody has asked for, and the tone split already answers the actual
complaint ("must not flash *a warning*"), not "must never show anything".

### 5. The "Consider" question: is the hourly sweep too slow?

Yes, for the specific window between a worktree being cut and the next sweep — that is the root cause
called out in the ticket's Why. The better fix for *that* specific problem is a fetch immediately
before a worktree is cut, not a shorter global interval: shortening `RECONCILE_EVERY_MS` pays the cost
of extra fetches for every ready project, on a fixed schedule, to shrink a staleness window that only
matters at the moment a worktree is actually cut — most projects most of the time have no worktree
being cut in a given hour. A pre-cut fetch pays cost only exactly when it matters, scoped to the one
project being cut from.

This ticket does not implement it: cutting a worktree is explicitly out of scope ("Anything about
worktrees the workers hold"), and the indicator/detection work here stands on its own. Recorded here,
as the ticket asks, as a recommended follow-up, not bundled into this change.

### 6. Where `syncState` is not touched

`projects.reconcile()` (`index.ts:335+`, config-vs-DB reconciliation on startup) and `startAdd`/
`retryAdd` (still `cloning`/`error`) are unrelated to this — `syncState` only has meaning once a
project is `ready` and has been fetched at least once. It defaults to `in_sync` at creation
(the clone is freshly cloned from the remote it will be compared against) and is first recomputed by
whichever runs first: the next hourly sweep, or a human opening its overview page.

## Data Model

`packages/db/src/migrations/<next>_project_sync_state.sql` (next available number under
`packages/db/src/migrations/` at apply time — 0019 as of writing):

```sql
ALTER TABLE projects ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'in_sync'
  CHECK (sync_state IN ('in_sync', 'behind', 'diverged'));
```

Additive, defaulted, reversible by a follow-up migration that drops the column — no backfill needed,
no existing row's meaning changes. `packages/shared/src/enums.ts` gains `PROJECT_SYNC_STATES = ['in_sync', 'behind', 'diverged'] as const` and `ProjectSyncState`, next to `PROJECT_STATUSES`.
`Project` (`packages/shared/src/types.ts`) gains `syncState: ProjectSyncState`.

`lastFetchedAt` is left as is (still means "the mutating fetch last ran"); the read-only `checkSync`
does not touch it, only `syncState`.

## API

`GET /projects/:id/sync` → `{ syncState: ProjectSyncState, behindBy: number | null }`. `behindBy` is
`git rev-list --count HEAD..origin/<landing>` (local-only once the fetch above has populated the
remote-tracking ref — no extra network call) when `behind`, else `null`. Read-only per Decision 2;
documented in `docs/API.md` next to the existing `POST /projects/:id/fetch` line.

`POST /projects/:id/fetch` is unchanged in signature and route; its handler now goes through the
instrumented `fetch()` (Decision 2), so its response is unchanged but its side effects (persist +
emit) are new.

## Risks / Trade-offs

[`checkSync`'s `git fetch` still touches the network and the clone's `.git` internals (remote-tracking
ref) on every overview visit past the 60s window — not truly free] → Accepted: it is read-only with
respect to `HEAD` and the working tree, which is the property the acceptance criteria and the
`repository-reads` precedent actually care about; the object download itself is the same cost the
hourly sweep already pays per project, just possibly more often for a project a human is actively
watching.

[Two near-identical git call sequences (`fetch()` and `checkSync()`) duplicate the "resolve
`landingBranchOf`, run `git fetch origin`" prefix] → Accepted, kept as two small functions sharing that
one prefix via a local helper, rather than one parameterised function with a `merge: boolean` flag —
the merge/no-merge distinction is a safety property (Decision 2), not an implementation detail, and
deserves to be visible at the call site rather than a boolean threaded through.

## Migration Plan

Additive column, additive route, additive UI. No existing behaviour changes except: `fetch()` now
also persists and emits (previously silent on both), and the sidebar dot now reflects real data
(previously index-cycled placeholder colours — nothing depended on those being any particular
colour). Verification: `pnpm typecheck`, `pnpm lint`, `pnpm test`; manually exercise `behind` and
`diverged` against a project's clone with a scratch remote (not this repository's own origin) per
`agent-conductor-worker`'s rule against touching real credentials/remotes from inside a ticket.
