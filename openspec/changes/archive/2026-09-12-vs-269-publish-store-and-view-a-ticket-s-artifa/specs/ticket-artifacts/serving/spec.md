## Purpose
Lets a human view a published artifact's rendered HTML safely from the web app, in an origin that
cannot read the human's session or reach the API, regardless of what the artifact's own HTML attempts.

## ADDED Requirements

### Requirement: A stored artifact is served verbatim behind a sandboxing CSP
A ticket-scoped route SHALL serve a stored artifact's exact stored bytes as `text/html`, with a
Content-Security-Policy that places the response in a sandboxed, opaque origin denying same-origin
access, cookie access, and outbound network requests, and with `X-Content-Type-Options: nosniff`.

#### Scenario: Fetching a published artifact's raw HTML
- **WHEN** a human's authenticated web session requests a published artifact's raw URL
- **THEN** the response body is byte-identical to the stored document, the response's Content-Type is
  `text/html; charset=utf-8`, its Content-Security-Policy places the document in a sandboxed opaque
  origin with `default-src 'none'` and `connect-src 'none'`, and it carries
  `X-Content-Type-Options: nosniff`.

#### Scenario: An artifact that attempts to read the session cookie or call the API
- **WHEN** a served artifact's own script executes and attempts to read `document.cookie` or issue a
  network request
- **THEN** the sandboxed opaque origin prevents cookie access and the CSP's `connect-src 'none'` blocks
  the request, regardless of what the artifact's script contains.

### Requirement: Serving an artifact is restricted to a human web session
The raw artifact route SHALL be reachable only by an authenticated human web session, never by an
agent run's own credentials.

#### Scenario: An agent's run credentials against the raw route
- **WHEN** a request to the raw artifact route carries an agent run's own bearer credential instead of
  a human web session's
- **THEN** the request is rejected before the artifact body is read or returned.

### Requirement: A specific revision is independently viewable
The raw artifact route SHALL accept an explicit revision selector and serve that revision's exact
stored bytes, distinct from the current revision.

#### Scenario: Requesting a superseded revision
- **WHEN** an artifact has been published more than once under the same key and a request names an
  earlier revision number
- **THEN** the response body is that earlier revision's exact stored bytes, not the current one.
