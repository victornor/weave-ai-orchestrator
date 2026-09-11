# runtime-launch/host-clis Specification

## Purpose
Keeps host mise-installed CLIs such as `openspec` resolvable on a coding-CLI
turn whose environment redirects `HOME` or the XDG dirs away from the daemon
host user, without undoing that redirect.

## Requirements

### Requirement: Redirected HOME still uses the daemon host mise roots

When a shipped runtime adapter overlays `HOME`, `XDG_DATA_HOME`, or
`XDG_CONFIG_HOME` onto a workspace runtime config home, the coding-CLI
process environment for that turn SHALL set `MISE_DATA_DIR`,
`MISE_CONFIG_DIR`, and `MISE_CACHE_DIR` to the daemon process's own mise
directories (the directories mise would have used without the overlay).
The overlay values of `HOME` and the XDG variables SHALL be left as the
adapter set them. If the overlay already sets a `MISE_*` variable, that
explicit value SHALL win.

#### Scenario: OpenCode config-home overlay pins host mise

- **WHEN** an OpenCode turn is launched with a workspace runtime `configHome`
- **THEN** the child's `HOME`, `XDG_CONFIG_HOME`, and `XDG_DATA_HOME` are that `configHome`
- **AND** `MISE_DATA_DIR` is the daemon host user's mise data directory
- **AND** `MISE_CONFIG_DIR` is the daemon host user's mise config directory
- **AND** `MISE_CACHE_DIR` is the daemon host user's mise cache directory

#### Scenario: Explicit overlay MISE roots are kept

- **WHEN** an adapter overlay redirects `HOME` and also sets `MISE_DATA_DIR`
- **THEN** the child's `MISE_DATA_DIR` is the overlay value
- **AND** `HOME` remains the overlay value

### Requirement: Adapters that do not redirect HOME are unchanged

A shipped adapter that isolates its CLI through a dedicated config-dir
environment variable and does not overlay `HOME` or the XDG dirs SHALL NOT
have `MISE_DATA_DIR`, `MISE_CONFIG_DIR`, or `MISE_CACHE_DIR` injected by
this change.

#### Scenario: Cursor config-dir overlay does not pin mise

- **WHEN** a Cursor turn is launched with `CURSOR_CONFIG_DIR` set and `HOME` left as the daemon host user
- **THEN** the child's environment does not gain `MISE_DATA_DIR`, `MISE_CONFIG_DIR`, or `MISE_CACHE_DIR` from this change
