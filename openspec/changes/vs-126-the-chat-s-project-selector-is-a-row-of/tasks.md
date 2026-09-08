## 1. The selectable tag primitive

- [x] 1.1 Add a `ProjectTag` component to `packages/ui/src/components/Chips.tsx`: same shell
      classes as `WorkerChip`/`TicketChip`, an `active` boolean rendered with the `StatusPill`
      active/inactive colour pair (`border-accent-edge bg-accent-tint text-accent-link` vs
      `border-line-2 text-text-3`), rendered as `role="radio"` with `aria-checked`. Verify with a
      focused render test asserting the two visual states and the `role`/`aria-checked` pair.

## 2. The strip

- [x] 2.1 Rewrite `ProjectPicker` in `packages/ui/src/routes/Chat.tsx:791-819` to render a
      `role="radiogroup"` strip (`aria-label="Project for this message"`) with an Auto tag first
      (`value: null`) followed by the existing `choosable` projects, each a `ProjectTag`; keep the
      `choosable`/`orphan` selection logic unchanged. Verify `pnpm typecheck` and a manual render
      show the same set of offered projects as before (including the orphan case).
- [x] 2.2 Make activating the already-active tag a no-op (or route it back to Auto) instead of
      re-selecting the same project. Verify with a test that clicks the active project's tag twice
      and observes no change (or a return to Auto) rather than a duplicate selection call.
- [x] 2.3 Give the strip container `overflow-x-auto` and each tag `shrink-0`, so it scrolls
      horizontally instead of wrapping, and confirm in the browser at a phone width (375px) with
      enough projects to overflow — state the number tested in the PR description.
- [x] 2.4 Scroll the active tag into view on mount with a ref + `scrollIntoView({ block: 'nearest',
      inline: 'nearest' })`, stubbing `HTMLElement.prototype.scrollIntoView` in the test the way
      `chat.test.tsx`'s transcript-autoscroll tests already do, and assert it is called when the
      strip mounts with a pre-selected project.

## 3. Tests

- [x] 3.1 Rewrite the `describe('project context', ...)` block in
      `packages/ui/src/test/chat.test.tsx:564-657` against the new tag markup (query by role
      `radio`/name instead of `<option>`), preserving every existing behavioural assertion:
      offered projects, the archived-orphan case, empty-workspace Auto-only, default-from-thread,
      sending with a chosen project vs. Auto, offline queuing, and messages rendered with/without
      their carried project.
- [x] 3.2 Add a test for the new activate-active-tag-is-a-no-op behaviour (task 2.2) and a test for
      scroll-into-view on mount with a pre-existing selection (task 2.4).
- [x] 3.3 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all are green.

## 4. Delivery

- [x] 4.1 Capture PR screenshots: desktop width with a project selected, desktop width with Auto
      selected, and phone width showing the strip overflowing (scrollable) with the tested project
      count noted in the PR description.

## 5. Reset to Auto after every send (captain, added after plan approval)

- [x] 5.1 In `Chat.tsx`'s `send()`, reset the draft's `projectId` to `null` (not `undefined`) at
      both points it already resets `replyToId` to `null` — the offline-queue branch and after the
      normal `post.mutate` call — so the reset applies whether the send resolves immediately or is
      queued, and pins the picker to Auto rather than falling back to the thread's last-used
      project. Verify `pnpm typecheck`.
- [x] 5.2 Confirm the mount-only scroll-into-view effect (task 2.4) does not re-fire when the
      selection is cleared by a reset — no new code should be needed if the effect's dependency
      array is genuinely mount-only.
- [x] 5.3 Tests: sending with a project selected leaves the strip on Auto and the next message
      carries no project unless re-picked; the same after an offline-queued send; and a reload
      after sending does not restore the cleared selection (`chat.test.tsx`).
