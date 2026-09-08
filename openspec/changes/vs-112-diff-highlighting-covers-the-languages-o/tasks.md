## 1. Verify what already shipped (amendment, 2026-09-08)

- [x] 1.1 Rebase onto `main` now that VS-107 has merged; confirm `packages/ui/src/lib/highlight.ts`,
      `docs/adr/0013-diff-syntax-highlighting-uses-highlight-js.md` and the deleted
      `packages/render/src/highlight.ts` all match the design's account. Verified: rebase clean,
      all three confirmed via `git show origin/main:<path>`.
- [x] 1.2 Confirm `EXTENSIONS` in `packages/ui/src/lib/highlight.ts` already maps every language this
      ticket's acceptance criterion 2 names (C#, Rust, Java, PHP, C++, C, Go, Python, Ruby, Kotlin,
      Swift, XML). Verified: all present (see `design.md`).

## 2. Close the test gap

- [x] 2.1 Add `languageForPath` fixture cases for `.go`, `.py`, `.rb`, `.swift`, `.kt` to
      `packages/ui/src/test/highlight.test.tsx`'s existing `it.each` table; verify
      `pnpm --filter @agent-conductor/ui exec vitest run src/test/highlight.test.tsx` passes.
      Verified: 45/45 pass.
- [x] 2.2 Add `highlightLine` fixture lines for go, python, ruby, kotlin, swift to the existing
      "once the real grammar bundle is loaded" `it.each` loop, asserting each reconstructs its
      original text losslessly and contains an `hljs-*` class; verify the same test run passes.
      Verified: included in the 45/45 above.

## 3. Documentation

- [x] 3.1 The spec delta (`specs/project-overview/pull-request-diff/spec.md`) already names the full
      language list against the live requirement's exact header and scenario headers; verify with
      `openspec validate vs-112-diff-highlighting-covers-the-languages-o --json --strict` that the
      delta is now accepted with no INFO about a missing target (VS-107's capability exists on `main`
      now). Verified: `"valid": true, "issues": []`.

## 4. Verify

- [x] 4.1 Run `pnpm typecheck && pnpm lint && pnpm test` from the repo root and confirm all green.
      Verified: typecheck clean, lint clean, core suite 125 passed/1 skipped, ui suite 969/969 passed,
      exit code 0. Two unrelated timing-sensitive tests (`dictation.test.tsx`, `runtime-sdk/process.test.ts`
      — neither touched by this change) flaked once each under full-suite CPU load and passed
      consistently in isolation and on a clean full re-run; not caused by this change.
- [x] 4.2 PR description states plainly: what this ticket originally planned, what was found already
      shipped by VS-107 / ADR 0013 on rebase, and that the delivered change is the test-coverage and
      spec-wording gap only — not a library adoption.
