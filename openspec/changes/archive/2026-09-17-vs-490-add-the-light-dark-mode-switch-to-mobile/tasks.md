## 1. The switch in the phone More sheet

- [x] 1.1 Pass `theme` and `onTheme` into `MoreList` and render the existing `ThemeSwitch` in its
      `expanded` variant, in a labelled footer row of the More sheet next to the existing `Open V1`
      link, wired to the same props the rail footer uses.
      Verify: `V2Shell.tsx` renders one `ThemeSwitch` in the More sheet; no new theme state, hook or
      storage key is introduced.
- [x] 1.2 Update the `themeControl === 'note'` copy in `settings/sections.tsx` so it names the phone
      surface as well as the rail footer.
      Verify: the note no longer points a phone user at a control their layout does not show.

## 2. Tests

- [x] 2.1 Add a `v2shell.test.tsx` test that opens the More sheet, asserts it carries the light/dark
      switch, and that clicking `Light theme` reports `light` through the shell's `onTheme` — the same
      callback the rail test uses.
      Verify: the test fails on current `main` (no switch in the sheet) and passes after 1.1.
- [x] 2.2 Confirm the persistence contract is unchanged: `v2theme.test.ts` still shows
      `weave.v2.theme` round-trips and `conductor.theme` is never written, and the rail's own switch
      test still passes.
      Verify: UI suite green, with no second key added anywhere.

## 3. Rendered evidence

- [x] 3.1 Capture the More sheet at phone width (390) in dark and light, showing the control and the
      resulting theme, using the no-daemon harness from `[[ui-screenshot-harness]]` (real app, stubbed
      `fetch`/`EventSource`, seeded `weave.v2.theme`). Also capture a light-themed page behind the
      sheet to show the mobile surfaces around the switch render legibly.
      Verify: open each capture and confirm it shows the switch in the expected state and a legible
      light/dark surface, not merely that the button exists.
- [x] 3.2 Publish the captures as a ticket artifact with `weave_ticket_artifact_put`; keep the files
      outside `work/` and commit no binaries.
      Verify: the artifact URL is recorded as a work product and `git status --porcelain` is empty.

## 4. Checks and delivery

- [x] 4.1 `pnpm lint && pnpm typecheck && pnpm test` green; paste both suite blocks verbatim in the
      PR with their own counts.
      Verify: both blocks shown, neither suite's numbers presented for the other.
- [x] 4.2 Open the PR, deliver to `in_review`, and request landing when approved.
      Verify: PR URL recorded; transition accepted.
