## ADDED Requirements

### Requirement: Provider requests carry a default User-Agent
Every provider request the agent makes — chat completions, model discovery (`GET {baseUrl}{modelsPath}`) and the conformance probes — SHALL send `User-Agent: weave-agent/<version>`, where `<version>` is the agent package's own version read at runtime, not a literal. A `headers` entry on the provider profile whose name is `user-agent` in any case SHALL replace the default, and exactly one User-Agent header SHALL be sent in every case. The header SHALL be treated as non-secret and recorded in the redacted `debugWire` capture.

#### Scenario: Chat request
- **WHEN** a turn sends a chat-completions request to a mock provider
- **THEN** the recorded request carries `user-agent: weave-agent/<version>`, matching the agent package's version

#### Scenario: Model discovery and probe
- **WHEN** a provider's models are discovered and when the conformance probe sends its models-list request
- **THEN** each recorded request carries the same default User-Agent

#### Scenario: Profile override
- **WHEN** the provider profile's `headers` sets `User-Agent: custom/1`
- **THEN** the request carries exactly one User-Agent header and its value is `custom/1`

### Requirement: An error body is reduced to one line, and an HTML body is not retried
`classifyHttp` SHALL reduce an error body to one line: when the body is HTML, the status, the page `<title>` when present, a note that the endpoint returned an HTML page (likely a bot challenge or a gateway error) and a hint to set a User-Agent header on the provider; otherwise, when the body is longer than a few hundred characters, the first 200 characters. The full body SHALL remain available only in the `debugWire` capture, redacted as today. A failure whose body is HTML SHALL be classified family `tooling` and SHALL NOT be retried.

#### Scenario: Challenge page
- **WHEN** a provider answers a Cloudflare challenge fixture with a retryable status and an HTML body carrying `<title>Just a moment...</title>`
- **THEN** the classified error is one line naming the status, the title and the User-Agent hint, its family is `tooling`, and it is not retryable

#### Scenario: Full body only in the wire capture
- **WHEN** a turn with `debugWire` set receives that HTML body
- **THEN** the wire file contains the full body and the turn's error message does not

#### Scenario: Long plain-text body
- **WHEN** a provider answers an error whose body is plain text longer than a few hundred characters
- **THEN** the message is the first 200 characters and no raw body is printed