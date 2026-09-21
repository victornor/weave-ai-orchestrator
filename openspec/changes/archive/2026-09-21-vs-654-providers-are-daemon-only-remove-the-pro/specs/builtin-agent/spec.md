## RENAMED Requirements

- FROM: `### Requirement: A workspace's model providers can be read with their secret state`
- TO: `### Requirement: The daemon's model providers can be read with their secret state`
- FROM: `### Requirement: The provider key comes from the run's own workspace when no role carries it`
- TO: `### Requirement: The provider key comes from the daemon settings when no role carries it`
- FROM: `### Requirement: Provider lookup is scoped to the run's own workspace`
- TO: `### Requirement: Provider lookup uses the daemon's providers`
- FROM: `### Requirement: Compaction and fork resolve the provider key in the session's workspace`
- TO: `### Requirement: Compaction and fork resolve the provider key from the daemon`

## MODIFIED Requirements

### Requirement: Adapter surface for this slice

The `weave` adapter SHALL declare `resumableSessions: true`, `streamingInput: true`, `structuredOutput: true`, `mcp: true`, `usageReporting: 'per_turn'`, `costReporting: false` and `partialOutput: 'full'`. `TurnHandle.send` SHALL be present and SHALL resolve `delivered` while the turn runs and `closed` once the child's result has been seen. The adapter SHALL forward the child's `structured` result. Model ids SHALL be `providerId/modelId` from the daemon's `providers` config. `detect()` SHALL be `available` only when the child entry exists and a daemon provider is configured.

#### Scenario: No provider configured

- **WHEN** the daemon config has no `providers` entry
- **THEN** `detect()` reports `unsupported` with a note

#### Scenario: Send while running and after the result

- **WHEN** a turn is running and `send` is called, then called again after the turn's result
- **THEN** the first call resolves `delivered` and the second resolves `closed`

### Requirement: The daemon's model providers can be read with their secret state

The daemon SHALL expose its configured `weave` providers over `GET /api/daemon/providers`: for each one its id, its profile as configured (base URL, preset, auth, headers, query, discovery, concurrency, timeouts, `compat`, `params`, and the model ids it lists) and whether the secret its `apiKeySecret` names currently holds a value in the daemon secret store. It SHALL also return the built-in preset catalogue the daemon ships — each preset's id, its description and a suggested base URL — so a client can add a provider from one. The response SHALL NOT contain a secret value, and no route SHALL return one. There SHALL be no workspace-scoped provider list route.

#### Scenario: Listing configured providers

- **WHEN** a client requests the daemon's providers
- **THEN** each configured provider appears with its profile fields, the ids of its models, and a boolean saying whether its key is set, and no entry carries a key value

#### Scenario: One provider is unconfigured

- **WHEN** a configured provider names an `apiKeySecret` with no value in the daemon store
- **THEN** its secret state reads as not set and the rest of the profile is still returned

#### Scenario: An empty workspace

- **WHEN** no provider is configured at the daemon level
- **THEN** the list is empty and the preset catalogue is still returned

### Requirement: A provider profile can be created, updated and removed

The daemon SHALL accept `PUT /api/daemon/providers/:id` to create or replace the provider profile named in the path, validating it against the provider schema and refusing an invalid one with the schema's issues, and `DELETE /api/daemon/providers/:id` to remove it. Creating, updating and removing a profile SHALL write `daemon.yaml` and take effect for turns started after it. An id whose path names one provider SHALL NOT be able to create a different one.

#### Scenario: Create and update

- **WHEN** a client puts a valid profile for an id that has none
- **THEN** the provider appears in the daemon list and a later put of the same id replaces its profile

#### Scenario: An invalid profile

- **WHEN** a client puts a profile with an invalid base URL or a malformed compat flag
- **THEN** the write is refused with the schema's issues and the stored profile is unchanged

#### Scenario: Remove

- **WHEN** a client deletes a configured daemon provider
- **THEN** it no longer appears in the list or in a new turn's provider resolution

### Requirement: A provider's key is set and cleared, and never read back

The daemon SHALL accept a provider's API key through its own route, registering it in the daemon secret store under the profile's `apiKeySecret`, and SHALL clear it on request. Setting a key for a provider whose `apiKeySecret` is unset SHALL be refused. The key's value SHALL never appear in any response, log line, event, error or config file; only whether a value is held SHALL be readable.

#### Scenario: Setting and replacing a key

- **WHEN** a client submits a key for a configured daemon provider
- **THEN** the daemon secret store holds it under the profile's `apiKeySecret`, the secret state reads as set, and the response carries no value

#### Scenario: Clearing a key

- **WHEN** a client clears a provider's key
- **THEN** the secret state reads as not set and a test connection reports the missing key

#### Scenario: The key is never in an error

