## ADDED Requirements

### Requirement: A workspace's model providers can be read with their secret state

The daemon SHALL expose this workspace's configured `weave` providers over `GET /providers`: for each
one its id, its profile as configured (base URL, preset, auth, headers, query, discovery, concurrency,
timeouts, `compat`, `params`, and the model ids it lists) and whether the secret its `apiKeySecret`
names currently holds a value. It SHALL also return the built-in preset catalogue the daemon ships —
each preset's id, its description and a suggested base URL — so a client can add a provider from one.
The response SHALL NOT contain a secret value, and no route SHALL return one.

#### Scenario: Listing configured providers

- **WHEN** a client requests the workspace's providers
- **THEN** each configured provider appears with its profile fields, the ids of its models, and a
  boolean saying whether its key is set, and no entry carries a key value

#### Scenario: One provider is unconfigured

- **WHEN** a configured provider names an `apiKeySecret` with no value in the workspace
- **THEN** its secret state reads as not set and the rest of the profile is still returned

#### Scenario: An empty workspace

- **WHEN** the workspace config has no `providers`
- **THEN** the list is empty and the preset catalogue is still returned

### Requirement: A provider profile can be created, updated and removed

The daemon SHALL accept `PUT /providers/:id` to create or replace the provider profile named in the
path, validating it against the provider schema and refusing an invalid one with the schema's issues,
and `DELETE /providers/:id` to remove it. Creating, updating and removing a profile SHALL write the
workspace config and take effect for turns started after it. An id whose path names one provider
SHALL NOT be able to create a different one.

#### Scenario: Create and update

- **WHEN** a client puts a valid profile for an id that has none
- **THEN** the provider appears in the list and a later put of the same id replaces its profile

#### Scenario: An invalid profile

- **WHEN** a client puts a profile with an invalid base URL or a malformed compat flag
- **THEN** the write is refused with the schema's issues and the stored profile is unchanged

#### Scenario: Remove

- **WHEN** a client deletes a configured provider
- **THEN** it no longer appears in the list or in a new turn's provider resolution

### Requirement: A provider's key is set and cleared, and never read back

The daemon SHALL accept a provider's API key through its own route, registering it in the workspace
secret store under the profile's `apiKeySecret`, and SHALL clear it on request. Setting a key for a
provider whose `apiKeySecret` is unset SHALL be refused. The key's value SHALL never appear in any
response, log line, event, error or config file; only whether a value is held SHALL be readable.

#### Scenario: Setting and replacing a key

- **WHEN** a client submits a key for a configured provider
- **THEN** the workspace's secret store holds it under the profile's `apiKeySecret`, the secret state
  reads as set, and the response carries no value

#### Scenario: Clearing a key

- **WHEN** a client clears a provider's key
- **THEN** the secret state reads as not set and a test connection reports the missing key

#### Scenario: The key is never in an error

- **WHEN** a key is rejected by validation or a probe fails
- **THEN** the response names the secret and the reason, and nowhere contains the value
