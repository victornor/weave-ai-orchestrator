## 1. Sidebar slug colour

- [x] 1.1 In `packages/ui/src/app/WorkspaceNav.tsx` `ProjectsGroup`, delete the project-colour
      `rounded-full` span. Apply `style={{ color: projectColorVar(p.id, siblingIds) }}` and
      `data-project-color` on the slug span. Leave the sync-state slot unchanged. Verify
      `workspacenav.test.tsx`: `colourOf` reads the slug's inline `color` (not a sibling's
      `background`); existing sync-dot assertions still pass.

## 2. Composer tags, dispatch labels, worker chips

- [x] 2.1 In `packages/ui/src/components/Chips.tsx` `ProjectTag`, delete the colour circle. Apply
      `color: colorVar` and `data-project-color` on the label span when `colorVar` is set. When
      `colorVar` is set, do not apply `text-accent-link` on the active tag (keep
      `border-accent-edge bg-accent-tint`). Auto (no `colorVar`) keeps today's text classes.
      Verify `components.test.tsx`: with `colorVar`, the radio's `[data-project-color]` style
      contains the var as `color` and there is no `rounded-full` child; without it, no
      `[data-project-color]`; both `active` states.

- [x] 2.2 In `DispatchLabel.tsx`, delete the colour circle. Apply `color: projectColorVar` and
      `data-project-color` on the ticket identifier span when the prop is set. Leave `StatusGlyph`
      and the name/status text unchanged. Verify `components.test.tsx`: with the prop, identifier
      colour is the var and there is no circle; without it, no `[data-project-color]`.

- [x] 2.3 In `WorkerChip`, delete the colour circle. Apply `color: projectColorVar` and
      `data-project-color` on the name span when the prop is set. Leave `StatusGlyph` unchanged.
      Verify `components.test.tsx` the same way as 2.2.

- [x] 2.4 In `chat.test.tsx`, retarget the project-bound dispatch assertion from a circle's
      `background` onto the identifier's `color` (`projectColorVar('p1', ['p1'])`), and keep the
      project-less dispatch showing no `[data-project-color]`. Existing `ProjectPicker` tests
      still pass. Verify
      `pnpm --filter @agent-conductor/ui exec vitest run src/test/chat.test.tsx src/test/components.test.tsx src/test/workspacenav.test.tsx`.

## 3. Sweep and delivery

- [x] 3.1 Grep `packages/ui/src` for `data-project-color` and `rounded-full` next to
      `projectColorVar`. No project-colour circle remains. `projectColor.ts` is untouched.
      Verify the grep is empty of circles and `pnpm --filter @agent-conductor/ui exec vitest run src/test/projectColor.test.ts` still passes.

- [x] 3.2 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all are green.
