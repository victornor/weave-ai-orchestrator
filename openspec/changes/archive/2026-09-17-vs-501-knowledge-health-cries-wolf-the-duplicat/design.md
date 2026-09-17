## Context

The existing bounded sweep in `packages/core/src/knowledge/service.ts` gathers every bullet entry,
then calls `similarity()` with its whole-string containment shortcut. A one-word entry such as
`**Status:**` therefore receives 0.95 when it is contained by unrelated prose. The same entry model
also includes hub index lines in both `Landmines` and `Documents`, while `health()` treats every
zero-backlink linked document as an orphan. See the proposal and the two modified specs for the
observable behavior.

## Goals / Non-Goals

**Goals:**

- Make the existing report-only duplicate sweep bounded and useful on the real knowledge corpus.
- Preserve write-time duplicate rejection and the existing duplicate threshold and result shape.
- Centralize the definitions of a meaningful duplicate candidate, a hub pointer, and an explicit
  redirect so health and sweep behavior cannot drift.
- Keep the health wake cadence, signature, cooldown, and payload contract unchanged apart from the
  filtered issue set.

**Non-Goals:**

- No semantic/embedding similarity, corpus-wide deduplication, automatic merge, or content rewrite.
- No new redirect metadata field or user-facing setting; existing documents are recognized from an
  explicit moved-to pointer already present in their content.
- No changes to stale, never-read, unresolved-link, budget, or curation scheduling behavior.

## Decisions

### D1 — Filter candidates before the bounded comparison

Add shared helpers/constants in `packages/core/src/knowledge/files.ts`: a two-word minimum and a
12-character (excluding whitespace) minimum, plus a predicate for hub section pointers. Apply these
filters while collecting `entriesOf()` in `duplicates()`, before the 1500-entry cap. This means the
bound is spent on actionable entries instead of being consumed by boilerplate and makes the real
`**Status:**` report impossible. Two words is the lowest compatible floor because the existing
knowledge corpus contains a genuine two-word near-duplicate; the character floor catches similarly
contentless punctuation variants.

Hub pointers are recognized only for hub files (`!isDocPath(path)`) and only when the entry text
starts with a bare or piped `[[slug]]` followed by an optional one-line-summary separator (`—`, `:`,
or `-`). A normal hub note and all document entries remain eligible.

### D2 — Make containment behavior explicit for sweep comparisons

Extend the existing `similarity()` helper with an internal option controlling its containment
shortcut. Write-time checks continue using the current default, preserving their protection against
short restatements. The duplicate sweep passes `containment: false`, so it uses the existing
normalization and Dice word-bigram comparison but never awards 0.95 merely because one string is
inside another. The sweep still uses `DUPLICATE_THRESHOLD` (0.8), and its public report remains
`{ pairs, scanned, capped }`.

This keeps the established write-time contract while fixing the detector at the point where the
false positive occurs. Replacing the global similarity function was rejected because it would make a
precision change to note and document writes that this ticket does not require.

### D3 — Recognize redirects by an explicit moved-to marker

Add an `isRedirectStub(body)` helper that extracts a target slug from the first `#` heading when it
contains the explicit form `moved to [[target-slug]]` (case-insensitive). This matches the real
`design-contract` document title, `# Design contract — moved to [[design-design-contract]]`, while
not classifying an ordinary document that merely happens to contain a wiki link. The helper can
also accept the equivalent explicit one-line `the real document is [[target-slug]]` form when it is
the document's only non-heading body line, covering simple future redirect stubs without a marker
in the title.

`health()` filters these documents only from `orphans`; they remain visible in the document
catalogue, link graph, unresolved-link checks, and stale/never-read measures. The redirect target
must be a syntactically valid document slug, and the helper is purely textual/read-only.

### D4 — Keep health issue accounting downstream of the filters

`knowledgeHealthPass()` continues to build its signature from `health()` and the `duplicates()`
report. Because `health()` no longer returns redirect orphans and `duplicates()` no longer returns
short/pointer pairs, no supervisor-specific exception list is needed. Existing first-sweep,
new-issue, persistence, cooldown, and threshold behavior remains intact; a filtered result produces
no signature key, so an otherwise empty sweep produces no wake.

## Risks / Trade-offs

- [Risk] A deliberately short but meaningful note may fall below the candidate floor → [Mitigation]
  keep the floor at two words/12 non-whitespace characters, preserve write-time checks, and test the
  real two-word near-duplicate case.
- [Risk] A document title could use “moved to” in a non-redirect context → [Mitigation] require the
  same heading to contain a valid `[[slug]]` target; only explicit redirect wording opts out of the
  orphan measure.
- [Risk] Removing containment from the sweep could miss a genuine short restatement → [Mitigation]
  retain the existing threshold and bigram comparison, and verify the real gateway retry pair with
  a shared substantive phrase remains reported.
- [Risk] Filtering before the cap changes which entries are scanned relative to VS-492 → [Mitigation]
  expose the existing `scanned`/`capped` fields and preserve the fixed 1500-entry maximum and pair
  cap.

## Migration Plan

No data migration is required. Deploying the code immediately changes only on-read health results and
future sweep reports; stored files, revisions, links, and supervisor metadata remain compatible.
Rollback is a code rollback, which restores the prior classification without rewriting knowledge.
