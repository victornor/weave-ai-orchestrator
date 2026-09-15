## ADDED Requirements

### Requirement: An approval left unreviewed re-wakes the weaver until it is reviewed or closed

When a human-owned `plan_approval`, `merge_approval` or `action_approval` stays **not looked at yet**
and `open` for more than ten minutes, the daemon SHALL enqueue a wake for the workspace's weaver that
names the decision, its ticket when it has one, and how long it has waited. The daemon SHALL repeat
the wake while the card stays **not looked at yet** and `open`, with a growing wait between wakes:
about ten minutes before the first, then about thirty, then about sixty minutes between each
subsequent wake.

The reminder SHALL be idempotent per decision and per point in that schedule: a repeated scan, a
turn-end check, or any other path SHALL NOT produce more than one live wake for the same decision at
the same point, and SHALL NOT stack duplicate wakes for the same decision. A reminder that arrives
while the weaver already has a queued or claimed wake SHALL not create a second live wake; if it
coalesces into a queued weaver wake, the coalesced entry SHALL still carry the decision's id, so the
weaver can see which card the reminder names.

The reminders SHALL stop once the decision is no longer **not looked at yet** and `open` — because
the weaver marked it **looked at** or **looked at, with concerns**, or because it was answered,
superseded, withdrawn or expired. A review-carrying decision the weaver itself owns SHALL NOT produce
these reminders. A decision whose ticket is terminal SHALL NOT produce them.

The reminder SHALL be an ordinary wake and SHALL respect the daemon's run limit: it SHALL NOT start a
turn in parallel with the weaver's allowed concurrent turns, and it SHALL NOT take a run slot from
another agent.

#### Scenario: A card unseen past the first threshold wakes the weaver

- **WHEN** a human-owned `merge_approval` has been open and **not looked at yet** for eleven minutes
- **THEN** the daemon enqueues a wake for the workspace's weaver naming the decision, its ticket and
  how long it has waited

#### Scenario: A scan before the next wait enqueues no second wake

- **WHEN** the reminder for a decision has been enqueued and the next scan runs before the wait has
  grown to the next point in the schedule
- **THEN** no second live wake is enqueued for that decision

#### Scenario: The reminder repeats as the wait grows

- **WHEN** a decision stays **not looked at yet** and `open` long enough for the next point in the
  schedule
- **THEN** exactly one more reminder is enqueued for it

#### Scenario: Marking the card reviewed stops the reminders

- **WHEN** the weaver marks the decision **looked at** before the next reminder point
- **THEN** no further reminder is enqueued for that decision

#### Scenario: Closing the card stops the reminders

- **WHEN** the decision is answered, superseded, withdrawn or expired before the next reminder point
- **THEN** no further reminder is enqueued for that decision

#### Scenario: A weaver-owned approval produces no reminder

- **WHEN** a review-carrying decision is owned by the weaver rather than the human and stays open
- **THEN** no review reminder is enqueued for it

#### Scenario: A coalesced reminder keeps the decision id

- **WHEN** a review reminder is enqueued while the weaver already has a queued wake, so the reminder
  coalesces into it
- **THEN** the coalesced entry carries the decision's id so the weaver's prompt names it
