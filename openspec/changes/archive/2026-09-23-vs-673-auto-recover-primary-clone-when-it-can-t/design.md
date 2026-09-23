## Context

See `proposal.md` - Why. `projects.fetch()` (`packages/core/src/projects/index.ts`) is the one place
that fetches and fast-forwards a project's primary clone; four call sites share it (the curation
freshness gate in `runs/engine.ts`, the hourly reconcile sweep in `supervisor/index.ts`, the pre-archive
fetch in `openspec/index.ts`, and the `POST /:id/fetch` route the overview's manual sync action hits).
Today, when `git merge --ff-only origin/<landing>` fails, `fetch()` sets `syncState = 'diverged'` and
returns without changing anything further; every caller either surfaces that as a dead end (the curation
gate blocks the ticket) or silently logs it (the reconcile sweep, the pre-archive fetch).

The literal `checkout_stale` failure text in the ticket (`primary clone for <project> has diverged from
origin/main and could not be fast-forwarded`) is `runs/engine.ts`'s curation-gate wording verbatim — this
is the one place that ever produces that exact error code today. Fixing `fetch()` fixes it at the source
all four callers share.

## Goals / Non-Goals

**Goals:**
- Make a fast-forward failure caused by a rewritten remote (force-push, rebase, amend) self-heal, with
  no human step, everywhere `fetch()` is called.
- Never let that self-heal discard a commit the primary clone holds that isn't also on the remote.
- Give the still-failing case (genuine local writes present) a message that says so, distinctly from the
  generic "could not be fast-forwarded" wording used today.

**Non-Goals:**
- `checkSync()` (the read-only classifier `GET /:id/sync` uses) is unaffected — it never checks out,
  merges, or resets, and this change does not add mutation to it.
- Fixing `archiveAfterMerge`'s `local-branch`-delivery backfill to push instead of leaving an unpushed
  local commit. That commit is intentional (see Decision 2) and out of scope; this change only makes
  sure it is never mistaken for disposable.
- A UI affordance that explains *why* a sync attempt self-healed vs. was refused beyond what
  `project-overview/sync-status` already requires (showing `diverged` distinguishably from `behind`).

## Decisions

### Decision 1: A guard keyed on "has anything moved the branch since our own last fetch," not on inspecting the diverged commits themselves

The requirement is to tell apart two situations that look identical to git once `merge --ff-only` has
already failed: the clone's tracking branch holds a commit `origin/<landing>` no longer recognises
because **the remote was rewritten** (safe to discard — it's a stale copy of history the remote itself
abandoned), vs. the clone's tracking branch holds a commit `origin/<landing>` no longer recognises
because **something committed straight into the clone** (must not be discarded — it's real work that was
never pushed). `git merge-base --is-ancestor` and friends cannot distinguish these: in both cases the
clone's `HEAD` simply is not an ancestor of the new `origin/<landing>` tip, and no reachability query
against the *current* state of either ref tells you which story produced that fact.

What does distinguish them is provenance the daemon itself has: it is the only thing that is supposed to
move a primary clone's checked-out branch (see Decision 2 for the one confirmed exception). So `fetch()`
now records a new column, `projects.primaryCloneSyncedHead`, set to the clone's `HEAD` every time a
fetch leaves it `in_sync` (whether or not it moved). When a later fast-forward fails, the guard compares
the clone's current `HEAD` (**before** touching anything) against that stored value:

- **Equal** → nothing has touched the branch since `fetch()` itself last put it there. The only thing
  that could have produced today's failure is `origin/<landing>` moving in a way that isn't a
  fast-forward — a rewrite. Hard-reset the branch to `origin/<landing>` and record the new head as the
  watermark.
- **Not equal, or no watermark recorded yet** (a project added before this change, or one whose last
  fetch never reached `in_sync`) → something moved the branch outside `fetch()`'s own knowledge, or there
  is no baseline to reason from. Refuse the reset, leave the clone exactly as it is, and report the
  divergence distinctly (see Decision 3). A project in this state self-heals as soon as one `fetch()`
  call reaches `in_sync` again and records a fresh watermark — normally the very next scheduled or manual
  fetch once the underlying cause (e.g. an unpushed archive backfill, Decision 2) has been pushed or
  cleared by a human.

Alternatives considered:
- **Patch-id / content comparison** between the clone's unreachable commits and `origin/<landing>`'s
  history, to recognise "this is the same change, just rewritten." Rejected: a rewrite can reword,
  squash, or drop commits entirely, so content-equivalence is neither necessary nor sufficient, and it is
  meaningfully more code for a guarantee the watermark already gives more simply.
- **Always refuse and require a human**, i.e. do nothing beyond today's behaviour but with clearer
  wording. Rejected: it is exactly the status quo the ticket asks to close — captain has hit the
  "retry/cancel, no self-heal" dead end enough times to want it gone.
