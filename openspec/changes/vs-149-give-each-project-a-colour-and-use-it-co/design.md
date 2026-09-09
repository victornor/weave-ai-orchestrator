## Context

See `proposal.md` for the ask and for what actually happened to the sidebar's old per-project dot
(VS-131, kept as-is — it is real sync signal, not decoration, and was never a stable per-project
identity in the first place).

Relevant existing tokens, both defined per-theme in `packages/ui/src/index.css`:

- `--status-idle`, `--status-working`, `--status-stalled`, `--status-blocked`,
  `--status-needs-you`, `--status-merging`, `--status-done`, `--status-failed`, `--status-paused`
  (lines 45-53 dark, 90-98 light) — the app's nine load-bearing status colours, used by
  `StatusGlyph` and every `UiStatus`-driven surface.
- `--accent` / `--accent-link` (lines 35-36 dark, 81-82 light) — used for "this is selected/active"
  (e.g. `ProjectTag`'s active state, `StatusPill`).

Both are hand-picked hex per theme (light is not a mechanical inversion of dark — surfaces warm up,
status hues darken to hold contrast on white, per the file's own header comment). The project
palette follows the same pattern: hand-picked per theme, not derived.

`packages/ui/src/lib/graph/simulation.ts`'s `angleOf(id)` already has the pattern this needs — an
FNV-1a-style hash over a string id, folded into a bounded, deterministic number with no
`Math.random`. `projectColor.ts` reuses the same hash, folded into a palette index instead of an
angle.

## Goals / Non-Goals

**Goals:**
- One deterministic function from a project's id to a colour, usable everywhere a project is
  named, with no storage and no migration.
- A hand-picked palette that stays clearly out of the way of the app's nine status colours and its
  accent, in both themes.
- Add the colour as a small, consistent marker on each of the four named surfaces, without
  replacing any signal that already means something else (the sync dot, the status glyph, the
  active/inactive picker state).

**Non-Goals:**
- Not reverting or changing VS-131's sync-state dot.
- Not a per-project stored/configurable colour — captain's own framing ("random... but the same
  every time") is exactly determinism-from-id, and a stored field would need a migration, a default
  for existing projects, and a place to edit it, none of which the ask calls for.
- Not colouring `TicketCard`/the board — out of scope per the ticket (sidebar, chat project tag,
  chat ticket tags, chat worker tags only); `TicketChip` stays unused.
- Not touching `packages/tui` — the ticket is about the web app.

## Decisions

### The palette is fixed, hand-picked, and small

A hash-to-hue function (e.g. `hue = hash(id) % 360`) was considered and rejected: with the
workspace's realistic project counts (single digits), two ids can hash to neighbouring hues that
read as "the same colour, slightly off" rather than as two distinct projects — exactly the failure
mode the ticket calls out. Instead, `projectColor.ts` exports a short, fixed array of hand-picked
`{ dark, light }` hex pairs; a project's colour is `PALETTE[hash(id) % PALETTE.length]`. Picking
from a small fixed set means every pair of colours actually in use has been chosen to be
distinguishable, not just far apart by construction.

Draft palette (five entries — chosen for mutual distinctness and distance from every status hue
and the accent hue, described below; exact hex tuned during implementation against the real theme,
per the ticket's required in-browser check in both themes):

| Name (identity only, not shown to users) | Dark | Light |
|---|---|---|
| teal | `#2dd4bf` | `#0f766e` |
| sky | `#38bdf8` | `#0369a1` |
| fuchsia | `#e879f9` | `#a21caf` |
| clay | `#c08552` | `#8a5a2e` |
| olive | `#a3a84c` | `#6b6e1f` |

Why these and not others: the app's status/accent hues cluster into three occupied bands — red
through amber (`failed` ~358°, `blocked` ~10°, `working`/`stalled` ~35°), green (`done` ~134°), and
indigo through violet (`needs-you`/`accent` ~231-234°, `merging` ~265°). `teal` (~172°) and `sky`
(~199°) sit in the open cyan band between green and indigo; `fuchsia` (~300°) sits in the open band
between violet and red, far enough from `merging` not to read as a duller purple. `clay` and
`olive` reuse hues closer to the taken amber/green bands but are pulled clearly out of collision by
much lower saturation and a different lightness curve than any status token uses (a status colour
is never muted or brownish) — the same trick that already distinguishes `working` from `stalled`
within the amber family, applied across families instead of within one. If in-browser verification
finds any pair (including against a status colour) reads as ambiguous at swatch size, the fix is to
swap that entry, not to add a rule — the requirement is the outcome, not these exact five hexes.

Five is deliberately on the small side per the ticket's own steer ("adjacent hues are the likely
failure, not exhaustion of the palette"). `PALETTE.length` is not otherwise a meaningful contract —
the requirement is deterministic assignment from a fixed, checked set, not a specific count.

### Deterministic assignment, no storage

`projectColorIndex(id: string): number` folds an FNV-1a-style hash (the same shape as
`simulation.ts`'s `angleOf`) mod `PALETTE.length`. `projectColorVar(id, theme)` (or a CSS custom
property keyed by index, read the same way `WorkspaceNav.tsx` already reads
`var(--status-${dot})`) returns the value to put in `style={{ background: ... }}`. No new field on
`Project`, no migration: the exact reasoning captain gave for wanting this to be stable rather than
truly random (survives reload, survives device, survives every render) is satisfied by pure
determinism, which is strictly simpler than a stored value and cannot drift from it either.

Tokens are added to `index.css` as `--project-1` … `--project-5` in both theme blocks (mirroring
how `--status-*` is authored), rather than inlining hex in TypeScript, so a future palette
adjustment is a CSS-only change and the light/dark split stays where every other colour decision
already lives.

### One visual treatment: a small colour swatch, never a full tint

Every one of the four surfaces already carries its own primary signal (a sync dot, a status glyph,
the active/inactive accent styling). Fully recolouring a tag's background or border by project
would compete with those and risks exactly the "four surfaces getting colour at once turns into
noise" the ticket warns against. Instead, every surface gets the same small, low-key marker: a
`size-1.5 rounded-full` dot (matching the existing sync-dot and status-glyph sizing already used
throughout `Chips.tsx`/`WorkspaceNav.tsx`), positioned so it reads as "which project" without
competing for the same glance as "what state."

Per surface:

- **Sidebar (`WorkspaceNav.tsx`'s `ProjectsGroup`)**: the row already reserves a fixed-width slot
  for the sync dot (empty when `in_sync`, coloured when not — VS-131). The project colour is a
  second, small dot inserted between that slot and the slug text, so the sync marker (when present)
  and the identity marker are simultaneously visible and never overwrite each other.
- **Chat project picker (`ProjectTag`)**: a colour dot is added before the label, present in both
  the active and inactive visual states. The active state's existing accent border/tint is
  unchanged — that pair of pixels means "this is what the next message will carry," a different
  fact from "this is project X," and both need to be visible together (a project can be the active
  choice and still needs its own colour shown).
- **Dispatch label / worker chip (`DispatchLabel.tsx`, `WorkerChip` in `Chips.tsx`)**: a colour dot
  is added immediately after the existing `StatusGlyph`, before the identifier/name text. Status
  stays the leftmost, first-read signal (it is transient — a dispatch's state changes over its
  life); project identity sits right after it (it is stable for the dispatch's whole life). A
  dispatch or chip with no project (`ticket.projectId`/`agent.projectId` is `null`) renders no dot
  at all, rather than a neutral placeholder — restraint again: a marker that means nothing is worse
  than no marker.

### Data already in hand — no new fetch, no new prop plumbing beyond an id

- Sidebar: `ProjectsGroup`'s `state.projects` are already full `Project` objects; `p.id` is already
  there.
- Chat picker: `ProjectPicker` already receives the full `projects: Project[]`; `p.id` is already
  there.
- Dispatch label: `Chat.tsx`'s `row.entry.dispatches` already carries the full `Ticket` per
  dispatch (`d.ticket.identifier` is already read); `d.ticket.projectId` is already on that object
  and needs only to be passed through as a new optional prop on `DispatchLabel`.
- Worker chip (unattributed): `Chat.tsx`'s `unattributed` list is `Agent[]`;
  `Agent.projectId` is already on that object, threaded through as a new optional prop on
  `WorkerChip`.

No new query, no new server field, no new join — this is entirely a presentation change over data
every call site already has.

## Risks / Trade-offs

- **A hash collision assigns two projects the same colour** once the workspace has more projects
  than `PALETTE.length`. Accepted: the ticket explicitly prefers a small, checked palette over a
  larger, riskier one, and a repeat colour is a graceful, understandable degradation (same as any
  hash-based categorical palette), not a broken or misleading state — it never claims a false sync
  or status signal, only "these two happen to share a swatch."
- **`clay` and `olive` are hue-adjacent to taken bands (amber, green).** Mitigated by saturation
  and lightness, called out explicitly above; the required in-browser, both-theme check before this
  is delivered is where that judgement call gets confirmed against the real theme rather than
  guessed at in this document.
- **Two more chat tickets touch `Chat.tsx` concurrently (VS-146, VS-147, VS-148, per the ticket's
  own "Related" note).** This change only adds new optional props/markup to `DispatchLabel` and
  `WorkerChip` and passes two additional ids through `Chat.tsx`; it does not restructure the
  message list, the composer, or their state, which is where those tickets' surface area more
  likely sits. If review turns up a real conflict, it is a merge-order matter for the conductor to
  sequence, not a design change here.
