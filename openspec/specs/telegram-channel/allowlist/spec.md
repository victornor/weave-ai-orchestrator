# telegram-channel/allowlist Specification

## Purpose
Defines how the Telegram allowlist set in Settings reaches the running channel, what an empty allowlist means, how an existing deployment that relied on the old open-by-default behavior is carried through the change without going silently deaf, and how the interface states which access rule is currently in force.

## Requirements

### Requirement: The Settings allowlist reaches the channel under one name

The allowlist Settings collects SHALL be the same field the Telegram channel reads to admit or reject a message. There SHALL NOT be two differently-named fields, one written by the interface and a different one read by the channel.

#### Scenario: An id added in Settings is enforced

- **WHEN** captain adds a Telegram user id to the allowlist in Settings and saves
- **THEN** a message from that user is accepted and a message from a user not in the list is rejected

### Requirement: An empty allowlist admits nobody, not everybody

A Telegram channel whose allowlist is empty SHALL NOT accept messages from any user, unless the workspace is explicitly marked as open to all Telegram users. Populating the allowlist with at least one id SHALL restrict the channel to exactly that list, regardless of any open-to-all marking.

#### Scenario: A newly configured channel with no ids

- **WHEN** the Telegram channel is enabled for the first time and no id has ever been added to its allowlist, and the workspace is not marked open to all
- **THEN** the channel accepts no user's messages

#### Scenario: A populated allowlist

- **WHEN** the allowlist holds one or more ids
- **THEN** only messages from those ids are accepted, whether or not the workspace is marked open to all

#### Scenario: A user rejected by an empty allowlist

- **WHEN** a Telegram user who is not on the allowlist sends a message to a channel whose allowlist is empty and which is not marked open to all
- **THEN** the message is not processed

### Requirement: An already-open, already-reachable deployment is not silently muted by the new default

A workspace SHALL be carried through this change so that it keeps accepting every user's messages, without any action from the human, only when both are true: its allowlist was never explicitly set by the human, to any value including empty, and it already had a bot token that actually resolved — meaning it was, in fact, already accepting every user's messages before this change. This SHALL happen exactly once per workspace, at the first load under the new behavior, and SHALL NOT happen for a workspace that configures Telegram for the first time after that point.

A workspace whose allowlist was explicitly set by the human — including set to empty — SHALL NOT be carried through this way, since setting it at all is evidence of an intent to restrict, not evidence of nothing. A workspace with no bot token that ever resolved SHALL NOT be carried through this way either, since it was never actually reachable and there is nothing to protect.

A workspace carried through this way, and any workspace later marked open to all users, SHALL show that state plainly in the interface rather than leaving it indistinguishable from an ordinary empty allowlist.

#### Scenario: An already-open, already-reachable deployment survives the upgrade

- **WHEN** a workspace was already running Telegram with a working token and an allowlist that was never set, before this change, and it is loaded for the first time after
- **THEN** it continues accepting every user's messages, and Settings shows the channel as open to all Telegram users

#### Scenario: A deployment whose allowlist was already set to empty is not grandfathered

- **WHEN** a workspace's allowlist was explicitly set to empty by the human before this change, whether or not a token resolves
- **THEN** it is not marked open to all, and Settings shows the channel as locked to nobody

#### Scenario: A deployment with no working token is not grandfathered

- **WHEN** a workspace's allowlist was never set, but it has never had a bot token that resolved
- **THEN** it is not marked open to all, and Settings shows the channel as locked to nobody

#### Scenario: The grandfathering happens once

- **WHEN** a workspace already carried through as open to all is loaded again later
- **THEN** it is not re-evaluated, and remains open to all even if its allowlist has been empty the whole time

#### Scenario: A workspace configured for the first time after this change

- **WHEN** a workspace enables Telegram for the first time after this change ships, with no allowlist entries
- **THEN** it is not marked open to all, and accepts no user's messages until an id is added

### Requirement: Ids already entered into the allowlist are preserved as a restriction

Where a workspace's allowlist held one or more ids before this change, under whatever field name held them, those ids SHALL be carried forward as the channel's restriction rather than discarded. An entry that cannot be read as a Telegram user id SHALL be dropped rather than kept or treated as blocking, and this SHALL be recorded so it can be found.

#### Scenario: Populated ids are carried forward

- **WHEN** a workspace's allowlist already held one or more valid ids before this change
- **THEN** after the change, the channel is restricted to exactly those ids

#### Scenario: An unreadable entry is dropped, not kept

- **WHEN** a workspace's allowlist held an entry that is not a valid Telegram user id
- **THEN** that entry is not carried forward, the rest are, and the drop is recorded

### Requirement: The interface states which access rule is in force

Settings SHALL show, at the point captain views or edits the allowlist, which of the following is currently true: the channel is locked to a specific set of ids, the channel is open to any Telegram user, or the channel is locked to nobody because the allowlist is empty and it is not marked open to all.

#### Scenario: Locked to specific users

- **WHEN** the allowlist holds one or more ids
- **THEN** Settings states the channel is locked to those ids

#### Scenario: Open to all

- **WHEN** the workspace is marked open to all Telegram users
- **THEN** Settings states the channel is open to any Telegram user

#### Scenario: Locked to nobody

- **WHEN** the allowlist is empty and the workspace is not marked open to all
- **THEN** Settings states the channel is off because no user is allowed
