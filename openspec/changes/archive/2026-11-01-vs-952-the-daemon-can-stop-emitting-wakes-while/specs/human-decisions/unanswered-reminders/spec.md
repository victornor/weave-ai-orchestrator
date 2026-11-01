## Purpose

Makes sure a decision that is waiting on the human does not wait silently. Once a card has been the human's to answer for longer than a threshold, the human is told again: once per stage, through the same channels that carried the card.

## ADDED Requirements

### Requirement: An unanswered human-owned decision re-notifies the human

The supervisor SHALL, on its liveness cadence, find every decision whose `status` is `open` and whose `owner` is `human`, and compute when it became the human's to answer:

- For `plan_approval`, `merge_approval` and `action_approval`, the decision becomes the human's when the weaver records a review, so the clock starts at `weaver_reviewed_at`. A card whose `weaver_review_status` is still `unseen` is waiting on the weaver, and SHALL NOT be reminded.
- For every other human-owned kind, the clock starts at `created_at`.

A decision whose age on that clock reaches `defaults.humanReminderAfterSec` (default 14400) SHALL emit a `decision.reminder` event (entity `decision`, payload carrying `decisionId`, `ticketId`, `kind`, `stage` and `ageMs`) and record a `decision.reminded` activity row. A further reminder SHALL follow every `defaults.humanReminderEverySec` (default 86400) after the first. A value of `0` for `humanReminderAfterSec` SHALL disable reminders.

#### Scenario: A reviewed merge card unanswered for four hours
- **WHEN** a `merge_approval` is open, human-owned, `weaver_review_status = 'looked'`, and `weaver_reviewed_at` is 4 h 1 min ago
- **THEN** one `decision.reminder` event is emitted for it with `stage` 0

#### Scenario: A card still waiting on the weaver
- **WHEN** a `merge_approval` is open, human-owned, `weaver_review_status = 'unseen'`, and created 30 h ago
- **THEN** no reminder is emitted for it

#### Scenario: A question asked of the human
- **WHEN** a human-owned `question` decision has been open since 4 h 1 min ago
- **THEN** a reminder is emitted with its age measured from `created_at`

#### Scenario: Reminders disabled
- **WHEN** `defaults.humanReminderAfterSec` is 0
- **THEN** no reminder is emitted for any decision

#### Scenario: An answered card
- **WHEN** the decision is `answered`, `withdrawn`, `expired` or `superseded`
- **THEN** no reminder is emitted for it

### Requirement: Each reminder stage fires once, across restarts

The system SHALL persist, per decision, the reminder last sent. The record SHALL be keyed by the clock's start and the stage, so a repeated scan, a second supervisor tick or a daemon restart does not send the same stage twice. If the weaver re-reviews a card and so moves its clock start, the stages SHALL count from the new start.

#### Scenario: Repeated scans
- **WHEN** the scan runs twice within the same stage for the same decision
- **THEN** exactly one `decision.reminder` event exists for that stage

#### Scenario: The next stage
- **WHEN** the same card is still open 28 h 1 min after its clock start
- **THEN** a second reminder is emitted with `stage` 1

#### Scenario: Restart
- **WHEN** the daemon restarts after stage 0 was sent and the card is still in stage 0
- **THEN** no reminder is sent again

### Requirement: Channels deliver a reminder as a follow-up, not a second card

On `decision.reminder`, the chat channel manager SHALL post a text message to the workspace's primary thread. The message names the ticket identifier (when there is one), the decision kind and title, how long it has waited, and the `/d <decisionId> <option>` command that answers it. It SHALL NOT push a second answerable card. The web push dispatcher SHALL send a `decisions` push for the reminder. A delivery failure SHALL be logged and SHALL NOT affect the supervisor tick.

#### Scenario: Telegram reminder
- **WHEN** a `decision.reminder` is emitted for VS-951's merge card, open for 4 h
- **THEN** the primary thread receives one text message containing `VS-951`, `merge`, the age, and `/d <decisionId>`

#### Scenario: Card no longer open
- **WHEN** the decision was answered between the event and its delivery
- **THEN** nothing is posted
