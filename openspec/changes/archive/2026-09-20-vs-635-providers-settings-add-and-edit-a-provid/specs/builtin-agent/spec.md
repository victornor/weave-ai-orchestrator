## MODIFIED Requirements

### Requirement: Providers can be tested on demand
`POST /providers/:id/test` SHALL run the conformance probes against the named provider using its secret and return a per-capability verdict; it SHALL run only when requested. The request MAY name the `model` to test. A named model SHALL be used even when the profile lists models. When the request names no model and the profile lists no models, the route SHALL refuse with a `validation` error whose message reads `provider <id> has no models; add one on the Providers page or pass a model to test`.

#### Scenario: Test route
- **WHEN** a client posts to the route for a configured provider with a mock endpoint
- **THEN** the response lists each probe with ok/detail

#### Scenario: The request names the model
- **WHEN** a client posts to the route for a configured provider naming a model in the body
- **THEN** the probe runs that model and the response's `model` is the one supplied

#### Scenario: The profile's first model is the fallback
- **WHEN** the request names no model and the profile lists models
- **THEN** the probe runs the profile's first listed model

#### Scenario: No model anywhere
- **WHEN** the request names no model and the profile lists none
- **THEN** the response is a `validation` error reading `provider <id> has no models; add one on the Providers page or pass a model to test`

## ADDED Requirements

### Requirement: A provider's models can be fetched from its endpoint on demand
The daemon SHALL expose an on-demand discovery route at both scopes, `POST /providers/:id/discover`. It SHALL request the provider's model list from `GET {baseUrl}{modelsPath}` through the same discovery code the `weave` runtime uses — the profile's preset, `compat`, `headers`, `query` and `auth`, and the default agent User-Agent — and SHALL accept, in the body, a `profile` to use in place of the stored one and an optional `apiKey` used only for that call. It SHALL resolve the key from the scope's secret store when the body names none. It SHALL return the discovered model ids, each with its context window when the endpoint reports one, and on failure SHALL return `ok: false` with a one-line reason rather than throw. It SHALL NOT persist a profile or key, and the key SHALL never appear in a response, a log line or an event.

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
- **WHEN** the body carries an `apiKey` and the scope's store holds no value
- **THEN** the request uses the body's key, and the response contains no key value

#### Scenario: The stored key is used
- **WHEN** the body carries no `apiKey` and the scope's store holds a value for the profile's `apiKeySecret`
- **THEN** the request carries that value
