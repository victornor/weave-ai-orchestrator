## 1. Device-local layout preference

- [x] 1.1 Add `packages/ui/src/lib/decisionLayout.ts`: `export type DecisionLayout = 'bottom' |
      'split'`, `readDecisionLayout()`, and `useDecisionLayout(): [DecisionLayout, (l) => void]`,
      mirroring `lib/diffLayout.ts` — key `conductor.decisions.layout`, `bottom` as the absence of the
      key, `setLayout('bottom')` removing it, and every `localStorage` access in `try`/`catch` so a
      refused store still works for the session. Unit-test in
      `packages/ui/src/lib/decisionLayout.test.ts`: default is `bottom`; setting `split` reads back;
      setting `bottom` clears the key; a throwing `localStorage` neither throws nor loses the
      in-session choice.

## 2. Layout control on the chat screen

- [x] 2.1 Add the two-option control (`Bottom` / `Side`, `secondary` variant for the active option) to
      `ChatPage`'s `PageHeader` `actions`, calling `setLayout`, wrapped in `hidden md:flex` so it is
      not offered on a narrow viewport. Verify by test: on a desktop viewport both options are
      present, the active one is marked, and activating `Side` calls the setter / changes the rendered
      region.

## 3. Split frame with a right-hand rail

- [x] 3.1 Restructure the frame in `Chat.tsx` into a horizontal flex (`flex min-h-0 flex-1`) carrying a
      `--rail-w` CSS variable: a left column (`flex min-w-0 min-h-0 flex-1 flex-col`) holding the
      transcript wrapper, the bottom pinned strip when applicable, and the composer; and, when the
      effective layout is `split` and there is something to show, a sibling rail
      (`min-w-0 min-h-0 ac-scroll w-[var(--rail-w)] flex-none`) with `aria-label="Open decisions"`.
      Confirm every flex level in the chain carries `min-h-0`/`min-w-0`.
- [x] 3.2 Move the open cards and the hidden-from-chat button into the rail in `split` and leave the
      bottom strip in `bottom`, rendering from the same `shown` / `hiddenOpen` data. Verify by test:
      under `split` the rail is present, the pinned strip is absent, and the card renders in the rail;
      under `bottom` the reverse. Assert the rail and the transcript are siblings each with their own
      scroll container.
- [x] 3.3 Confirm the composer stays in the left pane and keeps the full width the layout gives it
      (no rail inside the left column, `min-w-0` present). Verify by test that the composer renders
      inside the left column when `split` is active.

## 4. Narrow-viewport fallback

- [x] 4.1 Add a local `useMediaQuery('(max-width: 767px)')` to `Chat.tsx` (same shape as
      `KnowledgeExplorer.tsx`) and compute
      `effective = narrow ? 'bottom' : readDecisionLayout()`; the rail renders only when
      `effective === 'split'` and the control is hidden below `md`. Verify by test with
      `window.matchMedia` forced to narrow: with `split` stored the chat renders the bottom strip and
      no rail, and no `Side` option is offered.

## 5. Empty rail and preserved bottom machinery

- [x] 5.1 Collapse the rail when `shown.length === 0 && hiddenOpen.length === 0` (`split` renders no
      rail and the conversation fills the frame). Verify by test: with `split` active and no
      decisions, no `Open decisions` region is in the document.
- [x] 5.2 Keep `lib/decisionHeight.ts`'s resize handle and reset bottom-only: render the separator
      only in `bottom`, and do not apply a drag height to the rail. Verify by test: the
      `Resize the decisions area` separator is present under `bottom` and absent under `split`, and
      the hidden-count restore works under both.
- [x] 5.3 Confirm answered decisions still render inline in the transcript in both layouts (the
      `status !== 'open'` branch is untouched). Verify by test with `split` active and one answered,
      one open decision: the answered card is in the transcript and the open card is in the rail.

## 6. Verification

- [x] 6.1 `pnpm lint && pnpm typecheck` clean.
- [x] 6.2 `pnpm test` green; paste **both** suite blocks (core/server and UI) verbatim with their real
      totals in the delivery report — never one alone, never a retyped combined figure.
- [x] 6.3 Drive the UI screenshot harness (no live daemon) with at least two open decisions — a
      `plan_approval` and one other kind — and capture: `bottom` and `split` at a desktop width, and
      the phone width with `split` stored. Confirm the rail and conversation scroll independently, the
      composer's attachment chips stay usable, the answered card stays in the transcript, and no
      hardcoded colour is introduced. Deliver the screenshots as uncommitted files under this worktree
      and report their absolute paths, stating plainly if the conversation is narrower than today at
      any width.
