# daemon-isolation/credential-scope Specification

## Purpose
Defines when a daemon does not resolve a coding-CLI runtime's credential to the host's real,
owner-shared credential file, so that a daemon started for local testing can never read, write or
rotate the one login every other agent on the host depends on.

## Requirements

### Requirement: A daemon started from a non-default config directory is isolated by default

A daemon SHALL be **isolated** when the config directory it starts from is not the plain default
config directory (the one resolved with no `--config-dir` flag and no `AC_CONFIG_HOME`/
`XDG_CONFIG_HOME` override), unless the explicit sharing opt-in of this capability is given.

This determination SHALL require no additional flag beyond what starting a throwaway daemon already
uses: a daemon started with `--config-dir <anything other than the default>` SHALL be isolated with
no further action from the operator.

#### Scenario: A daemon with a custom config directory is isolated

- **WHEN** a daemon starts with `--config-dir` pointing at a directory other than the default
- **THEN** that daemon is isolated

#### Scenario: A daemon with the default config directory is not isolated

- **WHEN** a daemon starts with no `--config-dir` and no `AC_CONFIG_HOME`/`XDG_CONFIG_HOME` override
- **THEN** that daemon is not isolated, and its behavior is unchanged by this capability

### Requirement: An isolated daemon does not resolve a runtime credential to the host's file

For every coding-CLI runtime, an isolated daemon SHALL give that runtime a credential home confined
to its own config directory, and SHALL NOT create a symlink, copy, or any other reference from that
home to the host's real credential file (the one the machine owner's own CLI reads and writes).

A runtime with no credential of its own inside an isolated daemon's config directory SHALL report
that runtime as needing a login, exactly as a runtime with no host credential does today — it SHALL
NOT be silently backed by the host's credential.

#### Scenario: An isolated daemon's runtime has its own credential home

- **WHEN** an isolated daemon resolves a runtime's credential path
- **THEN** the path resolved is confined to that daemon's own config directory, not the host's
  credential file

#### Scenario: An isolated daemon never links to the host credential

- **WHEN** an isolated daemon sets up a runtime's credential home
- **THEN** no symlink or copy is created from that home to the host's real credential file

#### Scenario: A runtime with no isolated credential needs a login

- **WHEN** an isolated daemon has no credential of its own for a runtime
- **THEN** that runtime is reported as needing a login, not as sharing the host's credential

### Requirement: Sharing the host credential from an isolated daemon requires an explicit opt-in

An isolated daemon MAY be told to share a runtime's host credential anyway, but only through an
explicit opt-in given at startup (a flag or environment variable dedicated to this purpose). Without
that opt-in, isolation SHALL apply to every runtime.

The opt-in SHALL NOT be implied by any other flag, including `--config-dir` itself: choosing a custom
config directory alone SHALL NOT share the host credential.

#### Scenario: The opt-in restores sharing

- **WHEN** an isolated daemon starts with the explicit credential-sharing opt-in given
- **THEN** its runtimes resolve their credentials to the host's file exactly as a non-isolated daemon's do

#### Scenario: No opt-in means no sharing

- **WHEN** an isolated daemon starts without the opt-in
- **THEN** none of its runtimes share the host's credential, regardless of any other flag given
