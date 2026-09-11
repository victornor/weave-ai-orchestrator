## Context

See `proposal.md` - Why. Relevant existing shape:

- `packages/release/src/index.ts` builds each release directory by `git clone`-ing the source and checking out `ref`; the clone's `.git` survives (`releaseSha` reads it directly), so a release directory can answer git queries about its own history without a second checkout.
- `Upgrade.fromRelease` / `Upgrade.toRelease` are release directory paths; `releaseSha(path)` resolves a commit from either the directory's `.git` or, when that clone no longer exists (pruned), a fallback regex on the directory name (`<stamp>-<sha>`) — the fallback needs no filesystem access, so a sha is recoverable even for a pruned release, but its *history* is not.
- Each workspace's own db carries its `ticket_prefix` (`workspaces.ticket_prefix`), and every commit this monorepo produces for a landed ticket has the subject `<PREFIX>-<number>: <title> (#<pr>)` (confirmed against `git log --oneline` on this repo). The `chore(openspec): archive ...` commits that follow each one do not match.
- `AnnouncementFacts` (`upgrade-announce.ts`) is the seam that keeps the announcement's logic pure and daemon-free: every fact it exposes is a function the effectful `upgrade.ts` implements against real state, and `buildAnnouncement` is tested against fakes of that interface.

## Goals / Non-Goals

- Goal: size and, where possible, name the gap between "commits that look like landed ticket work" and "tickets the delivery records list", without ever treating the former as authoritative.
- Goal: fail open. A release whose history cannot be read (pruned, hand-made, no `.git`) reports nothing extra rather than crashing the announcement or guessing.
- Non-goal: reconciling or fixing the underlying gap (that's `mergeDone`/VS-232's territory, already closed). This change only makes the reporting honest when a gap exists for whatever reason.
- Non-goal: a UI or changelog surface for the discrepancy. It travels the same two paths every other announcement fact does (the chat line, the conductor's wake) — see proposal.md Impact/Out of scope.

## Decisions

**Identifier-set diff, not a raw count comparison.** Collect the set of unique ticket identifiers named in commit subjects within the window (`<PREFIX>-<n>`, matched at the start of the subject), and the set of identifiers already in `facts.landed(window)`. The undelivered set is the former minus the latter; its size is what gets reported, and its members (bounded, same spirit as `ANNOUNCED_TICKETS`) are what get named. A raw commit-count-vs-ticket-count comparison was considered and rejected: it produces the right number in the common case but the wrong one whenever a single ticket's history has more than one matching commit (a revision, a second squash after a force-push) or the delivery list itself has an entry with no matching commit (a hand-created ticket row, a test fixture) — either shifts the count without there being an actual gap, and neither can be named.

**The git read lives in `packages/release`, filtered by prefix in `packages/server`.** `packages/release` is a dependency-free leaf (see CLAUDE.md's boundary rules) that already owns every other git operation against a release directory; it gains one more: read commit subjects between two commits. It has no notion of a ticket or a prefix, so it returns raw subjects and lets the caller (`upgrade.ts`, which already reads the workspace db for other facts) apply the `<PREFIX>-<n>:` regex. This keeps `release` generic and keeps the ticket-shape knowledge where the rest of it already lives.

**Git operations run against `Upgrade.toRelease` (the specific upgrade's target), not `deps.releaseRoot` (whatever the daemon happens to be running now).** `announce()` can in principle process more than one unannounced terminal upgrade in one pass; using the row's own `toRelease` path is correct for each regardless of what is current by the time it is actually announced. If that directory has since been pruned, the fail-open behavior (empty result) applies — same as the existing `since: null` no-window case in `releaseWindow`.

**Scope of "ticket-referencing"**: a commit subject matching `^<PREFIX>-\d+:` at the very start, mirroring this repo's own convention (confirmed by inspection of `git log`, not assumed) and excluding the archive `chore(openspec): ...` commits that accompany every landed one. A workspace whose prefix never appears in the shared codebase's history (not applicable to this monorepo, but a design constraint for correctness) simply reports nothing — no false positives from another workspace's tickets sharing the same commit stream, since the regex is anchored to *this* workspace's own prefix.

**The `done`-with-no-`mergeCommit` ticket-side inconsistency the proposal's source ticket raised is left to a follow-up ticket**, filed once this change is approved and applying. It is a ticket-data-model concern (visibility on the ticket itself or a list of it), not an announcement concern, and this change already makes the announcement honest without it — see proposal.md Out of scope.

## Risks / Trade-offs

- [A ticket-referencing commit whose subject doesn't match `<PREFIX>-<n>:` exactly (a manually authored commit, a hotfix) is invisible to this check] → Acceptable: the check is a diagnostic net for the one shape we know breaks (a merge that bypasses `mergeDone`), not a guarantee; it fails open rather than misreporting.
- [Reading git history adds a subprocess call to every completed-upgrade announcement] → Bounded and best-effort: one `git log` invocation per workspace per announced upgrade, wrapped the same way `releaseSha` already wraps its own git calls (try/catch, empty result on any failure).

## Migration Plan

None: additive to an existing payload and message; no data migration. Older, already-announced upgrades are not retroactively re-announced (consistent with the once-only marker).
