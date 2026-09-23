## Purpose

Lets a primary clone that cannot be fast-forwarded recover on its own when nothing but a rewritten
remote could be responsible, instead of leaving every such divergence to a human to notice and clear by
hand, while never discarding a commit that reflects real, unpushed local work.

## ADDED Requirements

### Requirement: A fast-forward failure caused only by a rewritten remote is resolved automatically

Every time an attempt to bring a project's primary clone up to date with `origin/<landingBranch>`
succeeds, the system SHALL record what the clone's branch was left pointing at. When a later attempt's
fast-forward fails, the system SHALL compare the clone's branch, as it stands before that attempt does
anything else, against what was recorded the last time an attempt succeeded.

When they are the same — nothing has moved the clone's branch since the system itself last confirmed it
matched the remote — the system SHALL treat the failure as caused only by the remote's history having
been rewritten, reset the clone's branch to match `origin/<landingBranch>`, and record the new position
as the confirmed state. The primary clone SHALL end the attempt matching `origin/<landingBranch>`, and
whatever needed the clone to be current (a curation turn, the overview's sync action, a scheduled
reconciliation) SHALL proceed as though the fast-forward itself had succeeded.

#### Scenario: The remote was force-pushed since the last confirmed sync

- **WHEN** a project's primary clone last matched `origin/<landingBranch>` with nothing having moved its
  branch since, and the remote branch is then force-pushed or rebased so a fast-forward is no longer
  possible
- **THEN** the next attempt to bring the clone up to date resets its branch to the new
  `origin/<landingBranch>` tip and succeeds, with no human action required

#### Scenario: A project with no confirmed sync yet is not assumed safe

- **WHEN** an attempt to bring a project's primary clone up to date fails to fast-forward, and no earlier
  attempt for that project has ever recorded a confirmed synced position
- **THEN** the clone is left exactly as it was and the failure is reported as unresolved, the same as
  when something has moved the branch (see the next requirement) — a missing baseline is never treated
  as evidence that a reset is safe

### Requirement: A fast-forward failure caused by real, unpushed local commits is never silently discarded

When a fast-forward fails and the clone's branch, before the attempt does anything else, does **not**
match what was recorded the last time an attempt succeeded — something has committed into the primary
clone outside this recovery's own knowledge since then — the system SHALL NOT reset or otherwise alter
the clone's branch. It SHALL report that the clone holds a commit not present on `origin/<landingBranch>`
and was left untouched, distinguishably from a fast-forward that simply has not been attempted yet, so
whatever consumes the report (a blocked ticket, the overview's sync action) can tell a real conflict
apart from routine staleness without reading code.

A project in this state SHALL recover the same way any other project first establishes its baseline:
once a later attempt brings the clone to a confirmed match with `origin/<landingBranch>` — typically
because the unpushed commit has since been pushed, or removed, by whatever put it there, or by a human —
that attempt records the new confirmed position, and automatic recovery is available again from then on.

#### Scenario: A commit was made directly into the clone and never pushed

- **WHEN** something commits directly onto a project's primary clone's checked-out branch without going
  through the recorded-sync path, and a fast-forward is then attempted
- **THEN** the clone's branch is left exactly as it was, no commit is discarded, and the failure is
  reported as holding a commit not on the remote — not as a generic fast-forward failure

#### Scenario: The clone recovers once it is pushed

- **WHEN** a primary clone was left holding an unpushed commit that made a fast-forward fail, and that
  commit is later pushed to `origin/<landingBranch>` (or removed) so the clone's branch is once again
  reachable from the remote
- **THEN** the next attempt succeeds, records the new confirmed position, and automatic recovery is
  available again for any future divergence
