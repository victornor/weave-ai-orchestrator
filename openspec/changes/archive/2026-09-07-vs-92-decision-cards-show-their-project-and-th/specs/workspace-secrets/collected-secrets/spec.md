## Purpose

Defines how a workspace holds a secret value the human supplied — where it lives, that nothing can read it back out, how it is attached to a role, and what a worker of that role receives — so a credential an agent needs can be given once and used without ever being written into a conversation.

## ADDED Requirements

### Requirement: A workspace can hold a secret value under a name

The workspace SHALL be able to register a secret: a name unique within the workspace, the environment variable name it is exposed as, its scope, and the value. Registering a name that is already registered SHALL replace the value it holds.

The value SHALL NOT be stored in the workspace database. It SHALL be held encrypted in the workspace's own state directory, in a file readable and writable only by the account the daemon runs as, under a key held in that same directory with the same protection. The database SHALL hold only the name, the environment variable name and the scope.

The state directory SHALL already be excluded from version control, and the files holding the values and the key SHALL be excluded from any export of the workspace and from any backup taken of the database, so that neither carries a value.

A secret name SHALL be usable as an environment variable name, or SHALL carry the environment variable name it is exposed as; a name that is neither SHALL be refused.

#### Scenario: Registering a value

- **WHEN** a secret is registered with a name and a value
- **THEN** the name, its environment variable name and its scope are recorded, and the value is held encrypted outside the database

#### Scenario: Registering the same name again

- **WHEN** a secret is registered under a name that already holds a value
- **THEN** the new value replaces the old one and the name is still registered once

#### Scenario: The value is not in the database

- **WHEN** a secret has been registered
- **THEN** no table of the workspace database contains the value

#### Scenario: The files are protected

- **WHEN** the store writes a value or creates its key
- **THEN** both files are readable and writable only by the account the daemon runs as

#### Scenario: An unusable name

- **WHEN** a secret is registered under a name that cannot be an environment variable name and no environment variable name is given
- **THEN** the registration is refused

### Requirement: Nothing reads a secret value back out

The workspace SHALL be able to list which secrets are registered, giving each one's name, environment variable name, scope and whether a value is held for it, and SHALL NOT offer any way for a client, a channel, an agent or an export to obtain a value. Reading a value SHALL be available only to the daemon itself, when it prepares an agent's environment.

#### Scenario: Listing the secrets

- **WHEN** the registered secrets are listed
- **THEN** each entry gives the name, the environment variable name, the scope and whether a value is held, and no entry carries a value

#### Scenario: No surface returns a value

- **WHEN** any client, channel or agent asks about the workspace's secrets
- **THEN** it receives names and never a value

### Requirement: A role can be given registered secrets

A role's list of secrets SHALL be settable by name, and the conductor SHALL be able to set it. Setting the list SHALL be refused, in full, when any of the named secrets is not registered, so a role cannot be left listing a secret that does not exist.

Setting the list SHALL replace it, and SHALL take effect for workers spawned after it, not for a worker already running.

#### Scenario: Attaching a secret to a role

- **WHEN** the conductor sets a role's secrets to a registered name
- **THEN** the role lists that secret

#### Scenario: A name that is not registered

- **WHEN** the conductor sets a role's secrets to a list containing an unregistered name
- **THEN** the change is refused in full and the role's list is unchanged

#### Scenario: Replacing the list

- **WHEN** the conductor sets a role's secrets to a list that omits a name the role listed
- **THEN** the role no longer lists that name

### Requirement: A worker receives its role's secrets, redacted from what it says

When a worker's turn is prepared, every secret its role lists SHALL be put into the worker's environment under that secret's environment variable name, taking the value from the daemon's own environment when it carries that variable and from the workspace's store otherwise. A secret the role lists for which no value can be found SHALL be omitted rather than passed as empty.

Every value passed to a worker SHALL be redacted from everything that turn records — its transcript, its events and its logs — wherever the value appears.

A worker whose role lists no secrets SHALL receive exactly the environment it receives today.

#### Scenario: The value comes from the store

- **WHEN** a worker's role lists a secret whose value is only in the workspace store
- **THEN** the worker's environment carries it under its environment variable name

#### Scenario: The daemon's own environment wins

- **WHEN** the daemon's environment already carries the secret's environment variable
- **THEN** that value is the one the worker receives

#### Scenario: No value anywhere

- **WHEN** a worker's role lists a secret for which no value is held and the daemon's environment has none
- **THEN** the variable is absent from the worker's environment

#### Scenario: The value is redacted from the transcript

- **WHEN** a worker's turn records output containing the value of a secret it was given
- **THEN** the recorded output has the value replaced rather than stored
