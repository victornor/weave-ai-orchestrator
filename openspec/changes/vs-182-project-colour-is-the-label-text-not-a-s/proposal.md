## Why

Project colours (VS-149) landed as small circles next to names — sidebar slugs, composer
project tags, dispatch labels, live worker chips. Captain, 2026-09-10: those circles read as
status (blue status vs pink status). The colour must be the **label text** itself, with no
circle.

## What Changes

- On every web surface that currently shows a project-colour circle, the circle is removed.
  The identifying text takes that project's colour instead:
  - sidebar project row: the project slug
  - composer project-picker tag: the project name
  - dispatch label in conductor chat: the ticket identifier
  - unattributed worker chip in conductor chat: the worker name
- One treatment everywhere those colours already appear. No new colour surfaces.
- VS-173 uniqueness of assigned colour is unchanged. Palette, hash, and sibling-aware
  assignment stay.
- Sidebar **sync-state** dots (behind / diverged) stay: those are status, not project identity.
- Status glyphs on dispatch labels and worker chips stay, leftmost, as the primary status
  signal.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `workspace-navigation/project-colour`: colour is applied as the identifying text's colour,
  never as a separate circle or swatch.
- `workspace-navigation/sidebar-workspaces`: a project's sidebar entry colours its slug; it
  no longer shows a project-colour circle beside the (still present) sync marker.
- `conductor-chat/message-project-context`: each project tag colours its label; Auto stays
  uncoloured; no colour circle on any tag.
- `conductor-chat/dispatch-labels`: a dispatch label colours the ticket identifier, a worker
  chip colours the worker name; neither shows a project-colour circle.

## Impact

- `packages/ui/src/app/WorkspaceNav.tsx` — drop the project-colour span; colour the slug.
- `packages/ui/src/components/Chips.tsx` — `ProjectTag` and `WorkerChip`: colour the label,
  no circle.
- `packages/ui/src/components/DispatchLabel.tsx` — colour the ticket identifier, no circle.
- Tests: `workspacenav.test.tsx`, `components.test.tsx`, `chat.test.tsx` — assert text
  colour, not a `[data-project-color]` circle's background.
- `packages/ui/src/lib/projectColor.ts` unchanged.
- No server, API, storage, Telegram, or TUI change.
