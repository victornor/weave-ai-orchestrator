## 1. Component

- [x] 1.1 In `packages/ui/src/components/RuntimeCredentials.tsx`, delete the `until()` countdown
      helper and the healthy-row's right-aligned "expires X" / "no expiry" span; keep `at()` and the
      `lastVerifiedAt` evidence line unchanged. Drop the now-unused `now` prop from `RuntimeCredentials`
      and `Row`. Verify with `pnpm --filter @agent-conductor/ui exec tsc --noEmit` (no unused-prop or
      dead-code errors) and a visual read of the diff against `design.md` - Decisions.

## 2. Tests

- [x] 2.1 In `packages/ui/src/test/usage.test.tsx`, update `'shows a valid credential with when it
      expires'` to assert the row shows `valid` and `last verified`, and does NOT contain `expires` or
      a countdown string; rename it to describe the healthy state. Add a case for a healthy credential
      with `lastVerifiedAt: null` asserting neither a countdown nor a last-verified line renders. Leave
      `'shows an expired login...'` and the `'renders nothing when no credential state is known'` cases
      untouched. Verify with `pnpm --filter @agent-conductor/ui exec vitest run src/test/usage.test.tsx`.
- [x] 2.2 Drop `now={NOW}` from the `RuntimeCredentials` test call sites in the same file now that the
      prop is gone, and confirm the full suite still passes:
      `pnpm --filter @agent-conductor/ui exec vitest run`.

## 3. Verify

- [x] 3.1 Run `pnpm typecheck`, `pnpm lint`, `pnpm test` at the repo root and confirm all three are
      green.
