## Why

Captain (2026-09-08), verbatim:

> "Seems like one of our latest tickets removed the random symbol we had for each project label in
> the sidebar. Let's instead assign a random color to each project label and also reuse this color
> for the chat tag (where we select which project to scope the message for). Just make sure the
> colors are matching well with the rest of the style of the app. This also allows us to color the
> ticket tags (the ones that show up in the conductor chat), as well as enginneer/worker tags. This
> will add some nice colors across the app which will help with understanding what is related to
> which project."

The goal is seeing at a glance what belongs to which project, everywhere a project is named in the
web app.

## The regression, established

VS-131 (`dfa1ee4`, PR #110, "A project's sync state is detected and shown, with a Sync action")
replaced the sidebar's per-project dot. Before it, `WorkspaceNav.tsx` coloured each project row's
dot by **list index**, cycling through `PROJECT_DOT = ['needs-you', 'done', 'working', 'merging',
'blocked']` — i.e. it reused the same five hex values the app's status system already means
something specific by. VS-131 replaced that with `SYNC_DOT`, which reads `Project.syncState` and
shows a real signal (diverged/behind) instead of a decorative one.

This was not an accidental loss and it should not be reverted: the old dot was never a project's
*identity* — colouring by array index meant reordering the list (e.g. a project's sync state
changing what's returned, or a new project being inserted) changed which colour a project got, and
it collided with exactly the "don't reuse status colours" hazard this ticket calls out. VS-131's
replacement is real, useful signal and stays exactly as it is. What captain is asking for — a
colour that identifies *this project* stably, wherever it appears — never existed; this ticket
builds it from scratch, alongside the sync marker rather than instead of it.

## What Changes

- A new small capability, `workspace-navigation/project-colour`: every project gets a colour that
  is a pure, deterministic function of the project's id, drawn from a small, fixed, hand-picked
  palette — never randomly generated at render time, never stored. The palette is chosen to stay
  clear of the app's nine `--status-*` tokens and its accent colour in both themes.
- The sidebar's project rows (`WorkspaceNav.tsx`) gain a small colour swatch identifying the
  project, alongside — not instead of — the existing sync-state dot from VS-131, which is
  unchanged.
- The chat's project picker (`ProjectTag` in `Chips.tsx`, used by `ProjectPicker` in `Chat.tsx`)
  shows each project's colour on its tag. The picker's existing active/inactive styling (accent
  border/tint) is a different signal — which project is chosen for the next message — and stays;
  the project's own colour is additive.
- The conductor chat's dispatch labels (`DispatchLabel.tsx`) and unattributed worker chips
  (`WorkerChip` in `Chips.tsx`, both in `Chat.tsx`) show the colour of the project the underlying
  ticket (or, for a chip with no ticket, the agent) belongs to. Work with no project — a
  workspace-wide ticket, an agent with no `projectId` — shows no colour marker, rather than a grey
  placeholder.
- `TicketChip` in `Chips.tsx` is currently unused anywhere in the app (dead code — no import
  outside its own file and tests); it is left alone.

## Design points carried into `design.md`

- **Stable, not random.** The colour is derived from the project id via a deterministic hash into
  a fixed palette index — same output on every render, reload and device, no migration, no stored
  field.
- **No collision with status meaning.** `packages/ui/src/index.css` defines nine `--status-*`
  tokens (idle, working, stalled, blocked, needs-you, merging, done, failed, paused) plus
  `--accent`, in both `[data-theme='dark']` and `[data-theme='light']`. The project palette is
  chosen to sit in hue ranges none of those occupy.
- **Restraint.** Not every surface gets a fully-tinted tag. A small colour swatch/dot is added
  next to the identifying text on each of the four surfaces, leaving the status glyph (where one
  exists) as the primary, first-read signal and the project colour as a secondary, always-present
  one.

## Capabilities

### New Capabilities

- `workspace-navigation/project-colour`: every project has a stable, deterministic colour drawn
  from a small fixed palette kept clear of the app's status and accent colours.

### Modified Capabilities

- `workspace-navigation/sidebar-workspaces`: a project's sidebar entry gains a colour swatch
  identifying it, alongside its existing sync-state marker.
- `conductor-chat/message-project-context`: the project selector's tags show each project's
  colour, additive to the existing active/inactive styling.
- `conductor-chat/dispatch-labels`: a dispatch label, and an unattributed worker chip, show the
  colour of the project their work belongs to, when it belongs to one.

## Impact

- `packages/ui/src/index.css` — new project-colour tokens, both themes.
- `packages/ui/src/lib/projectColor.ts` (new) — the deterministic id → palette-index/colour
  function.
- `packages/ui/src/app/WorkspaceNav.tsx` — sidebar project rows.
- `packages/ui/src/components/Chips.tsx` — `ProjectTag`, `WorkerChip`.
- `packages/ui/src/components/DispatchLabel.tsx` — dispatch labels.
- `packages/ui/src/routes/Chat.tsx` — threads each project id through to the components above.
- Tests: `workspacenav.test.tsx`, `chat.test.tsx`, `components.test.tsx`, a new
  `projectColor.test.ts`.
- No server, API, or storage changes — this is presentation-only, over data already fetched.
