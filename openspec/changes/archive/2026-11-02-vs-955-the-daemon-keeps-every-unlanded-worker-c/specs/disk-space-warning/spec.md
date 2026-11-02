## Purpose

Warn captain before the filesystem holding a workspace fills up, naming what the daemon itself is keeping on it, so a full disk is an alert with something to act on instead of a crash nobody saw coming.

## ADDED Requirements

### Requirement: The daemon checks free space on the filesystems holding its workspaces

At least every 15 minutes while it is serving, on a timer of its own independent of any workspace supervisor, the daemon SHALL read the free and total space of the filesystem holding each loaded workspace root. Workspaces on the same filesystem SHALL be checked once for that filesystem. A failed read SHALL be logged and SHALL NOT stop the daemon or any other check.

The thresholds SHALL be daemon configuration: a free percentage (default 10 %) and a free byte count (default 50 GiB). The filesystem is low when free space is below either.

#### Scenario: Two workspaces on one filesystem

- **WHEN** two workspaces' roots are on the same filesystem
- **THEN** that filesystem is read once per check and warned about once

#### Scenario: An unreadable filesystem does not stop the check

- **WHEN** reading one workspace root's filesystem fails
- **THEN** the failure is logged and the other filesystems are still checked

### Requirement: Low free space reaches captain as a warning naming the top consumers

When a filesystem is low, the daemon SHALL warn captain: a line on the primary chat thread of each workspace whose root it holds, and one open daemon incident for that filesystem. The warning SHALL state free space, total space and the threshold that tripped, and SHALL name the top consumers it knows of: the five largest retained worker copies across those workspaces, each with its workspace, worker, ticket and size, and each workspace's retained-copy total. It SHALL point at the storage view, where reclaims are offered.

The warning SHALL be raised once per low episode. A later check that is still low SHALL NOT raise another unless free space has fallen to half of what was free when the episode began. The episode SHALL end only when free space is back above the threshold plus a margin, so a filesystem hovering at the threshold does not warn on every check. The episode state SHALL survive a restart.

The warning SHALL NOT delete or reclaim anything.

#### Scenario: Below the threshold, the warning names the consumers

- **WHEN** a check reads a filesystem with 24 GB free of 1.6 TB, below both thresholds, and the workspace keeps retained copies of 12 GB, 9 GB and 4 GB
- **THEN** captain gets one warning stating 24 GB free of 1.6 TB, the threshold, the three copies by worker, ticket and size, and the workspace's retained-copy total

#### Scenario: A second check in the same episode stays silent

- **WHEN** the next check still reads the filesystem below the threshold and free space has not halved since the warning
- **THEN** no new warning is raised

#### Scenario: Recovery ends the episode

- **WHEN** free space rises above the threshold plus the margin and later falls below the threshold again
- **THEN** a new warning is raised for the new episode

#### Scenario: Above the threshold, nothing is raised

- **WHEN** free space is above both thresholds
- **THEN** no warning is raised

#### Scenario: The check is tested without the host's real free space

- **WHEN** the check runs under test
- **THEN** it reads free space through an injected reader, so the host's real filesystem never decides the outcome
