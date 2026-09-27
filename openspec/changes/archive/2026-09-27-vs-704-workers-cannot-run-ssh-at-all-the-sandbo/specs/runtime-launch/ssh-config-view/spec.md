## Purpose

Makes the system `ssh` client usable inside a worker command sandbox whose user namespace shows root-owned `/etc/ssh` files as an unmapped uid, without editing the host or widening what a turn may run.

## ADDED Requirements

### Requirement: A Linux turn's ssh does not read an unmapped system config

On Linux, a turn the daemon spawns SHALL resolve a bare `ssh` to a view the daemon installed for that turn, ahead of the system `ssh`. That view SHALL exec the real `ssh` binary against a config file owned by the turn's uid, so OpenSSH does not stat the host's `/etc/ssh` system config. Inside a user namespace that shows the host's `/etc/ssh` files as the overflow uid, `ssh -G localhost` SHALL exit 0.

The turn process itself SHALL NOT be placed in a user namespace by this view. Supplementary groups the turn had without the view SHALL be unchanged.

#### Scenario: ssh -G exits 0 where the host config looks unmapped

- **WHEN** a Linux turn runs `ssh -G localhost` inside a user namespace that shows `/etc/ssh/ssh_config` and its drop-ins as the overflow uid
- **THEN** the command exits 0 and does not report `Bad owner or permissions`

#### Scenario: The turn is not entered into a user namespace

- **WHEN** a Linux turn is spawned with this view installed
- **THEN** the turn process's uid map is the host's, and its supplementary groups are the groups it would have had without the view

### Requirement: The view keeps system client settings and user precedence

The config the view passes SHALL include the host's client system config (`/etc/ssh/ssh_config` and the drop-ins it includes), with symbolic links replaced by the regular file they point at, so a drop-in that links outside `/etc/ssh` is still applied and is owned by the turn's uid. Settings from the child's own `~/.ssh/config`, when that file exists and is readable, SHALL take the same precedence they have for an unwrapped `ssh` (they win over the system file). The view SHALL NOT read a home directory other than the one the child will use.

A caller that already passes `-F` SHALL have that file used and SHALL NOT have a second `-F` added.

#### Scenario: A drop-in behind a symlink is still applied

- **WHEN** the host system config includes a drop-in that is a symlink to a file outside `/etc/ssh`, and a turn runs `ssh -G localhost` through the view
- **THEN** the dumped config contains the settings from that drop-in's target

#### Scenario: The child's user config wins

- **WHEN** the child's `~/.ssh/config` sets `User` for `localhost` and the system config does not, and the turn runs `ssh -G localhost` through the view
- **THEN** the dumped `user` is the one from the child's config

#### Scenario: An explicit -F is left alone

- **WHEN** a turn runs `ssh -F /some/file -G localhost`
- **THEN** the real `ssh` is invoked with that `-F` and no additional `-F`

### Requirement: The view does not change the host or the turn's permissions

Installing the view SHALL NOT modify `/etc` on the host, SHALL NOT ship a host-specific config file in the repository, and SHALL NOT change the turn's permission mode or which commands the role may run. An unreadable file under `/etc/ssh` (a host private key) SHALL be skipped, not copied. If the system client config cannot be read, or `ssh` is not on the daemon's PATH, the turn SHALL still start and the view SHALL NOT be installed.

On a non-Linux host the daemon SHALL NOT install the view, and `ssh` resolution SHALL be unchanged.

#### Scenario: The host /etc is untouched

- **WHEN** a Linux turn is spawned with the view
- **THEN** no path under the host's `/etc` has been created, modified, or replaced by that spawn

#### Scenario: A missing system config does not block the turn

- **WHEN** the daemon prepares a Linux turn and cannot read `/etc/ssh/ssh_config`
- **THEN** the turn still starts and `ssh` is not redirected at a view
