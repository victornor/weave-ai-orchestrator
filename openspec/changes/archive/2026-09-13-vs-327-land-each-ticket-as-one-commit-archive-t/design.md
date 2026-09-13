## Context

See `proposal.md` - Why for the motivation. The relevant current state, confirmed by reading the code
rather than assuming it:

- `tickets.mergeDone` (`packages/core/src/tickets/service.ts:~1070-1163`) runs *after* the worker has
  already executed `gh pr merge` itself (`skills/weave-ai-worker/references/delivery.md` step 8). It
  calls `landDelivery` (verifies the merge landed, serialized per project via its own
  `createSerializer()` instance at `service.ts:81`), then `openspec.archiveAfterMerge` (a *second*,
  independent per-project serializer in `openspec/index.ts:74`). The two serializers are not unified:
  nothing today stops one project's `landDelivery` and `archiveAfterMerge` from running concurrently.
- `archiveAfterMerge` operates in the **primary clone**, always re-fetching it first — this is why
  today's archive is correct under any `mergeConcurrency` (1-8, `config.ts:49`): each archive attempt
  starts from a freshly fast-forwarded view of the landing branch, and the per-project serializer
  guarantees they run one at a time, so the Nth archive always sees the first N-1 archives already
  applied.
- `commitArchive` (`openspec/index.ts:196-208`) then does `git add -A openspec`, commits, and — for
  policy `archiveCommit: 'push'` (the default) — pushes straight to whatever branch the primary clone
  has checked out (the project's landing branch). A push rejection is logged at `info` and swallowed;
  nothing downstream ever learns the push failed. `archiveCommit: 'pr'` exists in the enum
  (`packages/shared/src/enums.ts:48`) but nothing implements it — the case falls through and does
  nothing.
- `GhForge.mergePr` (`packages/core/src/forge/gh.ts:134-140`) already exists, already wraps
  `gh pr merge <url> --squash/--merge/--rebase`, and is already exercised by tests — but no production
  code calls it. The worker's own `gh pr merge` (delivery.md step 8) is the only place a merge actually
  happens today.
- There is no protected-branch or direct-push-permission field anywhere in `ProjectPoliciesSchema` or
  `ProjectConfigSchema` (`packages/shared/src/config.ts`). The daemon has no advance knowledge that a
  push will be refused; it only ever finds out reactively.

## Goals / Non-Goals

**Goals:**
- One commit per ticket on the landing branch: code + archived specs + moved change folder.
- An archive failure blocks the merge, full stop — never discovered after the code is already live.
- No direct push to a project's landing/default branch, for a new ticket or for backfill.
- Correctness under any configured `mergeConcurrency` (1-8), not only the default of 1.

**Non-Goals:**
- Rewriting history already on `main` (out of scope per the ticket).
- Changing the default `mergeMethod` or exposing new merge methods.
- A general protected-branch-detection feature; this change routes around the problem (never attempt
  a direct push to the landing branch) rather than detecting branch protection in advance.
- Fernwood's `edge`→`main` promotion flow — untouched, still entirely human-driven.

## Decisions

### Decision 1: The daemon performs both the archive and the actual merge; the worker only prepares and requests landing

Today the worker runs `gh pr merge` itself, then reports it via `weave_ticket_merge_done`. This change
moves the merge into the daemon, so that `weave_ticket_merge_done` becomes a *request to land* rather
than a *report of an already-completed merge*, and the archive can be inserted immediately before the
merge as one sequence: fetch and check freshness → rebase onto the current tip if merely stale
(Decision 5) → archive on the ticket's branch → push that branch → wait for any required checks the
push retriggers, outside the lock (Decision 6) → merge → verify → fast-forward the primary clone.

**Why not have the worker archive in its own worktree instead** (keep the merge worker-side, just add
an `openspec archive` step before it pushes)? The worker's worktree is only guaranteed fresh at the
moment it last rebased. If `mergeConcurrency` > 1, a second ticket touching the same capability can be
queued behind CI/tests for an arbitrary time after that rebase; by the time it actually pushes and
merges, its local archive would have been computed against a base another ticket has since moved past.
Preventing that requires re-synchronizing and archiving at the *last possible moment* before the merge,
under a lock that survives exactly that narrow window — which is naturally a daemon-side, in-process
critical section (extending the one that already exists), not something split across a worker turn and
a wake/turn round-trip that could take arbitrarily long and cross a 45-minute turn timeout.

**Why not keep the archive daemon-side but leave the merge worker-side**, with the daemon merely
pushing the archive commit onto the ticket's branch and telling the worker to merge next turn? This
reopens the same TOCTOU gap one level up: between "daemon pushed the archive commit" and "worker calls
`gh pr merge`", another ticket's archive-then-merge could land, and the worker's merge would carry a
now-stale archive. Folding the merge into the same daemon-held critical section closes that gap
entirely, and costs little: `GhForge.mergePr` already exists and is already tested, just unused.

**Why is this acceptable as an internal contract change** even though workers have run their own merges
since the beginning? The worker-facing contract already treats "holding the merge slot" as doing
prep-and-request, not literal command execution: `references/delivery.md` already tells the worker to
sync, resolve conflicts and re-run checks "before landing" — landing itself has always been the
daemon's word for what happens after. This change makes that literal. The worker's hard rule "never
push to main and never merge unless your ticket is in merging" (`AGENTS.md`) stays true in spirit — the
worker still never pushes to the landing branch directly — and its "never run `openspec archive`" rule
is unchanged, since the worker still never runs it.

### Decision 2: One unified per-project critical section replaces the two independent serializers

`tickets/service.ts`'s `landDelivery` serializer and `openspec/index.ts`'s archive serializer become
one: a single per-project lock covering freshness-check → update-if-stale → archive → push → merge →
verify → fast-forward. This is what makes `mergeConcurrency` > 1 safe for archiving: unrelated tickets
may still sync and run checks concurrently (unchanged), but only one ticket per project is ever inside
this sequence at a time, and each entry re-checks freshness against the *current* landing branch tip
rather than trusting whatever the worker last saw. The lock is held only across the fast, local,
daemon-driven part of the sequence (see Decisions 5 and 6 for why the two slow, external parts — a
worker round-trip and waiting for required checks — are kept out of it).

### Decision 5: A merely-stale branch is updated by the daemon itself; only a real conflict goes back to the worker

Plan review, rev 1: rejecting every branch that is not already a fast-forward descendant of the current
landing tip, unconditionally, means every ticket queued behind another gets bounced to a worker turn to
re-sync — even when nothing it touches actually conflicts. With several tickets queued, that is a
worker round-trip (minutes each) per ticket per ticket ahead of it in the queue, for no reason beyond
"something else landed first."

Instead, in the scratch worktree from task 1.2, the daemon itself brings the ticket's branch up to date
against the current landing branch tip — by rebasing, matching the sync method the worker's own
delivery.md procedure already uses, so history stays linear the same way a worker-performed rebase
would leave it, regardless of the project's `mergeMethod`. Two outcomes:

- **Clean rebase:** no worker round-trip. The daemon proceeds straight to archiving the now-current
  branch and the rest of the sequence.
- **Rebase conflict:** this is a real conflict, not mere staleness, and only this case is bounced back
  to the worker — the freshness-check rejection from Decision 2/archive-before-merge's spec keeps its
  original meaning, narrowed to conflicts the daemon's automated rebase cannot resolve on its own.

**Do the worker's tests need to re-run after a conflict-free daemon rebase?** Where it matters, yes,
but not as a new mechanism: pushing the rebased-and-archived branch re-triggers the project's required
checks exactly as any push does (Decision 6), and for a project with `requireCi: true` the daemon
already waits on those checks before merging — that wait *is* the re-verification. For a project with
`requireCi: false`, there is no check to wait for, and this change does not give the daemon a general
capability to execute a project's own test command (that would be new scope, not implied by this
ticket); a conflict-free rebase across non-conflicting files proceeds without a fresh local test run,
which is the same trust `requireCi: false` already places in an unreviewed merge today. A branch that
does not rebase cleanly still goes back to the worker, which still runs the full suite locally exactly
as it does today — so the existing safety net stays exactly where a real risk (an actual conflict)
exists, and is not exercised where it does not.

