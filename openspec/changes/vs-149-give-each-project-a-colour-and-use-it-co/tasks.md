## 1. Palette and the deterministic assignment function

- [x] 1.1 Add `--project-1` … `--project-5` custom properties to `packages/ui/src/index.css` in
      both `[data-theme='dark']` and `[data-theme='light']` blocks, next to the existing
      `--status-*` tokens, using the draft hex from `design.md` as a starting point. Verify by eye
      against the existing `--status-*`/`--accent` swatches in both themes that none reads as the
      same colour family; adjust any that don't hold up (see task 5.2 for the real in-browser
      confirmation).
- [x] 1.2 Add `packages/ui/src/lib/projectColor.ts`: a `PALETTE` array of the five CSS var names
      (or the theme-keyed hex pairs, whichever the chosen surfaces need), and
      `projectColorVar(id: string): string`, hashing the id the same way
      `packages/ui/src/lib/graph/simulation.ts`'s `angleOf` does (FNV-1a-style fold, no
      `Math.random`), mod `PALETTE.length`, returning `var(--project-N)`. Verify with a unit test
      (`packages/ui/src/test/projectColor.test.ts`, new) asserting: the same id returns the same
      value on repeated calls; a small set of distinct real-looking ids do not all collide on the
      same index (assert more than one distinct value across e.g. 5 different ids); the function
      is pure (no globals, no `Date`/`Math.random`).

## 2. Sidebar

- [x] 2.1 In `WorkspaceNav.tsx`'s `ProjectsGroup`, add a small colour dot for `p.id` via
      `projectColorVar`, placed between the existing sync-dot slot and the slug text, present for
      every project regardless of sync state — the existing sync dot (or its empty placeholder
      span) is unchanged. Verify with `workspacenav.test.tsx`: a project's row carries a style/dot
      whose colour is a pure function of its id, and the existing sync-dot assertions still pass
      unchanged.
- [x] 2.2 Confirm in the browser (screenshot, per task 5.1) that the sidebar with 3+ projects shows
      each with a visually distinct dot, and that a `behind`/`diverged` project shows both its sync
      marker and its colour dot together.

## 3. Chat's project picker

- [x] 3.1 Add a colour dot to `ProjectTag` in `packages/ui/src/components/Chips.tsx`: an optional
      `colorVar?: string` prop (undefined renders no dot, for the Auto tag), rendered before the
      label, visible in both the active and inactive style. Verify with a focused render test
      (`components.test.tsx` or a new block) asserting the dot is present when `colorVar` is given
      and absent when it is not, in both `active` states.
- [x] 3.2 In `Chat.tsx`'s `ProjectPicker`, pass `projectColorVar(p.id)` to each project's
      `ProjectTag` and nothing to the Auto tag. Verify `pnpm typecheck` and the existing
      `chat.test.tsx` project-context tests still pass.

## 4. Dispatch labels and worker chips

- [x] 4.1 Add an optional `projectColorVar?: string` prop to `DispatchLabel`
      (`packages/ui/src/components/DispatchLabel.tsx`), rendered as a small dot immediately after
      the `StatusGlyph`, before the identifier text; absent when not given. Verify with
      `components.test.tsx`: a `DispatchLabel` rendered with the prop shows the dot, without it
      shows none.
- [x] 4.2 Add the same optional `projectColorVar?: string` prop to `WorkerChip`
      (`packages/ui/src/components/Chips.tsx`), same placement relative to its `StatusGlyph`.
      Verify the same way as 4.1.
- [x] 4.3 In `Chat.tsx`, pass `d.ticket.projectId ? projectColorVar(d.ticket.projectId) :
      undefined` to each `DispatchLabel`, and `w.projectId ? projectColorVar(w.projectId) :
      undefined` to each unattributed `WorkerChip`. Verify `pnpm typecheck`, and extend
      `chat.test.tsx` with a case asserting a dispatch for a project-bound ticket shows a colour
      dot and one for a project-less ticket shows none.

## 5. Verification and delivery

- [x] 5.1 Run the app against a throwaway daemon (never the live workspace — see
      `agent-conductor-worker`'s credential rule) with at least three real projects, and capture
      screenshots in both themes at phone width and wide: the sidebar, the chat composer's project
      tags, and a chat view showing at least one dispatch label and one worker chip together with
      the sidebar's colours, confirming the same project reads as the same colour across all three
      surfaces.
- [x] 5.2 From that same session, confirm by eye that no project colour is confusable with any
      `--status-*` token or `--accent` in either theme, and that no two of the five palette entries
      look alike; adjust the hex values in `index.css` (task 1.1) if any pairing doesn't hold up,
      re-verify, and note in the PR description exactly what was checked and changed.
- [x] 5.3 Run `pnpm lint && pnpm typecheck && pnpm test`, confirm all green.
- [x] 5.4 Open the PR, describing: the VS-131 regression finding from `proposal.md` (and that it is
      not being reverted), the palette and its hex values as finally verified, and the screenshot
      set from 5.1.
