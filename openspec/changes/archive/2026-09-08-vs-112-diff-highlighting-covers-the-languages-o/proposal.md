## Why

**Amendment (2026-09-08):** this proposal originally planned to replace a hand-rolled tokenizer at
`packages/render/src/highlight.ts` with `highlight.js`. That premise was written against VS-107's
branch as it stood on 2026-09-07 19:10. VS-107 itself was revised before it merged: its worker
received captain's steering in time after all, measured `highlight.js` against the hand-rolled
tokenizer, adopted it, and recorded that as ADR 0013 — landing on `main` as `packages/ui/src/lib/highlight.ts`,
covering C#, Rust, Java, PHP, C++, Go, Python, Ruby, Kotlin, Swift and XML via
`highlight.js/lib/common` (36 languages). This ticket's own acceptance criteria are therefore already
met in code. What is left, verified against `main` after VS-107 merged: the spec still describes the
old, narrower behavior, and two of the newly-supported languages have no test fixture. See `design.md`
for the verification and the residual scope.

Original why, for context: Captain (2026-09-07 18:38) asked for syntax highlighting beyond the
languages this workspace itself uses — C#, Rust, Java, HTML, PHP, JS, C++ and more — because Fernwood,
a C# and React codebase in this workspace, rendered mostly plain in the diff viewer VS-107 shipped.

## What Changes

- Broaden the `project-overview/pull-request-diff` spec's highlighting requirement from "the
  languages this workspace's repositories are written in" to name the languages `highlight.js/lib/common`
  already covers, since the code has covered them since VS-107 merged and the spec has not caught up.
- Add the two missing test fixtures (Go, Python, Ruby, Kotlin, Swift are all currently unmapped-to-a-
  test, despite being wired in `EXTENSIONS`) to `packages/ui/src/test/highlight.test.tsx`, closing
  acceptance criterion 6 ("tests cover a fixture line per newly supported language").
- No library adoption, no tokenizer rewrite, no new ADR: VS-107 / ADR 0013 already did that measured
  comparison and this proposal's `design.md` cites its numbers rather than re-measuring.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `project-overview/pull-request-diff`: the "Syntax highlighting for the languages this workspace
  uses" requirement is reworded to name the languages actually covered (C#, Rust, Java, PHP, C++, C,
  Go, Python, Ruby, Kotlin, Swift, XML, on top of VS-107's original list), documenting behavior that
  already ships rather than changing it.

## Impact

- `packages/ui/src/test/highlight.test.tsx`: five new fixture cases (go, python, ruby, kotlin, swift)
  for `languageForPath` and `highlightLine`.
- `openspec/specs/project-overview/pull-request-diff/spec.md`: one requirement's wording updated via
  this change's delta to match shipped behavior.
- No change to `packages/ui/src/lib/highlight.ts`, `packages/render`, or `docs/adr/` — all already
  correct as of VS-107 / ADR 0013.
