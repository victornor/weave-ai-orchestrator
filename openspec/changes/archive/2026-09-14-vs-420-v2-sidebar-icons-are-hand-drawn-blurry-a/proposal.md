# V2 navigation icons come from one set (Lucide)

Tracker change for [VS-420](weave://tickets/VS-420). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: the V2 sidebar icons are "all made up", "poor", "low resolution", "don't really
make any sense" and "all random". They are indeed hand-drawn: `packages/ui/src/v2/nav.ts` holds
`V2_GLYPH_STYLE`, a CSS-only recipe per destination (a border-radius circle for Settings, a clip-path
triangle for Incidents, `linear-gradient` stripes for Runs and Roles), and `Glyph.tsx` renders each
as a `<span>`. They are inconsistent in shape and weight, they carry rounded-border artifacts of the
CSS they are built from, and they read as a different icon at every size. Captain's choice was
**replace, not remove** — the 48px collapsed rail and the phone tab bar need a mark per destination.

## What changes

- **One established set.** `lucide-react` (MIT, a uniform 24px grid and stroke) becomes the V2 nav
  icon source. Named imports only, so the bundle carries the thirteen icons used and no more.
- **A semantic icon per destination.** `V2GlyphName` keeps the destination vocabulary the registry
  already uses (`chat`, `chats`, `needs`, `live`, `work`, `roles`, `knowledge`, `runs`, `scheduled`,
  `incidents`, `map`, `settings`, `plugin`, plus `more`); `Glyph.tsx` maps each name to one Lucide
  component. That mapping is the single source of truth, so the expanded rail, collapsed rail, phone
  tab bar and More list cannot drift apart.
- **One size and stroke, in `currentColor`.** The icons render as SVG at a fixed size and stroke
  weight, coloured by the text token already on the row — so active, hover and muted states and both
  themes keep working with no per-state CSS.
- **The hand-drawn recipes are deleted.** `V2_GLYPH_STYLE` and `nav.ts`'s `CSSProperties` import go;
  `V2Glyph` returns an `<svg>`, never a styled `<span>`.
- **The phone "More" tab stops wearing the Settings gear** and gets its own ellipsis mark, because it
  is a menu, not Settings — the one place the old glyph was actively wrong.
- **A test asserts the mapping.** Every registry destination renders an SVG whose Lucide identity
  matches the expected map, so swapping or dropping an icon fails the suite.

The mapping (destination → Lucide icon):

| Glyph | Destination | Lucide icon |
|---|---|---|
| `chat` | Chat | `MessageSquare` |
| `chats` | Chats | `MessagesSquare` |
| `needs` | Needs you | `Inbox` |
| `live` | Live | `Activity` |
| `work` | Work | `Kanban` |
| `roles` | Roles | `Users` |
| `knowledge` | Knowledge | `BookOpen` |
| `runs` | Runs / Usage | `List` |
| `scheduled` | Scheduled / Changelog | `Clock` |
| `incidents` | Incidents | `TriangleAlert` |
| `map` | Map | `Map` |
| `settings` | Settings | `Settings` |
| `plugin` | a loaded plugin | `Plug` |
| `more` | phone More tab | `Ellipsis` |

## Out of scope

- The Weave brand mark, V1 icons and status glyphs (`StatusGlyph`).
- Any V2 icon outside the shared glyph component.
- The design reference's own hand-drawn `MARKS` (it is the artifact being replaced, not a target to
  match).
