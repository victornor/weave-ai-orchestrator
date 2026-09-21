## REMOVED Requirements

### Requirement: The workspace scope offers a Providers section

**Reason**: Providers are daemon-only; a workspace cannot configure, override or disable one, so a workspace Providers section has nothing to show or write.

**Migration**: The daemon scope's Providers section covers the same profiles and keys. A legacy workspace `providers` block stays on disk and is ignored (see `agent-config-scopes`).

### Requirement: A provider can be added from a preset and edited

**Reason**: Provider profiles, their models and their removal are daemon-only now.

**Migration**: Add, edit and remove providers in the daemon scope's Providers section.

### Requirement: The provider key is entered through the secret input and never shown

**Reason**: Provider keys live in the daemon secret store only; a workspace store no longer holds or shadows one.

**Migration**: Enter and clear a provider key in the daemon scope's Providers section.

### Requirement: Test connection shows per-capability results and can apply detected flags

**Reason**: Provider testing is daemon-only.

**Migration**: Test a provider, and apply detected flags, from the daemon scope's Providers section.

## ADDED Requirements

### Requirement: The daemon scope offers a Providers section

The daemon scope SHALL provide the Providers section that lists the daemon's configured `weave` providers and offers adding one from the daemon's preset catalogue, editing and removing one, entering and clearing its key through the masked secret input, and testing it. The list SHALL show each provider's id, base URL, preset and secret state, and SHALL address the daemon provider routes. Adding from a preset SHALL fill a new profile with the preset id, a suggested base URL and a secret name of the form `WEAVE_LLM_<PROVIDER>_KEY`; removing a provider SHALL require a confirmation. The section SHALL state that repository content is sent to whichever endpoint the user configures and that no default provider ships, and no secret value SHALL appear anywhere on it.

#### Scenario: The list

- **WHEN** the daemon Providers section renders with two providers
- **THEN** it shows both with their base URL, preset and whether their key is set, and no key value appears anywhere on the section

#### Scenario: The data-flow notice

- **WHEN** the daemon Providers section renders
- **THEN** it states that repository content goes to the configured endpoint and that no default provider ships

#### Scenario: A stored key is never rendered

- **WHEN** the section renders for a provider whose key is set
- **THEN** the field is empty and masked and the DOM contains no key value

#### Scenario: Test connection applies detected flags

- **WHEN** the user tests a saved daemon provider and the probe returns detected flags that differ from the profile
- **THEN** each check is shown with its ok state and detail, and applying the flags merges them into the profile's `compat` and saves it

### Requirement: The workspace scope offers no Providers section

The workspace settings scope SHALL NOT list a Providers section. An old URL that names one (`/settings?scope=<workspace>&section=providers`) SHALL render the workspace settings home — the scope's first section — rather than an error or a provider list, and SHALL normalize the URL to that section.

#### Scenario: No Providers entry

- **WHEN** a workspace scope is selected
- **THEN** the section row lists no Providers entry

#### Scenario: The old URL

- **WHEN** a browser opens `/settings?scope=<workspace>&section=providers`
- **THEN** the workspace settings home renders, no provider list is shown, and the URL names the home section
