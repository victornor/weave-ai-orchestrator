# Design — openspec-spec-purpose

## Context

`openspec archive` builds a main spec for each capability a change creates. If the change's delta
carried no `## Purpose`, it writes `TBD - created by archiving change <name>. Update Purpose after
archive.`. Nothing the daemon runs afterwards replaces it, so 24 specs on `main` still carry it and
`openspec validate --all --strict` fails repo-wide. The same generator runs on every future archive,
so the backlog grows by one per new capability.

OpenSpec 1.12.0 (the pinned version) already reads a delta's `## Purpose` and carries it into the
new main spec — `buildSpecSkeleton(specFolderName, changeName, purpose)` in
`@fission-ai/openspec/dist/core/specs-apply.js` uses `purpose?.trim() || placeholder`. So both halves
are possible without patching the CLI: author the Purpose where archive can find it, and fill it
after the fact when an older change did not.

## Decisions

### 1. Fill from the proposal "Why", and fail only when there is nothing to fill from

The ticket offers two endings for a placeholder the archive just created: fill it from the archived
change's proposal "Why", or fail the archive step with an actionable message. We do both, in that
order: fill when the proposal has a usable "Why" paragraph, and fail only when it does not.

Why not fail on every placeholder: the Purpose is a prose summary derivable from the proposal the
change already had to write (`MIN_WHY_SECTION_LENGTH` is enforced at propose time), so failing a
merge over it would block landing for a value the daemon can usually supply itself — the same class
of avoidable worker round-trip the archive-then-merge sequence exists to remove (VS-327). Why not
fill silently when there is nothing to fill from: that is exactly how the 24 placeholders persist
today, so the fallback must be a hard, named failure, never a placeholder that ships.

The failure reuses the existing archive-failure path: `attemptArchiveThenMerge` already rejects the
landing request when `archiveOnBranch` throws, and the backfill already records and surfaces a
failure — so a missing "Why" needs no new plumbing, only the right `OcError` and message.

### 2. One shared helper, used by both archive paths

Both places that archive a change call a new leaf helper in `packages/core/src/openspec/purpose.ts`:

- `findPlaceholderPurposeSpecs(specsRoot)` — every `spec.md` under a `openspec/specs` tree whose
  Purpose still contains the placeholder sentence, matched from the sentence's two fixed halves
  (`TBD - created by archiving change ` … `. Update Purpose after archive.`) so a later wording
  change is a one-line edit rather than a second spelling that silently stops matching.
- `fillArchivedCapabilityPurposes(clonePath, changeName)` — after an archive, finds the placeholder
  specs whose embedded change name is this change, reads the archived proposal's first "Why"
  paragraph, writes it into each, and returns what it filled; throws `openspec_archive_blocked`
  with the capability names when there is a placeholder and no usable "Why".

The two archive call sites (`archiveOnBranch`, `archiveAfterMerge`) differ only in where they run and
when they commit, so a shared helper is what keeps the merge path and the backfill from drifting.

### 3. The guard is a test in the core suite, not a new lint script

The repository already runs `pnpm lint` and `pnpm exec vitest run` as separate required checks. The
guard is a vitest test under `packages/core/src/openspec/` because it can then be exercised against
a fixture directory as directly as against the checkout: one test scans the real `openspec/specs`
tree (via `new URL('../../../../openspec/specs', import.meta.url)`) and must find nothing, and one
writes a fixture spec containing the placeholder and asserts the scan reports it. A `scripts/*.mjs`
lint guard would have to duplicate the scanner or shell out to a test to prove the failure case.

The scan is pure and takes the `openspec/specs` root as an argument; it never reaches into
`openspec/changes/`, so it does not trip `scripts/guard-test-fixtures.mjs` and does not depend on a
change folder that moves on archive.

### 4. The guidance lands in the OpenSpec skill, where propose reads it

`skills/weave-ai-openspec/SKILL.md` is the text a worker follows while proposing. Its Propose section
gains the rule that a new capability's `## Purpose` goes in the change's delta, because that is the
one place archive reads it. This is also the first delta in this repo to carry a `## Purpose` itself.

### 5. Backfill reads the archived change's own proposal

For each of the 24 specs, the placeholder names the change that created it, and that change (with its
proposal "Why") is still under `openspec/changes/archive/<date>-<name>/`. The backfill writes a
Purpose from the originating "Why" where it reads well as a standalone Purpose, and otherwise from
the spec's own requirements, in present tense. It does not invent behavior the requirements do not
state.

## Test plan

- `purpose.test.ts` — placeholder detection (positive/negative/near-miss), "Why" extraction from a
  proposal, fill into a temp tree, and the throw when a placeholder exists with no usable "Why".
- Guard test — the scanner returns the fixture spec that carries the placeholder and returns nothing
  for authored Purposes; the repo scan over the real `openspec/specs` is empty.
- `archive-before-merge.test.ts` — archiving a change that creates a capability leaves no placeholder
  (proposal with a "Why"), and archiving a placeholder-creating change with no "Why" throws without
  committing.
- `service.test.ts` / supervisor tests — the backfill path fills on the local-branch path; the
  pull-request path's committed spec carries a real Purpose.

## Non-goals

- No change to the `openspec` CLI or to `.openspec.yaml`.
- No retroactive edit of changes already archived.
- The 24-file backfill is content, not behavior; it is covered by the guard rather than by a test of
  its own.
