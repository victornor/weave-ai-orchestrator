# Tasks — VS-418

## 1. The compact card

- [x] 1.1 `packages/ui/src/v2/DecisionCard.tsx`: the title uses `text-ui` instead of `text-head`, with
      `mb-1`; the context body uses `text-meta` with the token's own leading (no `leading-relaxed`).
      Both the `narrow` and the wide card.
- [x] 1.2 Tighten the vertical rhythm: header/body padding, section margins (`mb-3` → `mb-2`), the
      inputs group (`gap-2`, `p-2.5`), option and single-choice rows (`p-2`, `p-1.5`), and text
      inputs (`h-8`). Buttons keep their size.

## 2. Tests

- [x] 2.1 `packages/ui/src/test/v2decisions.test.tsx`: a card renders its title with `text-ui` (not
      `text-head`) and its body with `text-meta`, on the wide card and on the narrow one.

## 3. Verify

- [x] 3.1 `pnpm lint`, `pnpm typecheck` green.
- [x] 3.2 Both suites run and pasted verbatim on the ticket.
- [x] 3.3 Before/after screenshots of the chat decision pane (tallest question card plus two others)
      and Needs you (several cards), dark and light, desktop and phone, rendered from the real V2
      components and CSS on a Vite dev server with fetch/EventSource stubbed. Paths reported on the
      ticket; images outside the worktree.

## 4. The available Approve is the call to action (captain, 2026-09-14)

- [x] 4.1 Add `--approve`/`--approve-ink` tokens for both themes and map them; make
      `.v2-button[data-variant='primary']` the filled approve treatment instead of the grey accent.
- [x] 4.2 `DecisionCard`: an approval that is not held and has nothing missing is ready, and its
      primary Approve button (plan/action, merge, hire) is filled and marked `data-approve="ready"`;
      a blocked one stays the neutral recipe, disabled, marked `data-approve="blocked"`. Destructive
      stays red, secondary buttons stay neutral.
- [x] 4.3 The weaver's clean `reviewed — no concerns` line renders green with a check glyph; the
      concerns line keeps its blocked tone.
- [x] 4.4 Test asserting the ready vs blocked approve button variants and the clean-review tone.
- [x] 4.5 Evidence: a Needs you view with a ready merge approval (clean review), a held merge
      approval and a question, after and before, both themes, desktop and phone.
