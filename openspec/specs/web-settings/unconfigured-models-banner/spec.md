# web-settings/unconfigured-models-banner Specification

## Purpose
Someone who has just deployed cannot fail to notice that worker adapters are not chosen yet, and they are sent to the place that chooses them until that is no longer true.

## Requirements

### Requirement: An unmissable warning shows until no daemon catalog option is unconfigured

While the daemon catalog overlay contains at least one option with no runtime, every signed-in page of the web app SHALL show a warning in the failed status tone, below the header and above the page, that worker adapters have not been chosen and that the operator should choose them in daemon Settings → Models before running workers. The warning SHALL include a control that goes to that Models section.

The warning SHALL NOT have a dismiss or hide control. Closing a toast, refreshing, or navigating SHALL NOT clear it.

The warning SHALL disappear only when the daemon catalog overlay contains no option with an unset runtime: every remaining option has a runtime, or the unconfigured ones have been removed, or the overlay has been cleared.

#### Scenario: Fresh seed shows the warning on a workspace page

- **WHEN** the daemon catalog overlay has the three seeded options with no runtime and the operator is on a workspace page
- **THEN** the warning is visible, names that adapters are not chosen, and offers a control to daemon Settings → Models

#### Scenario: The warning is also on a page with no workspace

- **WHEN** the same overlay is unconfigured and the operator is on a daemon-level page such as Settings
- **THEN** the same warning is visible

#### Scenario: There is no way to dismiss it

- **WHEN** the warning is showing
- **THEN** it has no control that hides it while any overlay option still has no runtime

#### Scenario: Configuring every remaining option clears it

- **WHEN** every option still in the daemon catalog overlay has a runtime
- **THEN** the warning is not shown

#### Scenario: Removing the last unconfigured option clears it

- **WHEN** the operator removes every overlay option that had no runtime and at least one configured option remains
- **THEN** the warning is not shown

#### Scenario: A fully configured overlay never shows it

- **WHEN** the daemon catalog overlay is empty, or every option in it has a runtime
- **THEN** the warning is not shown