### Decision 6: Required checks the archive push retriggers are waited for outside the lock, not inside it

Plan review, rev 1: pushing the archive commit onto the ticket's branch resets any required status
checks the project's landing branch demands, so an immediate `gh pr merge` right after that push is
refused or queued by the forge ("required status checks are pending"). Waiting for them to resolve
*inside* the per-project lock would hold every other ticket in the project hostage for however long
that project's CI takes — minutes, sometimes much longer — which defeats the purpose of a narrow
critical section.

Instead: the daemon pushes the branch (rebased if needed, archived), **releases the per-project lock**,
and sets the ticket's existing `monitorNextCheckAt` (`packages/shared/src/types.ts` — already read by
`livenessViolations()` to mean "this ticket has a real, self-scheduled action path and is not stalled")
to a near-term recheck time. A periodic sweep — extending the polling `autoMergeSweep`
(`tickets/service.ts:1165`) already does via `forge.prState(...).ciState` — checks the PR's status:

- **Still pending:** reschedule `monitorNextCheckAt` and check again later, bounded by an overall
  timeout (mirroring the existing retry-ladder convention of a small number of bounded attempts rather
  than an unbounded poll — see `run-engine`'s 30s/2min/10min, max-3 ladder for the precedent this
  follows, adapted to CI-appropriate intervals). Exceeding the bound is treated as a landing failure:
  reported and the ticket blocked, not polled forever.
