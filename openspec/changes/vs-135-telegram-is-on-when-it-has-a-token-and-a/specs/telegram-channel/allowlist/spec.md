## ADDED Requirements

### Requirement: An open-to-all workspace can be turned off from Settings

A workspace marked open to all Telegram users — whether grandfathered by the upgrade in VS-125 or
already carrying that setting — SHALL be shown in Settings as an explicit, actionable state, not
only as a status badge. Settings SHALL offer a direct action that turns the open-to-all marking off
in favour of the allowlist. There SHALL be no action in the interface that turns the open-to-all
marking on; it can only ever be true for a workspace that already had it before this requirement
existed.

#### Scenario: An open-to-all workspace shows a way to close itself

- **WHEN** captain opens the Telegram section of Settings for a workspace marked open to all
- **THEN** Settings shows that state plainly and offers an action to turn it off

#### Scenario: Turning off open-to-all locks the channel down

- **WHEN** captain uses that action
- **THEN** the workspace is no longer marked open to all, and the channel now accepts only ids on
  the allowlist (nobody, if it is still empty)

#### Scenario: There is no way to turn it on

- **WHEN** captain looks for a way to mark a workspace open to all Telegram users from Settings
- **THEN** no such action exists

### Requirement: An allowlist change takes effect on the running channel without a daemon restart

Adding or removing a Telegram user id from the allowlist — directly, through approving a pending
identity, or by turning off the open-to-all marking — SHALL take effect on the running Telegram
channel immediately, without restarting the daemon.

#### Scenario: An added id works on the next message

- **WHEN** captain adds a Telegram user id to the allowlist
- **THEN** a message from that user arriving after the change is accepted, without a daemon restart

#### Scenario: A removed id stops working on the next message

- **WHEN** captain removes a Telegram user id from the allowlist
- **THEN** a message from that user arriving after the change is rejected, without a daemon restart
