## 1. Restore the V2 root paint rule

- [x] 1.1 Re-add the `.v2-root` base rule in `packages/ui/src/index.css` (`background: var(--bg-0)`,
      `color: var(--text-1)`, and the base typography it carried), placed with the theme section.
      Verify: the rule is present and `git diff` shows the declaration set from the deleted
      `packages/ui/src/v2/v2.css`.
- [x] 1.2 Correct the merged stylesheet's header comment so it no longer implies the root has no
      paint rule. Verify: comment describes tokens-keyed-on-`data-theme` plus the `.v2-root` paint rule.

## 2. Regression test

- [x] 2.1 Add a stylesheet-source test (new `packages/ui/src/test/` file, same parse-the-CSS
      pattern as `themeTokenInline.test.ts`) asserting a `.v2-root` rule declares
      `background: var(--bg-0)` and `color: var(--text-1)`, and that the light tokens are keyed
      `[data-theme='light']`. Verify: `git stash` the CSS fix, run the test and see it fail on
      current `main`'s stylesheet; restore the fix and see it pass.
- [x] 2.2 Confirm the existing `toast.test.tsx` "stays transparent itself" contract still passes with
      the restored rule. Verify: UI suite green.

## 3. Rendered evidence

- [x] 3.1 Build the app (`pnpm build`, then `pnpm --filter @weave-ai/ui build`) on a source-built
      scratch daemon (own `--config-dir`, loopback port other than 7433), and capture Chat, Work and
      Settings in light and dark at 1440, plus light at 390, using the headless-chromium harness
      from `[[ui-screenshot-harness]]`. Verify: captures exist outside `work/` and show light grounds.
- [x] 3.2 Comparison shot. 9c7a9ed557 was not built (the previous release shares the working light
      path with the fix, so it is not the discriminating before); instead captured current main's
      light Chat under the same config, which is the exact regression. Verify: main computes a
      transparent `.v2-root` with near-white ink, the fix computes `#f7f8f9` / dark ink.
- [x] 3.3 Publish the captures as a ticket artifact with `weave_ticket_artifact_put`. Verify: the
      artifact URL is recorded as a work product; no binaries are committed.
- [x] 3.4 Stop the scratch daemon by its recorded PID only, and leave the worktree clean
      (`git status --porcelain` empty). Verify: `ps -o pid,cmd -p <pid>` gone; no leftovers.

## 4. Checks and delivery

- [x] 4.1 `pnpm lint && pnpm typecheck && pnpm test` green; paste both suite blocks verbatim in the
      PR. Verify: both blocks shown with their own counts.
- [x] 4.2 Real green CI on the self-hosted runner for the exact head, with no GitHub-hosted jobs.
      Verify: check-run status on the head sha is green.
- [x] 4.3 Open the PR, deliver to `in_review`, and request landing when approved. Verify: PR URL
      recorded; transition accepted.