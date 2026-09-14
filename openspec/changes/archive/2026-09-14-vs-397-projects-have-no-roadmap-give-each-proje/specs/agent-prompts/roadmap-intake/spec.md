## Purpose

Teaches the weaver the difference between an idea and a piece of work: "remember this for later" is
a roadmap item, "let's start X" is a ticket linked to the item it came from.

## ADDED Requirements

### Requirement: The weaver parks ideas on the roadmap instead of filing a ticket

The weaver's always-loaded prompt and the `weave-ai-weaver` skill SHALL tell the weaver that a
request to remember, park, note or roadmap an idea — "put this on the roadmap", "remember this for
later" — is recorded with `weave_roadmap_add` on the named project and SHALL NOT create a ticket for
it, and SHALL name the roadmap tools among the weaver's tools.

When the human decides to start an idea — "let's start X", "build that now" — the weaver SHALL file
the ticket and link it to the item with `weave_roadmap_update`, so the item records what it became.

#### Scenario: An idea is parked, not filed

- **WHEN** the human says "put this on the roadmap" naming a project
- **THEN** the weaver records a roadmap item with `weave_roadmap_add`
- **AND** no ticket is created for it

#### Scenario: Starting an idea links its ticket

- **WHEN** the human later says to start a roadmap item
- **THEN** the weaver files a ticket and links it to the item with `weave_roadmap_update`

#### Scenario: The tools are listed

- **WHEN** the weaver's prompt or the skill lists the weaver's tools
- **THEN** `weave_roadmap_list`, `weave_roadmap_add`, `weave_roadmap_update` and
  `weave_roadmap_remove` are named among them
