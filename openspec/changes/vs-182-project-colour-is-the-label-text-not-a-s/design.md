## Context

See proposal.md for motivation. VS-149 added a 6px `rounded-full` span
(`data-project-color`, `background: projectColorVar(...)`) on four web surfaces:

- `WorkspaceNav.tsx` project rows, between the sync-state slot and the slug
- `ProjectTag` (`Chips.tsx`), before the label
- `DispatchLabel.tsx`, between `StatusGlyph` and the ticket identifier
- `WorkerChip` (`Chips.tsx`), between `StatusGlyph` and the worker name

VS-173's `projectColorVar(id, siblingIds)` assignment is already unique-while-a-slot-exists
and is not in scope. The Live page, board, sent-message project pills, `TicketChip`, Telegram
and TUI never grew these circles.

## Goals / Non-Goals

**Goals:**

- One presentation: identifying text in the project colour, no project-colour circle, on the
  four surfaces that have one today.
- Keep `data-project-color` on the coloured text node so existing tests can retarget from
  `background` to `color` without a new query hook.
- Leave assignment, palette tokens, and status/sync glyphs alone.

**Non-Goals:**

- Recolouring colliding projects (VS-173).
- Adding colour to surfaces that do not already have it (Live page cells, board rows,
  sent-message project pills, unused `TicketChip`).
- Telegram / TUI.
- Changing `--project-*` tokens or `projectColor.ts`.

## Decisions

### Colour is `color` on the existing text span

Apply `style={{ color: projectColorVar }}` to the span that already holds the identifying
text (slug, tag label, ticket identifier, worker name). Delete the sibling `size-1.5
rounded-full` span. Move `data-project-color` onto the text span.

Alternative considered: a left border or underline in the project colour. Rejected — captain
asked for the label text itself.

### Which text is coloured

| Surface | Coloured text | Why |
|---|---|---|
| Sidebar row | project slug | the name of the project on that row |
| `ProjectTag` | `label` | the project name on the tag |
| `DispatchLabel` | `identifier` | captain: the ticket name on a worker tag |
| `WorkerChip` | `name` | the chip has no ticket identifier; the worker name is the label |

Worker-name / ticket-title on a dispatch label stays `text-text-3`. Status words stay
`STATUS_TEXT`.

### Active `ProjectTag` must not steal the text colour

Today an active tag sets `text-accent-link`. That would override the project colour and put
accent (a status-adjacent signal) on the label. Keep `border-accent-edge bg-accent-tint` for
the "more than a subtle border" active treatment; when `colorVar` is set, do not apply
`text-accent-link`. Auto (no `colorVar`) keeps today's text classes.

### Sync dots stay

The sidebar's `SYNC_DOT` span is a status marker (`--status-working` / `--status-blocked`),
not a project-colour circle. It stays. Tests that distinguish `dotOf` (sync) from `colourOf`
(project) keep that split; `colourOf` reads the slug's `color`.

## Risks / Trade-offs

- [Palette was picked as a fill, not as text] → same `--project-*` tokens; if contrast is
  poor on light theme that is a follow-up, not a palette change in this ticket.
- [Active tag is less loud without `text-accent-link`] → background tint plus accent border
  remain; that is already the "more than a subtle border" treatment the spec requires.
- [jsdom `toHaveStyle({ color })` can be picky] → assert the inline `style` attribute
  contains the CSS var, matching today's `background` assertions.

## Migration Plan

Presentation-only. No storage, no API. Deploy with the usual daemon upgrade. Rollback is the
previous release.