- **Always reset**, treating "nothing pushes to primary clones" as reliably true. Rejected explicitly by
  the ticket's own instruction to confirm the assumption first; Decision 2 shows it is not reliably true.

### Decision 2: The one confirmed direct writer, and why the guard already covers it

Audited every write into a `project.clonePath` outside `fetch()` itself
(`rg -n "clonePath" packages/core/src`, focused on `git` calls, not read-only ones like `git show`/`git
log`/forge reads). One confirmed case commits directly onto the clone's checked-out branch without
pushing: `openspec/index.ts`'s `archiveAfterMerge`, for a `local-branch`-delivery project's backfill
path, calls `commitArchive(project.clonePath, changeName, log, /* push */ false)` — by design (see that
function's own comment, VS-327): a `local-branch` project has no forge and no protected-branch risk, so
committing the archive straight onto the clone is intentional, and nothing pushes it. `bootstrapOpenSpec`
also commits directly (during `project add`), but it always either pushes or `git reset --mixed HEAD~1`s
its own commit back out on push failure — it never leaves a committed, unpushed state behind.

`archiveAfterMerge`'s backfill commit is exactly the shape the guard in Decision 1 is built to catch: it
moves the clone's `HEAD` without going through `fetch()`, so the next time `fetch()` runs, the clone's
`HEAD` no longer equals `primaryCloneSyncedHead`, and the guard refuses to reset — correctly, since that
commit is real, unpushed work. No design change to `archiveAfterMerge` is needed; it already calls
`deps().projects.fetch(project.id)` first (best-effort) before committing, which is what sets the
watermark it will later diverge from.

### Decision 3: The refused case gets a distinguishing message, not a new error code

`fetch()` keeps its existing contract: it never throws for a failed fast-forward, it returns normally
and leaves `syncState: 'diverged'` for the caller to act on (unchanged for both the self-healed-away and
the still-refused case — self-heal leaves `syncState: 'in_sync'`). The curation gate in `runs/engine.ts`
already reads `syncState` off the row `fetch()` just updated and only blocks when it isn't `in_sync`; no
change is needed there; it acquires the self-heal for free, and only ever sees `diverged` for the
guard-refused case going forward. What changes is the log line and the freshness error text
`fetch()`/the gate compose: self-heal is logged at `info` ("primary clone had diverged from
origin/<landing> (likely a rewritten remote); reset to match it"), and the refused case's message now
says the clone holds a commit not on the remote and was left untouched, rather than the generic "could
not be fast-forwarded" — so a human reading a blocked ticket or the overview's sync-failure toast can
tell, without reading code, that this is the rarer real-conflict case.

## Risks / Trade-offs

- **[Risk] A daemon restart or a future direct-write path that commits into a primary clone and then
  crashes before the next successful `fetch()` leaves the watermark stale (pointing at the pre-commit
  head), so the guard correctly refuses to reset — but forever, until a human intervenes, since nothing
  auto-clears a genuinely diverged clone.** → Mitigation: this is the intended, safe failure mode — the
  ticket explicitly requires the local-commits case to "still fail loudly, not silently discard work,"
  with manual retry/cancel remaining the fallback (proposal.md - What Changes). The watermark only ever
  makes recovery *possible* where today it is impossible; it never makes a genuine conflict resolve
  itself.
- **[Risk] A project added before this ships has no `primaryCloneSyncedHead` yet, so the very first
  divergence it hits after upgrade is treated as guard-refused (no self-heal) even if it is actually just
  a rewritten remote.** → Mitigation: accepted rather than worked around. The alternative — trusting an
  unrecorded, pre-migration `HEAD` as a baseline — would mean trusting data with no known provenance,
  which is the exact risk Decision 1 exists to avoid. The project self-heals normally from the next
  `in_sync` fetch onward, and until then it fails exactly as it does today (no regression).
- **[Risk] The new column adds a small bit of bookkeeping (`primaryCloneSyncedHead`) that must be kept in
  step with `syncState`/`lastFetchedAt`.** → Mitigation: it is written in exactly one place — the same
  `ctx.db.update('projects', ...)` call `fetch()` already makes after a successful merge — so there is no
  second code path that can let it drift.

## Migration Plan

- One additive migration: `ALTER TABLE projects ADD COLUMN primary_clone_synced_head TEXT` (nullable, no
  default needed beyond `NULL`). Existing rows start with no watermark, covered by the risk above.
- No data backfill: `primaryCloneSyncedHead` is filled in by the next successful `fetch()` per project,
  which already runs at least hourly (the reconcile sweep) for every `ready` project.
- No rollback concern beyond the standard "a later migration never runs against a reverted binary";
  the column is additive and unused by any code that predates it.
