# Starting a roadmap block files one ticket by default

Tracker change for [VS-557](conductor://tickets/VS-557). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

Captain, 2026-09-18, after the weaver started the UI polish #2 block (16 small UI items) as nine
tickets, VS-548 to VS-556: "the reason why we use a roadmap is so that we can keep things
contained... Now we're spawning 9 workers, each with a fresh context... having the worker learn
about the project 9 times to do UI polish... this could have easily been condensed into way less
tickets."

Blocks exist so that related small asks are done by **one worker with one context**, instead of
each one paying to learn the project from scratch. The old wording — "bundle related ones into as
few tickets as the work allows" — was read narrowly: the weaver grouped the items by screen and
filed nine. The tool also handed back one ready-made draft per item, so the easiest path produced
one ticket per surface.

## What changes

- **`weave_roadmap_block_start` returns one merged draft by default.** The per-item `drafts` array
  becomes a single `draft` (null when nothing is left to file) whose `description` carries every
  item as its own section and whose `itemIds` name the items the one ticket covers. Splitting is
  still possible, but it now takes a deliberate second step (`weave_roadmap_block_list`), not the
  default path. The shape change is covered by tests.
- **The rule is stated where the weaver starts a block**: the tool description, the Roadmap
  paragraph of the weaver's always-loaded prompt (`templates/weaver.AGENTS.md.tmpl`), the
  `weave-ai-weaver` skill, and a short block note in `weave-ai-planning`.
- **The rule**: starting a block files **one ticket for the whole block**, owned by one role. Split
  only when a named reason applies, and state the reason in the ticket: items need different roles
  or projects; one item needs its own approval path (`operational` vs `change`); or the block is too
  large for one worker to finish in a reasonable number of turns. Touching different screens is not
  a reason. Even then the target is two or three tickets, never one per item or per surface — a
  large single ticket is fine, because the worker resumes its session across turns.

## Out of scope

Changing the stored `roadmap_blocks`/`roadmap_items` schema, the derived block status, or the
roadmap tools other than `weave_roadmap_block_start`. Main capability specs are not edited: a
`task` tracker change carries no deltas (`skip_specs`), matching VS-243.
