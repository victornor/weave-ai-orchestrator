## Why

Captain, 2026-09-10: adding a project can give it the same colour as one already in the
workspace — two yellow projects in one workspace. VS-149 (PR #122) derives colour as
`PALETTE[hash(id) % 5]` with no uniqueness, so a free slot is ignored whenever two ids
fold to the same index.

## What Changes

- A project's colour remains a pure, deterministic function with no storage, but it is
  now a function of **that project's id plus the other project ids in the same
  workspace**, not of the id alone.
- While a palette colour is unused in that workspace, a newly added project SHALL get
  one of those unused colours — never a colour already shown for another project.
- When every palette colour is already in use, the new project gets a least-used colour
  (deterministic tie-break). The five-entry hand-picked palette is not expanded.
- Sidebar, chat project tags, dispatch labels and worker chips keep reading the same
  helper, so they stay consistent with that assignment.
- Existing colliding pairs are resolved cheaply by the same function (the later id
  yields the free colour). No data migration, no stored colour field.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `workspace-navigation/project-colour`: colour is unique among a workspace's projects
  whenever a free palette slot exists; when the palette is exhausted, least-used.
  Still deterministic, still unstored. The "purely from the project's id" and
  "nothing stored" requirements are rewritten so uniqueness can be computed from the
  workspace's project-id set.

## Impact

- `packages/ui/src/lib/projectColor.ts` — uniqueness-aware assignment; same `PALETTE`.
- Call sites that currently pass only an id (`WorkspaceNav.tsx`, `Chat.tsx` dispatch
  labels, worker chips, `ProjectPicker`) pass the workspace's project-id list.
- Tests: `projectColor.test.ts` covers uniqueness on add and least-used when full;
  `workspacenav.test.tsx` / `chat.test.tsx` follow the new helper signature.
- No daemon schema, no `POST /projects` change, no API, no CLI, no Telegram / TUI
  (out of scope). Palette tokens in `index.css` are unchanged.
