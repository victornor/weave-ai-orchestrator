## Purpose

Let anyone start an offline, fully populated, reproducible Weave AI instance and capture marketing screenshots from it automatically.

## ADDED Requirements

### Requirement: Isolated demo daemon
`weave demo` SHALL start a daemon on its own config directory and a loopback port, and SHALL refuse port 7433 and the live config directory.

#### Scenario: Refused targets
- **WHEN** demo mode is asked to use port 7433 or the live config directory
- **THEN** it exits with an error before starting anything

### Requirement: Deterministic seed
The demo dataset SHALL be generated with fixed ids and a fixed clock, so two seeds produce identical data.

#### Scenario: Two seeds
- **WHEN** the seed runs twice into empty databases
- **THEN** the resulting dataset is identical

### Requirement: Fully populated workspace
The seed SHALL cover workspaces, projects and roles; workers running, idle, paused and errored; tickets in every status and kind; decisions of every kind and review state; a weaver conversation with ticket chips and a live trace; plan documents, PR links, transcripts, usage, incidents, scheduled tasks, roadmap, knowledge docs and graph, the merge queue, and connection banner states. All names and content SHALL be clearly fictional.

#### Scenario: Every manifest route
- **WHEN** each manifest route is loaded against the demo daemon
- **THEN** it renders without console or page errors and shows data

### Requirement: No real side effects
Demo mode SHALL NOT start real agents, run git against remotes, call a forge, or use the network. Live views SHALL be driven by scripted progress.

#### Scenario: Offline
- **WHEN** demo mode runs with no network
- **THEN** all views work and live views show moving progress

### Requirement: Automated screenshot capture
`pnpm demo:screenshots` SHALL walk a manifest of routes and states at desktop and phone viewports in light and dark themes and write named PNGs to an output folder; adding a view is a manifest entry.

#### Scenario: One command
- **WHEN** the command runs
- **THEN** one PNG per manifest entry, viewport and theme is written, with stable names
