## 1. Fix `packages/render`'s `DEFAULTS` table

- [x] 1.1 In `packages/render/src/decision.ts`, replace `merge_approval`'s `DEFAULTS` entries
      (`approve`/`hold`) with `approve`/`changes` (label "Request changes", description "Send it back
      to the worker."), removing `hold` with no replacement — verify by reading the updated table
      against `NAMED_CARD_OPTION_KEYS.merge_approval`.
- [x] 1.2 Replace `hire_approval`'s `DEFAULTS` key `hire` with `approve`, keeping the "Hire" label and
      tone — verify against `NAMED_CARD_OPTION_KEYS.hire_approval`.
- [x] 1.3 Replace `discard_approval`'s `DEFAULTS` keys `discard`/`keep` with `approve`/`reject`,
      keeping the "Discard"/"Keep" labels and the `danger` tone on `approve` — verify against
      `NAMED_CARD_OPTION_KEYS.discard_approval`.

## 2. Regression test against the canonical key map

- [x] 2.1 In `packages/render/src/decision.test.ts` (or a new `decision.defaults.test.ts`), import
      `NAMED_CARD_OPTION_KEYS` from `@agent-conductor/shared` and add a test asserting, for each of
      `plan_approval`, `merge_approval`, `hire_approval`, `discard_approval`, that `DEFAULTS[variant]`'s
      keys equal `Object.values(NAMED_CARD_OPTION_KEYS[variant])` in order — verify with
      `pnpm vitest run packages/render`, and confirm the test fails against the pre-fix table (revert
      task 1's edit locally, observe the failure, then reapply).
      Done as a test that feeds `decisionToCard` each variant's exact production `options` (rather than
      reaching into the unexported `DEFAULTS` table) and asserts the resulting card's keys — confirmed
      to fail against the pre-fix table (`git stash` on `decision.ts` alone, ran the suite, saw 4
      failures including this one, `git stash pop` to restore).

## 3. Update the existing golden tests

- [x] 3.1 Update the `merge_approval` case in `packages/render/src/decision.test.ts` (`'renders a
      merge approval with PR, CI, diff and files'`) so it no longer asserts a `Hold` option; assert
      the options are `Approve merge` / `Request changes` instead — verify with
      `pnpm vitest run packages/render`.
- [x] 3.2 Update the `hire_approval` case (`'renders a hire approval with Hire / Reject plus runtime
      switch options'`) so the expected key list is `['approve', 'reject', 'switch:codex']` instead of
      `['hire', 'reject', 'switch:codex']` — verify with `pnpm vitest run packages/render`.
- [x] 3.3 Re-run the `discard_approval` case (`'renders a discard approval as destructive with typed
      confirmation'`) and confirm it still passes unchanged (it asserts tone and destructive framing,
      not the key directly) — if it does not, adjust it to expect `approve` as the first option's key.
      Added an explicit key assertion (`['approve', 'reject']`) rather than leaving it implicit.

## 4. Full verification

- [x] 4.1 Run `pnpm typecheck && pnpm lint && pnpm test` from the repo root and confirm all green,
      including `packages/render`'s full suite and the rest of the monorepo (no regression to
      `packages/tui`, `packages/core`, or `packages/ui`, none of which are touched by this change).
      All green: typecheck clean, lint clean (boundaries + console), core suite 1589 passed / 1
      skipped, ui suite 912 passed.
