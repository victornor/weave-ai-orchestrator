## ADDED Requirements

### Requirement: The provider key comes from the run's own workspace when no role carries it
The `weave` adapter SHALL resolve a provider's API key from the run environment first, so a role that carries the secret still wins and the daemon host's own environment keeps its precedence, and otherwise from the secret store of the run's own workspace through `RuntimeHost.providerKey(providerId, workspaceId)`. A run with no role SHALL therefore be able to use a key saved under Settings > Providers. When the provider requires a key and neither source holds one, the turn SHALL fail `key_missing` (family `auth`) with a message naming Settings > Providers and a role secret as the places it can be set.

#### Scenario: A run with no role uses the workspace key
- **WHEN** a run has no role, the provider requires a key, and the run's workspace secret store holds the value named by the provider's `apiKeySecret`
- **THEN** the turn resolves that key and completes

#### Scenario: A role secret still wins over the store
- **WHEN** the role carries the provider secret's environment variable and the workspace store also holds a value
- **THEN** the value from the run environment reaches the child

#### Scenario: No key anywhere
- **WHEN** neither the run environment nor the run workspace's store holds the provider key
- **THEN** the turn fails `key_missing` and the message names Settings > Providers and a role secret

### Requirement: Provider lookup is scoped to the run's own workspace
`RuntimeHost.providers()` and `RuntimeHost.providerKey()` SHALL accept an optional workspace id. A turn SHALL carry the id of the workspace it belongs to, and the `weave` adapter SHALL resolve both the provider profile and its API key from that workspace — for the turn and for discovery of that runtime's models — so a second workspace that defines the same provider id never uses another workspace's profile or key. A workspace that does not define the provider id SHALL fail `provider_not_configured` rather than fall back to another workspace's definition. A caller with no workspace, such as the daemon's runtime catalog, SHALL keep the current aggregate behaviour.

#### Scenario: Two workspaces, one provider id
- **WHEN** two workspaces each define the same provider id with a different key, and a run belongs to the second
- **THEN** the child receives the second workspace's key

#### Scenario: Model discovery of a workspace's provider
- **WHEN** the models of the runtime are listed for one workspace
- **THEN** the provider profile and key used are that workspace's

### Requirement: A store-resolved provider key is redacted from the run
The provider key resolved from the workspace secret store SHALL be added to the run's redaction values, so it never appears in a transcript, event or log, exactly as a role-attached secret value is redacted today.

#### Scenario: A transcript that echoes the key
- **WHEN** a turn's output contains the store-resolved provider key
- **THEN** what the turn records carries a redaction marker and not the key

## MODIFIED Requirements

### Requirement: The provider key never reaches argv or any environment
The API key — however it was resolved, from the run environment or from the workspace secret store — SHALL travel only in the `init` line on stdin. It SHALL NOT appear in the child's argv or environment, and SHALL NOT be present in the environment of the `bash` tool or in any log line, event or session file.

#### Scenario: Spawn inspection
- **WHEN** the adapter spawns the child for a provider with a key
- **THEN** neither the argv nor the env passed to the spawn contains the key, and a `bash` tool call that prints its environment does not show it