- **Checks passed:** re-acquire the per-project lock and re-run the freshness check (Decision 2) before
  merging — the landing tip may have moved again while this ticket waited on its own CI. If it moved,
  loop: rebase again (Decision 5), re-archive (the spec state may have changed too), push again, and
  wait on checks again. If it did not move, merge, verify, fast-forward, done.

  This loop — not just the single pending-checks wait above — is itself bounded: a busy project with
  slow CI could otherwise have a ticket lose the freshness race indefinitely, every cycle's checks
  passing just late enough for another ticket to land first. The daemon caps the number of full cycles
  (rebase → archive → push → wait) at a small fixed number, for example 3. Exceeding it fails the
  landing request the same way exceeding the pending-checks bound does: reported on the ticket with a
  clear reason (how many cycles ran and why each was superseded), the ticket left out of `done` and
  blocked rather than retried again silently.
- **Checks failed:** the archive commit's diff is limited to `openspec/specs/**` and the moved change
  folder, so a required check failing on it almost always means a real check (e.g. a project that runs
  `openspec validate` itself) caught something `openspec archive` did not. Treat this exactly like an
  archive failure: no merge, the ticket is reported with the check's own failure detail, and the
  ticket's branch is left as the daemon's rebased-but-unmerged push — the worker's next attempt (after
  fixing whatever the check flagged) re-syncs and re-requests landing, same as any other retry.

