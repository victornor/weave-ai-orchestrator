## ADDED Requirements

### Requirement: A project's sidebar entry marks a diverged clone, and quietly marks a behind one

Each project listed in a sidebar group SHALL carry a marker reflecting that project's sync state
(`project-overview/sync-status`), read from data the sidebar already has rather than a check made for
the marker itself. A project that is `in_sync` SHALL show no marker. A project that is `diverged`
SHALL show a marker using the same visual severity the sidebar already uses for a project or ticket
that needs a human. A project that is `behind` SHALL show a marker, distinguishable from the diverged
marker, using materially less visual severity — the same weight already used for an ordinary
in-progress state — so that an entirely routine merge does not read as an alert.

#### Scenario: A project that is in sync

- **WHEN** a sidebar group lists a project whose clone is `in_sync`
- **THEN** that project's entry shows no sync marker

#### Scenario: A project that has diverged

- **WHEN** a sidebar group lists a project whose clone has `diverged`
- **THEN** that project's entry shows a marker with the same severity the sidebar uses elsewhere for
  something that needs a human

#### Scenario: A project that is behind

- **WHEN** a sidebar group lists a project whose clone is `behind`
- **THEN** that project's entry shows a marker distinguishable from the diverged marker and with
  materially less visual severity

#### Scenario: The marker costs no extra request

- **WHEN** the sidebar renders a group's projects
- **THEN** no request beyond the project list already being fetched is made to determine any of their
  sync markers
