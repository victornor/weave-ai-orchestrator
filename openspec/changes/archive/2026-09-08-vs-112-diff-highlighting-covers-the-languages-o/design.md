## Context

**Amendment (2026-09-08), replacing this design in full:** the original version of this document
measured `highlight.js` against Shiki and an extended hand-rolled tokenizer, on the assumption that
neither VS-107's diff viewer nor its tokenizer used a grammar library yet. That assumption was correct
against VS-107's branch as read on 2026-09-07, and wrong against what VS-107 actually merged: its
worker revised the implementation before landing, adopted `highlight.js/lib/common` itself, and
recorded the decision as `docs/adr/0013-diff-syntax-highlighting-uses-highlight-js.md`. This worker sat
paused from 2026-09-07 19:21 to 2026-09-08 16:04 watching a file path (`packages/render/src/highlight.ts`)
that VS-107's real merge commit had already deleted — the conductor unblocked it with the facts. See
`proposal.md`'s amendment for the full account.

Verified against `main` after rebasing (commit range including `2e99569`, "VS-107: The PR explorer
shows the diff itself, file by file"):

- `packages/ui/src/lib/highlight.ts` loads `highlight.js/lib/common` lazily, on first use, never in
  the app's main bundle (`import('highlight.js/lib/common')`).
- Its `EXTENSIONS` table already maps every language this ticket's acceptance criterion 2 names: `cs`→
  csharp, `rs`→rust, `java`→java, `php`→php, `c`/`h`/`cpp`/`cc`/`cxx`/`hpp`→cpp, `go`→go, `py`→python,
  `rb`→ruby, `swift`→swift, `kt`/`kts`→kotlin, `html`/`htm`/`xml`/`svg`→xml — plus several this ticket
  did not ask for (scss, less, lua, perl, r, vbnet, graphql, ini).
- An unrecognised extension, and a highlight call before the bundle has loaded, both render as escaped
  plain text (`highlightLine`'s `if (!hljs || !lang || !hljs.getLanguage(lang))` branch) — never
  broken, satisfying acceptance criterion 3.
- Highlighting is applied to a line's own text and returns markup for that line alone; it has no path
  into diff parsing (`packages/render`'s `parseUnifiedDiff`), so it cannot affect line counts,
  add/remove markers or structure — satisfying acceptance criterion 4 by construction, not by a test
  this ticket needs to add (existing diff-parsing tests already cover structure, independent of
  highlighting).
- `docs/adr/0013-diff-syntax-highlighting-uses-highlight-js.md` already exists, already states the
  measured numbers (core 20.8 kB min / 8.6 kB gzip; core + 14 hand-picked languages 85.4 kB / 27 kB;
  core + `lib/common`'s 36 languages 160.3 kB / 54 kB, esbuild-measured, all lazy-loaded) and already
  explains why the hand-rolled tokenizer was dropped rather than kept beside the library — satisfying
  acceptance criteria 1 and 5. This design does not re-measure; VS-107's numbers are the answer to
  "decided on a measured comparison."
- `packages/ui/src/test/highlight.test.tsx` has fixture coverage for csharp, rust, java, php, cpp, xml,
  javascript and typescript (both `languageForPath` and a real `highlightLine` call through the loaded
  bundle) — but **not** for go, python, ruby, kotlin or swift, despite `EXTENSIONS` already mapping
  them. That is the one real gap against acceptance criterion 6.

## Goals / Non-Goals

**Goals:**
- Verify, with evidence, that this ticket's coverage, correctness, ADR and rendering-only
  requirements are already met — and say so rather than re-doing work that already shipped.
- Close the one genuine gap: test fixtures for the five languages that are wired but unverified.
- Update the spec's requirement text, which still describes the pre-ADR-0013 narrower behavior, to
  match what ships.

**Non-Goals:**
- Re-measuring or re-deciding the library choice (VS-107 / ADR 0013 already did, and nothing about
  that decision has changed).
- Adding languages beyond this ticket's named list (`lib/common` already carries several extras;
  documenting or exercising all of them is out of scope).

## Decisions

### Decision: treat VS-107 / ADR 0013 as authoritative; do not re-litigate or duplicate it

`packages/ui/src/lib/highlight.ts` and `docs/adr/0013-...md` are correct as they stand. Rewriting them
to match this ticket's original (now-obsolete) design would undo a decision already made with real
measurements, for no behavioral gain. The only defensible remaining work is closing the verifiable gap
(tests) and the documentation gap (spec wording).

### Decision: add missing fixtures in the same style as the existing ones, not a new test file

`highlight.test.tsx` already has an `it.each` table for `languageForPath` and a real-bundle
`it.each` loop for `highlightLine`. Go, Python, Ruby, Kotlin and Swift extend both tables with one
line each, matching the existing pattern (a representative source line, asserted to reconstruct
losslessly through `highlightLine` and to contain at least one `hljs-*` class), rather than a parallel
test structure.

### Decision: reword, don't restructure, the spec requirement

The live requirement ("Syntax highlighting for the languages this workspace uses") already has the
right header and shape for what ADR 0013 shipped; only its body undersells the actual coverage. The
delta keeps the header and both existing scenario headers verbatim (MODIFIED requirement rules) and
only reworks the requirement's prose to name the language list, matching `EXTENSIONS`.

## Risks / Trade-offs

- **Spec names a fixed list; `EXTENSIONS` may drift from it later.** Not a new risk this change
  introduces — the same is already true of the current, narrower spec text. Left as-is.
- **This design was substantially rewritten mid-ticket.** Documented explicitly (this section, and
  `proposal.md`'s amendment) rather than silently replacing the approved plan, so a reader of the
  change's history sees why the shape of the work changed after approval.

## Migration Plan

1. Add the five missing test fixtures.
2. Update the spec delta's wording (already drafted; verify it still matches the live spec's exact
   header/scenario text after the rebase — it does, unchanged by VS-107's merge).
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Deliver: PR describing the amendment plainly (what was originally planned, what was found on
   rebase, what actually shipped in this PR) so a reviewer is not surprised by how small the diff is.

## Open Questions

(none)