- **WHEN** a key is rejected by validation or a probe fails
- **THEN** the response names the secret and the reason, and nowhere contains the value

### Requirement: The provider key comes from the daemon settings when no role carries it

The `weave` adapter SHALL resolve a provider's API key from the run environment first, so a role that carries the secret still wins and the daemon host's own environment keeps its precedence, and otherwise from the daemon secret store through `RuntimeHost.providerKey(providerId)`. A run with no role SHALL therefore be able to use a key saved in the daemon settings, whatever the run's workspace. When the provider requires a key and neither source holds one, the turn SHALL fail `key_missing` (family `auth`) with a message naming the daemon provider settings and a role secret as the places it can be set.

#### Scenario: A run with no role uses the workspace key

- **WHEN** a run has no role, the provider requires a key, and the daemon secret store holds the value named by the provider's `apiKeySecret`
- **THEN** the turn resolves that key and completes

#### Scenario: A role secret still wins over the store

- **WHEN** the role carries the provider secret's environment variable and the daemon store also holds a value
- **THEN** the value from the run environment reaches the child

#### Scenario: No key anywhere

- **WHEN** neither the run environment nor the daemon store holds the provider key
- **THEN** the turn fails `key_missing` and the message names the daemon provider settings and a role secret

### Requirement: Provider lookup uses the daemon's providers

`RuntimeHost.providers()` and `RuntimeHost.providerKey()` SHALL resolve the daemon's provider profiles and the daemon secret store, and SHALL NOT vary by workspace; the optional workspace id on the adapter and host surface SHALL NOT select a profile or a key. The `weave` adapter SHALL use the daemon's providers both for a turn and for discovery of that runtime's models. A provider id the daemon does not define SHALL fail `provider_not_configured`.

#### Scenario: Two workspaces, one provider id

- **WHEN** two workspaces each hold a provider id the daemon also defines, with different base URLs or keys, and a run belongs to one of them
- **THEN** the run resolves the daemon's profile and the daemon's key, not its workspace's

#### Scenario: Model discovery of a workspace's provider

- **WHEN** the models of the runtime are listed for one workspace
- **THEN** the provider profile and key used are the daemon's

### Requirement: A store-resolved provider key is redacted from the run

The provider key resolved from the daemon secret store SHALL be added to the run's redaction values, so it never appears in a transcript, event or log, exactly as a role-attached secret value is redacted today.

#### Scenario: A transcript that echoes the key

- **WHEN** a turn's output contains the store-resolved provider key
- **THEN** what the turn records carries a redaction marker and not the key

### Requirement: Compaction and fork resolve the provider key from the daemon

`RuntimeAdapter.compactSession` and `forkSession` SHALL take an optional workspace id, the engine SHALL pass the session's workspace, and the weave adapter SHALL resolve the provider profile and key from the daemon settings, not from the session's workspace.

#### Scenario: Two workspaces, one provider id

- **WHEN** two workspaces hold provider `p` with different keys and a session of one is compacted while the daemon defines `p`
- **THEN** the child receives the daemon's key for `p`

### Requirement: A provider's models can be fetched from its endpoint on demand

The daemon SHALL expose an on-demand discovery route at `POST /api/daemon/providers/:id/discover`. It SHALL request the provider's model list from `GET {baseUrl}{modelsPath}` through the same discovery code the `weave` runtime uses — the profile's preset, `compat`, `headers`, `query` and `auth`, and the default agent User-Agent — and SHALL accept, in the body, a `profile` to use in place of the stored one and an optional `apiKey` used only for that call. It SHALL resolve the key from the daemon secret store when the body names none. It SHALL return the discovered model ids, each with its context window when the endpoint reports one, and on failure SHALL return `ok: false` with a one-line reason rather than throw. It SHALL NOT persist a profile or key, and the key SHALL never appear in a response, a log line or an event.

#### Scenario: Discovery lists ids

- **WHEN** a client posts to the discover route for a provider whose endpoint returns a model list
- **THEN** the response carries those ids with `ok: true`

#### Scenario: An endpoint without a models list

- **WHEN** the endpoint answers a non-200 status or a body that is not a model list
- **THEN** the response is `ok: false` with a one-line reason and no ids

#### Scenario: The draft profile is used before saving

- **WHEN** the body carries a profile whose base URL differs from the stored one
- **THEN** the request goes to the body's base URL and the stored profile is unchanged

#### Scenario: A key entered but not yet saved

- **WHEN** the body carries an `apiKey` and the daemon store holds no value
- **THEN** the request uses the body's key, and the response contains no key value

#### Scenario: The stored key is used

- **WHEN** the body carries no `apiKey` and the daemon store holds a value for the profile's `apiKeySecret`
- **THEN** the request carries that value
