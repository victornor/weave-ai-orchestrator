# weaver-artifacts/serving Specification

## Purpose
Lets a human view a published workspace-scoped artifact's rendered HTML safely from the web app, with
the same sandboxing guarantee already enforced for ticket artifacts, extended to a route that carries
no ticket id.

## Requirements

### Requirement: A stored workspace-scoped artifact is served verbatim behind a sandboxing CSP
A workspace-scoped route SHALL serve a stored artifact's exact stored bytes as `text/html`, with the
same Content-Security-Policy already used for ticket artifacts: a sandboxed, opaque origin denying
same-origin access, cookie access, and outbound network requests, plus `X-Content-Type-Options:
nosniff`.

#### Scenario: Fetching a published workspace-scoped artifact's raw HTML
- **WHEN** a human's authenticated web session requests a published workspace-scoped artifact's raw
  URL
- **THEN** the response body is byte-identical to the stored document, the response's Content-Type is
  `text/html; charset=utf-8`, its Content-Security-Policy places the document in a sandboxed opaque
  origin with `default-src 'none'` and `connect-src 'none'`, and it carries
  `X-Content-Type-Options: nosniff`

#### Scenario: An artifact that attempts to read the session cookie or call the API
- **WHEN** a served workspace-scoped artifact's own script executes and attempts to read
  `document.cookie` or issue a network request
- **THEN** the sandboxed opaque origin prevents cookie access and the CSP's `connect-src 'none'`
  blocks the request, regardless of what the artifact's script contains

### Requirement: Serving a workspace-scoped artifact is restricted to a human web session
The raw workspace-scoped artifact route SHALL be reachable only by an authenticated human web
session, never by an agent run's own credentials — the same restriction already enforced on the
ticket-scoped raw route.

#### Scenario: An agent's run credentials against the raw route
- **WHEN** a request to the workspace-scoped raw artifact route carries an agent run's own bearer
  credential instead of a human web session's
- **THEN** the request is rejected before the artifact body is read or returned

### Requirement: A specific revision is independently viewable
The workspace-scoped raw artifact route SHALL accept an explicit revision selector and serve that
revision's exact stored bytes, distinct from the current revision.

#### Scenario: Requesting a superseded revision
- **WHEN** a workspace-scoped artifact has been published more than once under the same key and a
  request names an earlier revision number
- **THEN** the response body is that earlier revision's exact stored bytes, not the current one

### Requirement: No agent can read a workspace-scoped artifact's body back
No agent-facing tool SHALL return a workspace-scoped artifact's stored HTML body to any agent,
including the one that published it — the same closure already enforced for ticket artifacts.

#### Scenario: A weaver tries to read back what it just published
- **WHEN** a weaver that just published a workspace-scoped artifact attempts to read that artifact's
  body back through any tool
- **THEN** no tool returns the HTML body; at most a tool may confirm the artifact's key, title, and
  revision exist
