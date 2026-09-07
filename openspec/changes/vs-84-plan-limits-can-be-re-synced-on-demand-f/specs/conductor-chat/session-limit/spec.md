## MODIFIED Requirements

### Requirement: The other windows are one interaction away

The weekly window and any per-model windows the account reports SHALL be reachable from the header
without occupying it: activating the meter SHALL open a detail showing the plan label, every window
the account reports with its utilisation and its reset time, and the snapshot's age. The detail
SHALL present those windows exactly as the usage view presents them.

The detail SHALL show the snapshot's age beside the numbers, worded as the time since the account
was last synced, and SHALL offer the same on-demand sync of the conductor's runtime that the usage
view offers, with the same in-flight, failed and refused-as-too-recent behaviour. A sync made from
the detail SHALL update the header meter as well, without a reload.

The header SHALL fit on a phone without wrapping onto a second line, and the detail SHALL be
reachable by tapping it there.

#### Scenario: Opening the detail

- **WHEN** the human activates the header meter
- **THEN** a detail opens listing every window the account reports, including the weekly and
  per-model windows, each with its utilisation and reset time, and the snapshot's age

#### Scenario: The header stays one line

- **WHEN** the chat is shown at a phone width
- **THEN** the meter is on the header's single line, and tapping it opens the detail

#### Scenario: Syncing from the detail

- **WHEN** the human uses the sync control in the detail
- **THEN** the conductor's runtime is synced on demand, and the detail and the header meter both
  show the returned snapshot without a reload
