## Purpose

Defines how the Telegram channel's bot token is set, replaced and cleared from Settings, validated against Telegram before it is accepted, kept unreadable once stored, and made to take effect on the running channel without a daemon restart.

## ADDED Requirements

### Requirement: The bot token is set, replaced and cleared from Settings

The Telegram bot token SHALL be settable, replaceable and clearable from the Telegram section of Settings, without editing any file and without setting an environment variable on the daemon host. Setting a token SHALL register it in the workspace secret store; it SHALL NOT be written into `workspace.yaml` and SHALL NOT be stored in the database in plaintext.

#### Scenario: Setting a token for the first time

- **WHEN** captain enters a bot token in Settings and saves, and the token is valid
- **THEN** the token is registered in the workspace secret store and `workspace.yaml` is not modified

#### Scenario: Replacing a token

- **WHEN** captain saves a new, valid token over one that is already configured
- **THEN** the new value replaces the old one in the secret store and the channel uses the new value from then on

#### Scenario: Clearing a token

- **WHEN** captain clears the configured token from Settings
- **THEN** the secret store no longer holds a value for it

### Requirement: The token is write-only

No route, response body, log line, error message, activity record, transcript or knowledge entry SHALL carry the bot token's value or any part of it once it has been submitted. The interface SHALL be able to show only whether a token is currently configured and, when known, the bot's username — never the value, and never a partial or reconstructable form of it.

#### Scenario: Reading the channel's status

- **WHEN** Settings asks whether the Telegram token is configured
- **THEN** the response says whether a token is configured and, if known, the bot's username, and contains no token value

#### Scenario: A validation failure does not leak the token

- **WHEN** saving a token fails because Telegram rejects it
- **THEN** the error shown to captain contains what Telegram said and does not contain the submitted token value

#### Scenario: Nothing durable carries the token

- **WHEN** a token is set, replaced, cleared, or fails validation
- **THEN** no log line, activity record, transcript or knowledge entry produced by that action contains the token value

### Requirement: A stored token takes precedence over an unresolved `${ENV_VAR}` deployment

When resolving the token to use for the running channel, a value held in the workspace secret store SHALL take precedence over a `${ENV_VAR}` reference resolved from `workspace.yaml`. A workspace that already has a working `${ENV_VAR}`-resolved token SHALL keep working unchanged as long as no token has been set through Settings. Which source is in effect SHALL be visible in the interface, not only in the code.

#### Scenario: No token set through Settings yet

- **WHEN** `workspace.yaml` already resolves `botToken` from an environment variable on the daemon host and no token has been registered in the secret store
- **THEN** the channel uses the `${ENV_VAR}`-resolved value, and Settings shows the token as configured with that source

#### Scenario: A token is set through Settings on top of an existing `${ENV_VAR}` deployment

- **WHEN** a workspace already has a working `${ENV_VAR}`-resolved token and captain sets a token through Settings
- **THEN** the secret-store value is used for the channel from then on, in preference to the `${ENV_VAR}`-resolved value

### Requirement: Saving validates the token against Telegram before accepting it

Saving a token SHALL call Telegram's `getMe` before the token is accepted. On success, the bot's username SHALL be shown to captain so they can confirm they pasted the right token. On failure, the save SHALL be rejected with what Telegram said, and any token that was previously configured and working SHALL be left untouched.

#### Scenario: A valid token

- **WHEN** captain saves a token and Telegram's `getMe` succeeds for it
- **THEN** the token is registered and the bot's username from the response is shown to captain

#### Scenario: An invalid token with nothing previously configured

- **WHEN** captain saves a token and Telegram's `getMe` rejects it
- **THEN** the save is rejected with Telegram's error and no token is registered

#### Scenario: An invalid replacement does not disturb a working token

- **WHEN** a valid token is already registered and captain saves a new token that Telegram's `getMe` rejects
- **THEN** the save is rejected with Telegram's error and the previously-registered token is unchanged and still in effect

### Requirement: Setting or clearing the token takes effect without a daemon restart

Setting or clearing the bot token SHALL take effect on the running Telegram channel immediately: the channel SHALL start if it was off and a valid token is now configured, SHALL pick up a replaced token without a stale token continuing to be used, and SHALL stop if its token is cleared. None of this SHALL require restarting the daemon.

#### Scenario: The channel starts once a token is set

- **WHEN** the Telegram channel is enabled but has no token, and captain sets a valid token
- **THEN** the channel starts using that token, without a daemon restart

#### Scenario: The channel picks up a replaced token

- **WHEN** the Telegram channel is running and captain replaces its token with a new valid one
- **THEN** the channel is running on the new token, without a daemon restart

#### Scenario: The channel stops when its token is cleared

- **WHEN** the Telegram channel is running and captain clears its token
- **THEN** the channel stops, without a daemon restart

### Requirement: A channel with no token is clearly off, not half-configured

When the Telegram channel is enabled but no token is configured from either source, the channel SHALL NOT run, and Settings SHALL state that the channel is off because it has no token rather than showing it as otherwise ready.

#### Scenario: Enabled with no token anywhere

- **WHEN** the Telegram channel is enabled and neither the secret store nor a resolved `${ENV_VAR}` provides a token
- **THEN** the channel does not run, and Settings states it is off for lack of a token

#### Scenario: Cleared token leaves the channel cleanly off

- **WHEN** captain clears a working token
- **THEN** the channel stops rather than continuing to run on a stale value, and Settings states it is off for lack of a token