Because the lock is released during the wait, more than one ticket in a project can be independently
pushing and waiting on its own checks at once; only the final freshness-check-through-merge step is
ever exclusive. A ticket that loses that race (another ticket's checks passed first) simply loops
through Decision 5 again — self-correcting, without needing the wait phase itself to be serialized.

**The worker's local branch after a daemon rebase.** Once the daemon has rebased and pushed a ticket's
branch remotely, the worker's own local copy has diverged from `origin/<branch>` — its commits are no
longer the tip. If landing then fails (a real conflict on a later cycle, or a failed check) and the
worker is woken to retry, it must re-fetch and reset its local branch to the daemon's rebased tip before
resolving anything further, rather than trying to push its now-stale local copy over it.
`--force-with-lease` already refuses a push whose expected remote tip is wrong, so this cannot corrupt
anything either way — it is retry guidance for the worker (delivery.md), not a gap the daemon side needs
to close.

### Decision 3: The archive commit lands on the ticket's own branch, never on the landing branch directly

To end up inside the one squashed commit, the archive must be part of the diff GitHub squashes — which
means committing it onto the ticket's branch and pushing *that* branch, not committing on the primary
clone's checkout of the landing branch. This is also what eliminates the direct-push-to-protected-
branch failure mode for new tickets entirely: the daemon only ever pushes to a ticket's own branch
(exactly as `--force-with-lease` already does for a worker's own branch, just executed by the daemon
using the same forge credentials it already holds for the primary clone's remote) or opens a PR (for
backfill). It never pushes to the landing branch itself; only the merge (`gh pr merge`) changes the
landing branch.

### Decision 4: Backfill (already-merged, unarchived legacy tickets) opens a PR instead of pushing

`reconcileOpenSpecArchives` cannot retroactively rewrite a ticket's now-closed PR to include the
archive, since the code already merged before this change existed. For `pr`-delivery projects it
instead commits the archive on a new branch off the current landing branch tip and opens a small PR,
surfacing failure the same way a merge-time archive failure already is (comment + conductor wake, at
most once per standing failure). For `local-branch` projects, with no forge and no protected-branch
risk, it keeps committing directly — there is nothing to route around.

## Risks / Trade-offs

- **[Risk] The daemon now needs push and PR-merge credentials scoped to arbitrary ticket branches, not
  just the primary clone's checkout.** → It already holds forge credentials capable of pushing to the
  primary clone's remote and (per `GhForge`) already has a tested, unused `mergePr` call; this reuses
  the same credential, scoped to one more ref per operation, not a new credential class.
- **[Risk] Folding two serializers into one, and moving the merge daemon-side, touches the single most
  load-bearing code path in the system — a bug here stalls every merge in a project.** → Land it behind
  the existing test suites for `merge-done.test.ts`, `merge-queue.test.ts`, `openspec/service.test.ts`
  and `supervisor.test.ts`, updated to assert the new ordering, plus a new concurrent-same-capability
  test (acceptance #3) and a simulated push-refusal test (acceptance #4) before merging this change
  itself.
- **[Risk] A worker mid-turn when this ships could still be running the old delivery.md procedure
  (calling `gh pr merge` itself) against a daemon that now expects a landing *request*.** → This is a
  behavior change to the worker-facing skill text and the `weave_ticket_merge_done` contract together;
  they must land in the same PR (see tasks.md). A worker retried or relaunched after this merges reads
  the new skill text on its next turn, same as any other skill update.
- **[Trade-off] The worker loses direct visibility into the exact merge command and its output**, since
  the daemon now runs it. → `weave_ticket_merge_done`'s response carries the merge commit and method on
  success, or the specific rejection (stale branch / archive failure, with the same validator detail
  the `proposed` gate already surfaces) on failure — no less information than the worker gets today from
  its own `gh pr merge` output, just relayed through the tool response instead of a shell command.
- **[Risk] A project whose required checks never resolve (misconfigured CI, a check nothing ever
  reports) would poll forever.** → Bounded retry/timeout (Decision 6); exceeding it fails the landing
  request and reports it, the same as any other unresolvable landing failure — it does not hold the
  per-project lock while doing so, so it cannot stall other tickets even if it never resolves.
- **[Risk] The daemon rebasing a ticket's branch itself (Decision 5) is new authority it didn't have
  before** — today only workers rewrite ticket branch history. → Scoped narrowly: only a rebase onto
  the current landing tip, only when it applies with zero conflicts, only immediately before archiving
  and merging that same ticket; any conflict still routes to the worker exactly as today.
- **[Trade-off] `requireCi: false` projects get less re-verification of a daemon-performed rebase than
  a worker-performed one** (Decision 5) — a real but narrow gap, accepted rather than solved by giving
  the daemon a general "run this project's tests" capability, which is out of scope for this change.

## Migration Plan

1. Ship the unified serializer, the daemon-side archive-then-merge sequence, and the `GhForge.mergePr`
   wiring behind the existing `weave_ticket_merge_done` tool — change its contract (request-to-land
   rather than report-of-a-completed-merge) and the worker-facing skill text in the same PR, since a
   worker following the old text and a daemon expecting the new contract cannot both be half-shipped.
2. Update `reconcileOpenSpecArchives` to the PR-based backfill path in the same change, since it shares
   the retired `commitArchive` push path.
3. No feature flag or gradual rollout: the old and new contracts for `weave_ticket_merge_done` are
   mutually exclusive (one expects a completed merge, the other performs it), so this ships as one
   atomic change, verified by the updated test suites, per this project's existing convention of
   landing each ticket as a single reviewed change rather than a staged rollout.
- **Rollback:** revert the PR. No data migration is involved; the only persistent state this touches is
  ticket status/activity rows and OpenSpec change directories, both of which the existing revert-safe
  transition and archive machinery already handles.
