## ADDED Requirements

### Requirement: A merge approval card shows the live status of the checks it is waiting on

Every `merge_approval` card SHALL show a compact chip describing the ticket's recorded check state for
its pull request, wherever the card renders — Needs you, the chat pane, and the ticket page — derived
from data the daemon has already recorded. The card SHALL NOT poll the forge itself. The chip SHALL
name the individual checks where the state calls for it, and SHALL be updated live as the recorded
check state changes, with no page reload.

The chip SHALL say exactly one of the following, from the recorded rolled-up state and tally:

- while any check is queued or running: `Waiting for CI` with the passed-out-of-total tally, and the
  pending checks' names available on the card (hover or expand);
- when every check has completed successfully: `CI passed`;
- when any check has failed: `CI failed` naming at least the first failed check;
- when every reported check was skipped: `CI skipped` — an all-skipped rollup SHALL NOT read as a pass;
- when the recorded checks describe a commit other than the head the card is approving: a stale
  indication (`CI on an older commit`) in place of the tally.

A pull request with no recorded checks SHALL show no chip, and a card whose ticket has no pull request
SHALL show no chip.

The chip SHALL appear on an unreviewed card exactly as on a reviewed one, so a card nobody has looked
at and a card waiting on CI are distinguishable by more than the review line.

#### Scenario: Checks still running

- **WHEN** a merge approval card's ticket has a recorded rollup of two passed checks out of four with two queued
- **THEN** the card shows `Waiting for CI` with `2/4` and can name the two pending checks

#### Scenario: All checks passed

- **WHEN** every check in the recorded rollup has completed successfully
- **THEN** the card shows `CI passed`

#### Scenario: A check failed

- **WHEN** one check in the recorded rollup has failed
- **THEN** the card shows `CI failed` and names the failed check

#### Scenario: Every check skipped

- **WHEN** the recorded rollup contains only skipped checks
- **THEN** the card shows `CI skipped` and does not read as a pass

#### Scenario: Checks are for an older commit

- **WHEN** the recorded checks describe a head that differs from the head the card is approving
- **THEN** the card shows the stale indication `CI on an older commit` instead of a tally

#### Scenario: No checks recorded

- **WHEN** the ticket's pull request records no checks
- **THEN** the card shows no CI chip

#### Scenario: The chip updates without a reload

- **WHEN** the recorded check state for a rendered merge approval card changes while the card is on screen
- **THEN** the chip reflects the new state without a page reload and without the card asking the forge

#### Scenario: An unreviewed card still shows its CI state

- **WHEN** a merge approval card is unreviewed and its checks are still pending
- **THEN** the card shows its unreviewed wording and the `Waiting for CI` chip together

### Requirement: The card shows the weaver's waiting statement

When an open review-carrying decision carries a review `waitingOn`, the card SHALL render it as a line
of its own, distinct from the review outcome line and its note, attributed to the weaver. A decision
whose review carries no waiting statement SHALL render no such line.

#### Scenario: A card with a waiting statement

- **WHEN** an open merge approval card is rendered and its review carries a `waitingOn`
- **THEN** the card shows that statement as a distinct weaver-attributed line

#### Scenario: A card without one

- **WHEN** an open merge approval card is rendered and its review carries no `waitingOn`
- **THEN** no waiting line appears
