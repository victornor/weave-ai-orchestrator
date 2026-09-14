# Tasks — VS-427

## 1. Motion tokens, keyframes and reduced motion

- [x] 1.1 `packages/ui/src/v2/v2.css`: add `--v2-dur-fast` / `--v2-dur-base` / `--v2-dur-slow` and
      `--v2-ease` / `--v2-ease-out` / `--v2-ease-in-out` to `.v2-root`.
- [x] 1.2 Add `@keyframes` for fade, rise, menu, pop, sheet, drawer, route and exit — all
      `from`/`to` shaped so `v2theme.test.ts`'s selector scan still sees only `.v2-*` selectors.
- [x] 1.3 Add the `.v2-anim-*` utility classes that consume the tokens, and a
      `@media (prefers-reduced-motion: reduce)` block under `.v2-root` that zeroes the three
      durations.
- [x] 1.4 Add hover/press transitions to `.v2-button`, `.v2-row`, `.v2-table [data-row]` and every
      `.v2-root` `button`/`a`/`[role=menuitem]`, with a press scale on the two button recipes.

## 2. Presence hook

- [x] 2.1 `packages/ui/src/v2/motion.ts`: `useExitPresence(items, keyOf, exitMs)` returns the list
      with removed items held as `{ item, exiting: true }` for one base duration, then dropped.
- [x] 2.2 `V2DecisionCard` gains an `exiting` prop that swaps its enter animation for the exit one.

## 3. Apply the animations

- [x] 3.1 Modals and sheets animate in: Plan modal, Hire modal, Role drawer, More sheet, Search panel,
      New-ticket dialog.
- [x] 3.2 Menus fade/slide in: Roles row menu, Ticket actions menu, Chats reorder menu.
- [x] 3.3 Collapsible bodies fade in: ChatTrace (tool row, tool group, turn trace), Roles worker row
      and start-session form, sidebar workspace groups, collapsed-rail swap, Incidents detail, project
      sections, PR file bodies and diff gaps, scheduled rows, settings model options, ticket run turns,
      Worker page session, decision-card Watch body.
- [x] 3.4 Decision cards animate in and out on the Needs you page and the chat decisions pane.
- [x] 3.5 Lists animate in: Incidents rows, Live tiles, Runs phone rows, Needs you cards.
- [x] 3.6 Toasts use the V2 tokens when the active theme is V2.
- [x] 3.7 The V2 route outlet cross-fades on a section change.

## 4. Tests and verification

- [x] 4.1 `v2theme.test.ts`: accept `@media` at-rule preludes in the selector scoping scan (the real
      selectors still all start with `.v2-`).
- [x] 4.2 New `packages/ui/src/test/v2motion.test.tsx`: tokens exist in `v2.css`, every `.v2-anim-*`
      class uses a token, the reduced-motion block zeroes the durations, and a rendered decision card
      carries the enter/exit class it should.
- [x] 4.3 `pnpm lint && pnpm typecheck` green; both suites run and pasted verbatim.
- [x] 4.4 Evidence: before/after frame captures for a modal, a menu, an expanding pane, a decision
      card leaving, and a route change, in dark and light (a harness on the real `v2.css`, plus a
      reduced-motion capture; the absolute paths are in the PR body).
