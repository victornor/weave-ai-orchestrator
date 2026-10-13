# publication-hardening Specification

## Purpose
Security hardening the repository must have before it is published: CI that never runs pull-request code on a persistent self-hosted machine, no known-vulnerable production dependencies without explanation, an operator-setup route that cannot be claimed remotely, and workflows pinned to immutable commits.

## Requirements

### Requirement: Pull-request CI runs on hosted runners only
Every job in every workflow that a pull request can trigger SHALL run on a GitHub-hosted runner, and the CI workflow SHALL keep the check names `lint`, `typecheck`, `test-core` and `test-ui`.

#### Scenario: No self-hosted label
- **WHEN** `.github/workflows/` is searched for `self-hosted`
- **THEN** no workflow triggered by `pull_request` contains it

#### Scenario: Merge gate names unchanged
- **WHEN** CI runs on a pull request
- **THEN** the checks reported are named `lint`, `typecheck`, `test-core` and `test-ui`

### Requirement: Production dependencies have no unexplained critical or high advisories
`pnpm audit --prod` SHALL report no critical or high finding that has a patched version, and any remaining finding SHALL be explained in the delivering pull request. The self-signed TLS mode SHALL NOT depend on `node-forge`.

#### Scenario: Audit
- **WHEN** `pnpm audit --prod` runs on the lockfile
- **THEN** no critical or high finding with a fix remains

#### Scenario: Self-signed certificate still generated
- **WHEN** the daemon starts with `http.tls.mode` `self-signed` and no certificate on disk
- **THEN** a certificate and key covering the configured domains and `127.0.0.1` are written with mode 0600

### Requirement: First-time operator setup is loopback-only
`POST /api/auth/setup` SHALL succeed only for a request whose client address is loopback, using the proxy-aware client address.

#### Scenario: Remote peer refused
- **WHEN** a non-loopback peer posts to `/api/auth/setup` with no operator configured
- **THEN** the daemon answers `forbidden` and creates no operator

#### Scenario: Proxy cannot launder the peer
- **WHEN** a same-host reverse proxy forwards a request from a remote client to `/api/auth/setup`
- **THEN** the request is not treated as loopback

#### Scenario: Quickstart
- **WHEN** a client on 127.0.0.1 posts valid credentials to `/api/auth/setup` on a default daemon
- **THEN** the operator is created

### Requirement: loopbackTrusted applies only to a loopback bind
The daemon SHALL ignore `auth.loopbackTrusted` when `http.listen` is not a loopback address and SHALL log a warning at startup.

#### Scenario: Wildcard bind with the flag
- **WHEN** the daemon starts with `http.listen` `0.0.0.0:<port>`, `loopbackTrusted: true` and no operator
- **THEN** the public listener is not started and a warning is logged

### Requirement: Workflow actions are pinned
Every `uses:` reference to an external action in `.github/workflows/` SHALL be a full commit SHA with the tag in a trailing comment, and `.github/dependabot.yml` SHALL cover `github-actions` and `npm`.

#### Scenario: No tag references
- **WHEN** the workflows are scanned for `uses:` lines
- **THEN** each external action ends in a 40-hex SHA
