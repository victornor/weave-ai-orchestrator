## MODIFIED Requirements

### Requirement: A project's sidebar entry marks a diverged clone, and quietly marks a behind one

Each project listed in a sidebar group SHALL carry a marker reflecting that project's sync state
(`project-overview/sync-status`), read from data the sidebar already has rather than a check made
for the marker itself. A project that is `in_sync` SHALL show no sync marker. A project that is
`diverged` SHALL show a marker using the same visual severity the sidebar already uses for a
project or ticket that needs a human. A project that is `behind` SHALL show a marker,
distinguishable from the diverged marker, using materially less visual severity — the same weight
already used for an ordinary in-progress state — so that an entirely routine merge does not read as
an alert.

Independently of its sync state, each project's entry SHALL show that project's slug in that
project's own colour (`workspace-navigation/project-colour`). It SHALL NOT show a separate
project-colour circle. The sync marker, when present, SHALL remain a status marker alongside the
coloured slug, never replaced by it. Both SHALL be visible at once when the project is not
`in_sync`.

#### Scenario: A project that is in sync

- **WHEN** a sidebar group lists a project whose clone is `in_sync`
- **THEN** that project's entry shows no sync marker, and shows that project's slug in that
  project's own colour, with no project-colour circle

#### Scenario: A project that has diverged

- **WHEN** a sidebar group lists a project whose clone has `diverged`
- **THEN** that project's entry shows a marker with the same severity the sidebar uses elsewhere for
  something that needs a human, and shows that project's slug in that project's own colour, with no
  project-colour circle

#### Scenario: A project that is behind

- **WHEN** a sidebar group lists a project whose clone is `behind`
- **THEN** that project's entry shows a marker distinguishable from the diverged marker and with
  materially less visual severity, and shows that project's slug in that project's own colour, with
  no project-colour circle

#### Scenario: The marker costs no extra request

- **WHEN** the sidebar renders a group's projects
- **THEN** no request beyond the project list already being fetched is made to determine any of
  their sync markers or their colours

#### Scenario: Two projects in the same group are told apart by colour

- **WHEN** a sidebar group lists two or more projects
- **THEN** each is shown with its slug in its own project's colour, distinguishable from the other
  projects listed in that group
