## ADDED Requirements

### Requirement: The model picker names an empty built-in-agent catalog

When a worker option's chosen runtime is the built-in `weave` agent and that runtime reports no models at all, the model picker SHALL say that no models are configured and SHALL link to the Providers settings, rather than presenting the empty catalog without explanation. The secondary free-text entry SHALL remain available. When the runtime reports at least one model the picker SHALL list them as it does today.

#### Scenario: A built-in-agent provider with no models
- **WHEN** the operator opens a worker option on runtime `weave` and no provider lists any model
- **THEN** the model control states that no models are configured and offers a link to the Providers page, and a free-text id can still be entered

#### Scenario: Configured models are still offered
- **WHEN** a daemon provider lists models and the operator opens a worker option on runtime `weave`
- **THEN** those `<provider>/<model>` ids are offered in the picker
