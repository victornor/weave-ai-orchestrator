## 1. Preserve the option through the runtime change

- [x] 1.1 In `WorkerOptionRow` (`packages/ui/src/routes/Settings.tsx`), change the runtime select's
      `onChange` to spread the option it is editing — `patch({ ...option, runtime, model: runtime ==
      null ? null : option.model })` — instead of rebuilding it from `id` and `description`. Verify
      by reading the expression and confirming `effort` is no longer named-and-dropped.
- [x] 1.2 Audit every other control in `WorkerOptionRow` for the same pattern — the model select,
      the free-text model id input, and the picker/free-text thinking-level controls. Confirm each
      already spreads (`{ ...option, … }`); record that the runtime select was the only offender so
      the fix stays confined to it. Verify by reading each `onChange`.

## 2. Prove it with a regression test

- [x] 2.1 Add a test to `packages/ui/src/test/models.test.tsx` that seeds a worker option carrying
      `effort: 'high'`, changes the option's runtime, and asserts the saved catalog still carries
      `effort: 'high'` alongside the new runtime. Verify the test **fails** against the pre-change
      code before applying 1.1 (run it with the fix reverted), then passes after.

## 3. Full verification

- [x] 3.1 Run `pnpm lint`, `pnpm typecheck`, and both test suites (the core/server run and
      `pnpm --filter @weave-ai/ui exec vitest run`), and record every total verbatim in the ticket's
      delivery comment — never add the two figures together, never retype them from memory.
