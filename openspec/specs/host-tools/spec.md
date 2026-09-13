# host-tools Specification

## Purpose
Defines how the daemon finds host tools such as git, gh and openspec from the daemon user's own
login-shell environment rather than a fixed PATH, so a bare service-manager PATH cannot disarm
planning and delivery, and makes an unavailable tool name the PATH that was searched.

## Requirements

### Requirement: The daemon resolves host tools from the user's own environment at startup

Before it loads any workspace and before it spawns any host tool, the daemon SHALL extend its own
process `PATH` with the daemon user's login-shell `PATH`, discovered by running that user's shell as
a login and interactive shell and reading the `PATH` it reports. The shell SHALL be selected by
falling back from `$SHELL` to the account's shell (`os.userInfo().shell`) to `/bin/sh`, because
`$SHELL` is not guaranteed to be set under a service manager. The daemon SHALL NOT resolve tools
from a fixed list of one distribution's or one tool manager's directories; the user's shell
environment is the general source, so whatever tool manager the user configured is covered without
the daemon knowing it. Directories configured in `hostToolPaths` SHALL come first, the login-shell
entries next, and the process's existing entries last, each directory added at most once. Only
absolute directories SHALL enter the daemon's `PATH`: a relative entry from any source SHALL be
dropped and reported, because a repository can ship a relative `node_modules/.bin` and every worker
CLI the daemon spawns runs with its working directory inside a clone. The
discovery SHALL be bounded by a timeout, SHALL read stdout only, and SHALL leave the daemon running
unchanged when the shell fails, times out or reports nothing. A host tool reachable only through
this extension SHALL be found and executed as if it had been on the original `PATH`.

An explicit binary override SHALL still win over discovery: `AC_OPENSPEC_BIN` names the openspec
binary, and a tool already present earlier in the assembled `PATH` SHALL resolve to that earlier
path.

#### Scenario: A bare PATH still finds a tool the user's shell knows

- **WHEN** the daemon starts with `PATH=/usr/bin:/bin` and the daemon user's login shell reports a `PATH` containing a directory that holds an executable `openspec`
- **THEN** after startup the daemon's `PATH` includes that directory
- **AND** detecting the openspec host tool reports it available with the resolved path

#### Scenario: The account shell is used when `$SHELL` is unset

- **WHEN** the daemon starts under a service manager with `$SHELL` unset
- **THEN** the daemon queries the account's shell, falling back to `/bin/sh` if that is unavailable, rather than skipping discovery

#### Scenario: Discovery does not depend on any one tool manager or distribution

- **WHEN** the user's shell reports a `PATH` built by a tool manager the daemon does not know
- **THEN** the daemon uses the directories from that reported `PATH`, without any manager-specific path being compiled into it

#### Scenario: A failed or silent shell query changes nothing

- **WHEN** the login-shell query times out, exits non-zero, or reports no `PATH`
- **THEN** the daemon's `PATH` is left as it was and the daemon still starts

#### Scenario: Relative entries never enter the daemon's PATH

- **WHEN** the login shell, the inherited `PATH`, or `hostToolPaths` contains a relative entry such as `.` or `node_modules/.bin`
- **THEN** that entry is dropped and the daemon's `PATH` holds only absolute directories

#### Scenario: An already-resolvable tool keeps its PATH location

- **WHEN** a host tool is already present in a directory earlier in the assembled `PATH`
- **THEN** the daemon resolves it to that same earlier path

#### Scenario: A configured directory is searched before discovery

- **WHEN** `hostToolPaths` names a directory that contains a host tool
- **THEN** that directory precedes the login-shell entries in the daemon's `PATH`

#### Scenario: The override wins over discovery

- **WHEN** `AC_OPENSPEC_BIN` names a binary and an `openspec` also exists in a discovered directory
- **THEN** the daemon uses the override binary

### Requirement: A host tool that cannot be found names the daemon's PATH

When a host tool invoked by bare name cannot be executed, the error SHALL state that the tool was
not found on the daemon's `PATH` and SHALL include the `PATH` that was searched, or the directories
searched. It SHALL NOT say the tool is not installed. A tool that is found but exits non-zero SHALL
be reported as a failure of that tool, distinctly from the not-found condition.

#### Scenario: The not-found message carries the daemon's PATH

- **WHEN** a host tool cannot be resolved on the daemon's `PATH`
- **THEN** the error message names the daemon's `PATH` and does not say the tool is not installed

#### Scenario: A present tool that fails is not reported as missing

- **WHEN** a host tool is found and exits non-zero
- **THEN** the error reports the tool's failure and not the not-found condition

### Requirement: An unavailable host tool raises a daemon notice and a weaver warning

The daemon SHALL probe its required and recommended host tools at startup and periodically, without
waiting for a request to `/api/health`. While a required or recommended tool is unavailable, the
daemon SHALL show a daemon-wide notice in the web app and SHALL include a warning line naming the
tool and the daemon's `PATH` in the briefing snapshot's `warnings`. The notice and warning SHALL
clear once the tool is available again, and a tool the daemon does not need SHALL NOT produce one.

#### Scenario: An unavailable recommended tool is visible without a health probe

- **WHEN** the daemon starts and a recommended host tool such as `gh` is not available
- **THEN** the briefing snapshot's `warnings` names that tool and the daemon's `PATH`
- **AND** the daemon-wide notice is shown in the web app

#### Scenario: Recovery clears the warning

- **WHEN** the unavailable tool later becomes available
- **THEN** the briefing warning and the daemon-wide notice clear

### Requirement: Host tool directories are a daemon setting

The daemon configuration SHALL accept `hostToolPaths`, a list of directories applied to host tool
resolution ahead of the login-shell `PATH` as an escape hatch for an unusual layout. The daemon
settings SHALL offer a **Host tools** section, in the daemon area, that shows the detected host
tools and lets the operator edit `hostToolPaths`; saving SHALL persist to `daemon.yaml` and take
effect without a restart. Saving SHALL reject a non-absolute directory with a validation error, and
the section SHALL show that error.

#### Scenario: Adding a directory takes effect without a restart

- **WHEN** the operator adds a directory holding an otherwise-undiscovered tool in the Host tools section and saves
- **THEN** `daemon.yaml` records the directory and the tool is detected as available without restarting the daemon

#### Scenario: A relative directory is refused

- **WHEN** the operator saves a relative directory such as `bin`, or a request sends one
- **THEN** the save is rejected with a validation error and nothing is persisted
- **AND** the Host tools section shows that error

#### Scenario: The section reports each tool's availability

- **WHEN** the Host tools section is shown
- **THEN** it lists the git, gh, openspec and wt tools with whether each is available and its resolved path when it is
