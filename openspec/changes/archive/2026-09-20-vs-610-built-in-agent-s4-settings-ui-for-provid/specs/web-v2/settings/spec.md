## ADDED Requirements

### Requirement: The workspace scope offers a Providers section

The workspace scope SHALL provide a Providers section that lists the selected workspace's configured
`weave` providers and offers adding, editing and removing one. The list SHALL show each provider's id,
base URL, preset and secret state, and SHALL reach the daemon's provider routes against the selected
workspace, not the one the app remembers. The section SHALL state that repository content is sent to
whichever endpoint the user configures and that no default provider ships.

#### Scenario: The list

- **WHEN** the Providers section renders for a workspace with two providers
- **THEN** it shows both with their base URL, preset and whether their key is set, and no key value
  appears anywhere on the section

#### Scenario: The data-flow notice

- **WHEN** the Providers section renders
- **THEN** it states that repository content goes to the configured endpoint and that no default
  provider ships

#### Scenario: A non-active workspace scope

- **WHEN** the selected workspace is not the one the app remembers
- **THEN** the list and every write address the selected workspace

### Requirement: A provider can be added from a preset and edited

The section SHALL offer an "add from a preset" flow that lets the user choose a preset from the
daemon's catalogue and fills a new profile from it — a suggested base URL, the preset id and a secret
name of the form `WEAVE_LLM_<PROVIDER>_KEY` — before saving it. Editing a saved provider SHALL expose
its base URL, preset, secret name, auth, headers and query, discovery, concurrency, timeouts and its
`compat`/`params`, and saving SHALL write the profile through the daemon. Removing a provider SHALL
require a confirmation before it is deleted.

#### Scenario: Add from a preset

- **WHEN** the user picks a preset and saves the new provider
- **THEN** a profile is written with that preset and the suggested base URL, and it appears in the
  list

#### Scenario: Edit and save

- **WHEN** the user changes a saved provider's base URL or a compat flag and saves
- **THEN** the change is written to that provider's profile and the list re-reads it

#### Scenario: Remove asks first

- **WHEN** the user removes a provider
- **THEN** a confirmation is required before the profile is deleted

### Requirement: The provider key is entered through the secret input and never shown

The provider's key SHALL be entered through the existing secret input — a masked field that is not
autofilled and that never renders a stored value back — with a separate control to clear it. Setting,
replacing and clearing the key SHALL go through the provider's secret route, and the section SHALL
show only whether a key is set together with the secret's name. The value SHALL NOT appear in the
rendered output or in any test snapshot.

#### Scenario: Entering a key

- **WHEN** the user types a key and saves it
- **THEN** it is written to the workspace secret store and the section shows the key as set and its
  secret name, with no value

#### Scenario: A stored key is never rendered

- **WHEN** the Providers section renders for a provider whose key is set
- **THEN** the field is empty and masked and the DOM contains no key value

#### Scenario: Clearing a key

- **WHEN** the user clears the key
- **THEN** the section shows it as not set

### Requirement: Test connection shows per-capability results and can apply detected flags

A saved provider SHALL offer a Test connection action that calls the provider's probe route and renders
each check it returns with its ok state and detail — the models list, a streamed answer, whether usage
arrives, a tool call, and which spelling of the output cap the endpoint honours. When the probe returns
detected flags that differ from the profile, the section SHALL offer an "apply detected flags" action
that merges them into the profile's `compat` and saves the provider. When the provider's key is not
set, the section SHALL show the missing-key result and shall not claim a capability was verified.

#### Scenario: A passing test

- **WHEN** the probe returns every check ok
- **THEN** each capability is shown with its verdict and detail, and no apply action appears when
  `detected` is empty

#### Scenario: Applying detected flags

- **WHEN** the probe returns `detected` flags that differ from the profile and the user applies them
- **THEN** the detected `compat` is merged into the provider's profile and saved, and the profile
  re-reads with them

#### Scenario: No key

- **WHEN** the provider has no key set and the user tests it
- **THEN** the section shows the missing-key result and no capability reads as verified

### Requirement: The catalog editor renders the weave runtime from the runtime's own metadata

When the worker-model catalog editor has `weave` selected as a runtime, its model picker SHALL be fed
by the runtime's `listModels` — ids of the form `providerId/modelId`, marked detected or static — its
effort picker SHALL come from the chosen model's declared `efforts`, and its parameters section SHALL
be generated from the runtime adapter's `configSchema()` so that it covers `maxOutputTokens`,
`temperature`, `topP`, `frequencyPenalty`, `presencePenalty`, `seed`, `stop`, `toolChoice`,
`parallelToolCalls`, `responseFormat` and `extraBody` without a hand-written field per parameter. A
value the schema rejects SHALL be refused with the schema's message, and an option the schema does not
declare SHALL NOT be saved. The editor SHALL reuse the existing generated-options control rather than
adding a parallel field set.

#### Scenario: The weave model picker

- **WHEN** `weave` is selected as the runtime of a worker option
- **THEN** the model picker lists the runtime's models by `providerId/modelId` and the effort picker
  offers the chosen model's declared efforts

#### Scenario: Parameters come from the schema

- **WHEN** the runtime's `configSchema()` declares the sampling parameters captain named
- **THEN** the editor renders a control for each and none is hand-coded in the editor

#### Scenario: Out-of-range is refused

- **WHEN** a parameter is set outside the range its schema declares
- **THEN** the save is refused with the schema's message and the setting is unchanged
