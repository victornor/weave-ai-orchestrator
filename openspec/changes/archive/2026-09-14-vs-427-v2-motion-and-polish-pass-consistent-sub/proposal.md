# V2 motion and polish pass

Tracker change for [VS-427](weave://tickets/VS-427). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: "add some nice animations and proper polish across the user interface, all over
the place." V2 is functionally complete but almost entirely static: the only motion in the whole V2
tree is one `motion-safe:animate-[ac-pulse…]` dot on Incidents and the chevron `transition-transform`
on a handful of disclosures. Modals, menus, panes, cards, lists and route changes all appear and
disappear instantly.

V2 also has no motion vocabulary of its own. The durations and easings it borrows (`--dur-fast`,
`--dur-panel`, `--dur-max`, `--ease`) are V1's, declared on `:root` in `index.css`, and the
`prefers-reduced-motion` block that neutralises them is V1's too. A V2 animation built on them is
V2-shaped by accident.

## What changes

- **V2 motion tokens in `packages/ui/src/v2/v2.css`.** One small scale on `.v2-root`:
  `--v2-dur-fast` (120ms), `--v2-dur-base` (180ms), `--v2-dur-slow` (240ms), and three easing curves
  (`--v2-ease`, `--v2-ease-out`, `--v2-ease-in-out`). Every animation this pass adds uses them.
- **A scoped reduced-motion block in the same file** that zeroes the three durations, on top of the
  global `index.css` rule that already forces `animation-duration`/`transition-duration` to ~0.
- **Reusable enter/leave utility classes** (`.v2-anim-fade`, `.v2-anim-rise`, `.v2-anim-menu`,
  `.v2-anim-pop`, `.v2-anim-sheet`, `.v2-anim-drawer`, `.v2-anim-route`, `.v2-anim-exit`), plus
  hover/press transitions on the shared `.v2-button`, `.v2-row` and `.v2-table [data-row]` recipes
  and on every `.v2-root` button/link.
- **Applied across the shell and screens:** modals and sheets (Plan, Hire, Role drawer, More, Search,
  New ticket) fade/scale/slide in; menus fade/slide; every collapsible body (traces, Roles rows, tool
  groups, sidebar workspace groups, Incidents, project sections, PR diffs, scheduled rows, model
  options, ticket turns) fades in; Needs you, Runs, Incidents and Live rows/tiles animate in; the V2
  route outlet cross-fades on a section change; toasts use the V2 tokens.
- **Decision cards animate out.** VS-369 removes an answered card from the query cache the moment its
  answer is recorded; a small `useExitPresence` hook keeps the card mounted for one base duration with
  an exit class before the list drops it, on both the Needs you page and the chat decisions pane.
- **No animation library.** CSS transitions, CSS keyframes and one hook; no new dependency, no bundle
  size change beyond a few hundred bytes of CSS.

## Out of scope

Chat auto-scroll, streamed-in replies and dictation (their own ticket); Work kanban card moves (their
own ticket). Dialogs and menus animate in but not out: V2 mounts them conditionally with no presence
layer, and holding them open would delay the close control and focus handling the existing cards rely
on (recorded in the delivery report).
