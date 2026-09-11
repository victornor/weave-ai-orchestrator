## MODIFIED Requirements

### Requirement: A daemon started from a non-default config directory is isolated by default

A daemon SHALL be **isolated** when the config directory it starts from is not a plain default config
directory (one resolved with no `--config-dir` flag and no `AC_CONFIG_HOME`/`XDG_CONFIG_HOME`
override, under either name this product is known by), unless the explicit sharing opt-in of this
capability is given.

This determination SHALL require no additional flag beyond what starting a throwaway daemon already
uses: a daemon started with `--config-dir <anything other than either plain default>` SHALL be
isolated with no further action from the operator. This comparison SHALL recognize a plain default
under either name independently of how the path-compatibility resolver would resolve an ambiguous
installation — a host with both names present on disk SHALL NOT cause this comparison itself to fail.

#### Scenario: A daemon with a custom config directory is isolated

- **WHEN** a daemon starts with `--config-dir` pointing at a directory other than either plain default
- **THEN** that daemon is isolated

#### Scenario: A daemon with the default config directory is not isolated

- **WHEN** a daemon starts with no `--config-dir` and no `AC_CONFIG_HOME`/`XDG_CONFIG_HOME` override
- **THEN** that daemon is not isolated, and its behavior is unchanged by this capability

#### Scenario: A daemon with the new name's plain default config directory is not isolated

- **WHEN** a daemon starts with `--config-dir` pointing at exactly the new name's plain default
  config directory
- **THEN** that daemon is not isolated, the same as if it had been started with the old name's plain
  default

#### Scenario: An ambiguous host installation does not break the isolation check

- **WHEN** a host has both the old-named and the new-named plain default config directory present on
  disk, and a daemon is started against some other, unrelated config directory
- **THEN** the isolation comparison still succeeds for that daemon, independent of the ambiguity
  between the two plain defaults
