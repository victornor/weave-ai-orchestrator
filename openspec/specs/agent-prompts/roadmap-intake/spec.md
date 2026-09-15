# agent-prompts/roadmap-intake Specification

## Purpose
Teaches the weaver the difference between an idea and a piece of work: "remember this for later" is
a roadmap item, "let's start X" is a ticket linked to the item it came from.

## Requirements

### Requirement: The weaver parks ideas on the roadmap instead of filing a ticket

The weaver's always-loaded prompt and the `weave-ai-weaver` skill SHALL tell the weaver that a request to remember, park, note or roadmap an idea — "put this on the roadmap", "remember this for later" — is recorded with `weave_roadmap_add` on the named project and SHALL NOT create a ticket for it, and SHALL name the roadmap tools among the weaver's tools. When the human names a block ("fix this as part of the UI polish block") or asks to batch related small asks, the weaver SHALL record the ask as a pending ticket in that named block rather than filing a ticket for it.

When the human decides to start an idea — "let's start X", "build that now" — the weaver SHALL file the ticket and link it to the item with `weave_roadmap_update` or `weave_roadmap_item_update`, so the item records what it became.

#### Scenario: An idea is parked, not filed

- **WHEN** the human says "put this on the roadmap" naming a project
- **THEN** the weaver records a roadmap item with `weave_roadmap_add`
- **AND** no ticket is created for it

#### Scenario: A small ask goes into a named block

- **WHEN** the human says to fix something as part of a named block, or asks to batch related asks
- **THEN** the weaver records a pending ticket in that block with a `weave_roadmap_*` tool
- **AND** no ticket is created for it yet

#### Scenario: Starting an idea links its ticket

- **WHEN** the human later says to start a roadmap item
- **THEN** the weaver files a ticket and links it to the item with `weave_roadmap_update`

#### Scenario: The tools are listed

- **WHEN** the weaver's prompt or the skill lists the weaver's tools
- **THEN** `weave_roadmap_list`, `weave_roadmap_add`, `weave_roadmap_update`,
  `weave_roadmap_remove`, `weave_roadmap_block_create`, `weave_roadmap_block_list`,
  `weave_roadmap_block_update`, `weave_roadmap_block_start`, `weave_roadmap_item_add`,
  `weave_roadmap_item_update` and `weave_roadmap_item_merge` are named among them

### Requirement: The weaver bundles related asks and starts a block as few tickets

The weaver's guidance SHALL tell it to bundle related items in a block so one worker can do them in
one ticket, to merge the pending tickets that no longer need to be separate before filing, to start
a block with the start tool and file each returned draft with `weave_ticket_create`, applying the
planning skill's merge-back rule so the block becomes the minimum number of tickets, and to link
each created ticket back to its item. It SHALL also carry a short explanation, which the weaver can
give the human on request, of how roadmaps and blocks save tokens by keeping small related asks out
of separate tickets and separate workers until there is enough work to bundle.

#### Scenario: Bundling before filing

- **WHEN** the guidance describes starting a block
- **THEN** it says to merge related pending tickets and file the minimum tickets that the work needs

#### Scenario: Filing goes through the one ticket tool

- **WHEN** the guidance describes turning a started block into work
- **THEN** it says to file the drafts with `weave_ticket_create` and link each ticket to its item

#### Scenario: The token-saving explanation is available

- **WHEN** the human asks how roadmaps save tokens
- **THEN** the prompt or skill carries an explanation that blocks collect and bundle small related
  asks so they do not each spawn their own worker
