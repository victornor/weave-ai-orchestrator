## 1. The type scale and the preference

- [x] 1.1 In `packages/ui/src/index.css`, declare `--fs-scale: 1` in the theme-independent `:root` block and rewrite each `--fs-display … --fs-nano` as `calc(<base> * var(--fs-scale))`; verify `pnpm --filter @weave-ai/ui build` (or `pnpm typecheck`) still resolves the `@theme inline` `--text-*` mappings and `.text-body` renders at the same size at scale 1
- [x] 1.2 Add the five `.v2-root[data-text-size='<key>'] { --fs-scale: … }` rules (xs 0.9, sm 0.95, lg 1.1, xl 1.2) with `md` left implicit at 1; verify a jsdom/browser read resolves `--fs-body` to `calc(0.875rem * 0.9)` under `data-text-size="xs"` and to `0.875rem` under `md`
- [x] 1.3 Create `packages/ui/src/v2/textSize.ts`: the storage key `weave.v2.textSize`, the ordered `TEXT_SIZE_STEPS` (key/label/scale) for Smallest/Smaller/Default/Large/Largest, `readTextSize` (absent or junk → `md`) and `writeTextSize`, plus `useTextSize()` over `useSyncExternalStore`; add a colocated unit test for the round-trip, the junk fallback and the setter notifying subscribers
- [x] 1.4 In `packages/ui/src/v2/V2Root.tsx`, put `data-text-size={size}` on the same `.v2-root` div that carries `data-theme`, so the first paint is already at the stored size (no flash); verify a render test asserts the attribute follows `writeTextSize` and defaults to `md`
- [x] 1.5 Narrow the `.v2-root[X]` prohibition in `packages/ui/src/test/v2theme.test.ts` to permit the `data-text-size` attribute selectors while still failing any `.v2-root .x`/`:x`/`.x` descendant or theme-token scoping; verify `pnpm --filter @weave-ai/ui test` is green

## 2. The settings control and the live preview

- [x] 2.1 In `packages/ui/src/v2/ChatMessage.tsx`, extract the message container currently inline (the `mine ? 'max-w-[78%] … bg-bg-2' : 'w-full … bg-bg-1'` wrapper) into an exported `MessageBubble` and render `ChatMessage` through it, so chat and the preview share one source; verify the existing chat render tests are unchanged and green
- [x] 2.2 Add the text-size control and preview to the *This device* section in `packages/ui/src/settings/sections.tsx`: the five labelled steps, the current one marked, and two `MessageBubble`s through `MessageBody` using real prose (a user question and a weaver reply); verify a render test finds the control, the two preview bodies, and that selecting a step calls the setter
- [x] 2.3 Confirm the preview and the app update together on selection (the root attribute and the section read the one hook), and that the reply paragraph is full width while the user bubble is narrower — the measured `font-size` is identical; verify with a test that the two preview bodies carry the same `text-body` class and a browser measurement recorded for task 4.3
- [x] 2.4 Convert the 19 hardcoded `text-[Npx]` literals in `packages/ui/src/v2/V2Login.tsx`, `V2Onboarding.tsx` and `V2Shell.tsx` to the nearest scale token (`text-title`, `text-ui`, `text-micro`, `text-nano`, …) so no surface is left at a stale size; verify a repo grep finds no remaining `text-[<n>px]` outside tests

## 3. Semantic colours resolve to one hue

- [x] 3.1 In `packages/ui/src/index.css`, make the Approve control an inverse pair: keep dark `--approve: #f2f3f5` / `--approve-ink: #0b0b0d` (today's value) and set light `--approve: #3d4148` / `--approve-ink: #ffffff` in place of the green `#15803d`; verify neither theme's approve carries a hue and each fill's own ink clears contrast
- [x] 3.2 Set `--review-clean: #4ade80` in dark (same hue as light's `#15803d`) and keep light at `#15803d`; verify `CI passed` (`text-review-clean` in `components/CiChip.tsx`) and the card's reviewed-clean line now resolve to the same hue in both themes
- [x] 3.3 Give the blocked Approve one recipe in both themes: define `--approve-blocked`/`--approve-blocked-ink` in the light block (dark `#222226`/`#868c95`, light `#eaecef`/`#565a61`) and drop the `:not([data-theme='light'])` guard on the `.v2-button[data-approve='blocked']` rule; verify a blocked Approve computed background/ink is the theme's blocked recipe in both themes
- [x] 3.4 Update the token tests in `packages/ui/src/test/v2theme.test.ts`: assert the approve inverse pair (a dark fill with white ink in light, a near-white fill with dark ink in dark, no hue, each ink passing a contrast check), the new review-clean values, and a same-hue assertion (a shared helper converting to HSL and comparing hue within a few degrees) for every `--status-*`, `--diff-*`, `--project-*` pair; verify `pnpm --filter @weave-ai/ui test` is green
- [x] 3.5 Re-run the hue comparison over `index.css`, confirm the only remaining divergences are `--syntax-*`, and record the final table on the ticket

## 4. Verification and delivery

- [x] 4.1 Run `pnpm lint && pnpm typecheck && pnpm test` and paste both suite blocks verbatim on the PR; report which one any failure is in
- [x] 4.2 Verify the new semantic inks' contrast with a script (approve ink on its fill; review-clean on both grounds; blocked ink on its fill in both themes) and record the ratios in the report
- [x] 4.3 Capture rendered screenshots at desktop and phone width in both themes at the smallest, default and largest settings, plus a side-by-side of a user message and a weaver reply at one setting with their measured computed font sizes; attach them to this ticket with `weave_ticket_attachment_put` (not paths)
- [x] 4.4 Confirm the worktree is clean (`git status --porcelain` empty) and that nothing remains untracked under `work/`; record the durable finding (the type-scale multiplier and the two-hue tokens) in the project knowledge base
