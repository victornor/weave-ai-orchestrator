## Context

See `proposal.md` — Why. The relevant current state:

- `packages/ui/src/v2/V2Shell.tsx` renders `ThemeSwitch` in two desktop places only: the expanded
  rail's `RailFooter` (beside the account line) and the collapsed 48px rail. Both are inside
  `aside` elements classed `md:flex`, so neither exists at phone width.
- The phone chrome is a bottom tab bar (`md:hidden`) of four destination tabs plus a `More` button.
  `More` opens a `role="dialog"` sheet (`MoreList`) holding the grouped destinations the tab bar
  leaves out, the daemon update entry, and `Open V1`.
- `packages/ui/src/v2/theme.ts` owns the whole mechanism: `useV2Theme()` holds the choice, writes
  `weave.v2.theme`, and `V2Root.tsx` puts `data-theme` on `.v2-root`. `V2Shell` is a child inside
  `V2Root`, so `onTheme` from the same provider updates the root and repaints everything, dialog
  included.
- `packages/ui/src/settings/sections.tsx`'s `DeviceSection` renders a note in V2
  (`themeControl="note"`): "Theme follows the switch in the V2 rail footer." It uses V1's separate
  `useTheme()` (`conductor.theme`, `data-theme` on `<html>`) for its `full` variant, which no V2
  caller uses.

## Goals / Non-Goals

**Goals:**

- A phone-width user can change the theme, from the navigation surface the More tab already opens,
  with no new surface and no second theme mechanism.
- The phone switch and the desktop switch are the same component and the same state, and the choice
  persists under the existing key.
- Rendered phone-width evidence in both themes, including the surrounding mobile surfaces in light.

**Non-Goals:**

- Redesigning the mobile navigation, adding a theme tab to the bottom bar, or making the switch a
  one-tap control outside the existing menu.
- Unifying V2's `weave.v2.theme` with V1's stale `conductor.theme` (pre-existing; called out in
  VS-482's design and out of scope here too).
- Any change to desktop theme behaviour or the token set.

## Decisions

### Decision 1: The More sheet is the phone home for the switch

The More sheet is the mobile analogue of the rail: it already carries the daemon update entry, the
Settings destination and the kept screens. The rail footer carries the switch, so the More sheet
carries it too, rendered through the existing `ThemeSwitch` component in its `expanded` variant and
fed by the same `theme`/`onTheme` props `V2Shell` already holds.

- *Why not a fifth tab or a floating control:* the ticket asks for the place the mobile navigation
  already puts settings-style controls, and explicitly rules out inventing a new surface. The More
  sheet is that place.
- *Why not the Settings → This device theme section:* that section is V1's `DeviceSection`, still
  wired to V1's `useTheme()` (`conductor.theme`). Putting V2's theme there would either fork the
  mechanism or rewrite a V1 component's theme plumbing — both larger than this ticket and contrary
  to "one state, one key".

### Decision 2: Same component, same callback — no new state

`MoreList` gains `theme`, `onTheme` and renders `<ThemeSwitch variant="expanded" />` in a labelled
footer row above the existing `Open V1` link. The props are passed straight from `V2Shell`, which
already receives them from `V2ShellLayout` (i.e. `useV2ThemeState()`). Storage is untouched:
`v2/theme.ts` and its `weave.v2.theme` key remain the only persistence.

- *Consequence:* the More sheet is a descendant of `.v2-root`, so activating the switch repaints the
  whole app including the open sheet; no reload and no sheet close is needed.

### Decision 3: The This-device note stops misdirecting phone users

`DeviceSection`'s `themeControl === 'note'` copy becomes a statement that works on both layouts —
the theme follows the in-app switch in the rail footer on desktop and the More menu on a phone. This
is the only Settings change; the section's scope requirement in `web-settings/settings-scopes` is
unchanged, so no delta is written for it.

### Decision 4: The automated test drives the More sheet's switch through the shell's callback

`packages/ui/src/test/v2shell.test.tsx` mounts `V2Shell` with an `onTheme` spy, opens `More`, and
clicks the sheet's `Light theme` button, asserting the spy received `light`. The rail's own switch is
already covered in the same file and keeps passing. jsdom has no layout, so it cannot prove the
sheet is only reachable at phone width; that is proven by the rendered phone-width capture and by
the `md:hidden` / `md:flex` classes already on the two chrome surfaces.

## Risks / Trade-offs

- *Two `ThemeSwitch` instances exist in the DOM at once (rail + More sheet).* They are independent
  renders of the same stateless component fed by the same props, so they cannot diverge. The
  existing rail test queries by accessible name and is scoped to the rail, so it stays unambiguous;
  the new test scopes its query to the dialog.
- *Adding a footer row could be read as redesigning the mobile navigation.* The row reuses the
  existing sheet layout and the existing component; only the More sheet's footer gains one row. The
  proposal calls navigation redesign out of scope.
- *Light mode has shipped broken before (VS-482).* The evidence task captures the More sheet and the
  page behind it in light, not only that the button flips.

## Migration Plan

UI-only; no data, API or config. Captain's `weave daemon upgrade` deploys the built UI; no separate
step.

## Open Questions

None.
