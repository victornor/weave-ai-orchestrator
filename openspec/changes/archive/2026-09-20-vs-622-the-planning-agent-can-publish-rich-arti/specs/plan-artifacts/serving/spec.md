## Purpose

Lets a human view a plan-scoped artifact's rendered HTML safely from the plan's tab in the web app,
in an origin that cannot read the human's session or reach the API, using the same sandboxing the
ticket- and workspace-scoped artifact routes already enforce.

## ADDED Requirements

### Requirement: A stored plan artifact is served verbatim behind the existing sandboxing CSP

A plan-scoped route SHALL serve a stored artifact's exact bytes as `text/html`, with the same
Content-Security-Policy the ticket- and workspace-scoped artifact routes use — a sandboxed, opaque
origin denying same-origin access, cookie access and outbound network requests — and with
`X-Content-Type-Options: nosniff`.

#### Scenario: Fetching a plan artifact's raw HTML

- **WHEN** a human's authenticated web session requests a published plan artifact's raw URL
- **THEN** the response body is byte-identical to the stored document, the response's Content-Type is
  `text/html; charset=utf-8`, its Content-Security-Policy is the shared sandboxing policy used by the
  other artifact routes, and it carries `X-Content-Type-Options: nosniff`

#### Scenario: A plan artifact that attempts to read the session cookie or call the API

- **WHEN** a served plan artifact's own script executes and attempts to read `document.cookie` or
  issue a network request
- **THEN** the sandboxed opaque origin prevents cookie access and the policy's network denial blocks
  the request, regardless of what the artifact's script contains

### Requirement: Serving a plan artifact is restricted to a human web session

The raw plan artifact route SHALL be reachable only by an authenticated human web session, never by
an agent run's own credentials.

#### Scenario: An agent's run credentials against the raw route

- **WHEN** a request to the raw plan artifact route carries an agent run's own bearer credential
  instead of a human web session's
- **THEN** the request is rejected before the artifact body is read or returned

### Requirement: A specific revision is independently viewable

The raw plan artifact route SHALL accept an explicit revision selector and serve that revision's
exact stored bytes, distinct from the current revision.

#### Scenario: Requesting a superseded revision

- **WHEN** a plan artifact has been published more than once under the same key and a request names
  an earlier revision number
- **THEN** the response body is that earlier revision's exact stored bytes, not the current one

### Requirement: A plan artifact route never serves across a plan or workspace boundary

A raw plan artifact request SHALL resolve the artifact through the named plan in the request's own
workspace, so an artifact stored under one plan, or in another workspace, can never be served under a
different plan's identifier.

#### Scenario: A key that exists only under another plan

- **WHEN** a request asks for a key under plan A, but that key's artifact is stored only under plan B
- **THEN** the request fails as not found and no body is returned
