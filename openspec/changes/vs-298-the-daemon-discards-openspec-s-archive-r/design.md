## Context

See `proposal.md` for the motivation. Two independent facts collide on VS-285's ticket:

1. `openspec archive <name> --yes --json`, when it refuses, prints (confirmed by reading the
   installed `@fission-ai/openspec@1.12.0`'s `dist/core/archive.js`, and by exercising
   `buildUpdatedSpec` directly against the real files — see Decisions below):
   ```json
   { "archive": null, "root": {...}, "status": [
     { "severity": "error", "code": "archive_spec_validation_failed",
       "message": "Rebuilt spec for '<capability>' failed validation. No files were changed.",
       "fix": "'<capability>' declares retire_capabilities, but the spec holds content the merge
               cannot safely account for and deleting the file would take with it: <lines>. Move it
               into `## Purpose` or a canonical requirement, or delete the spec by hand." }
   ] }
   ```
   `packages/core/src/openspec/cli.ts`'s `archive()` (line ~250) reads only `.message` off each
   `status[]` item; `.fix` — the half that says what to do — is never read.
2. `packages/core/src/tickets/service.ts`'s `mergeDone()` catches whatever `archiveAfterMerge` throws
   and re-throws it as `new OcError('internal', action, { ticketId })`, discarding the thrown error's
   own `code` and `details` regardless of what they were.

Both defects are independent of the specific refusal reason: fixing them helps every future blocked
archive, not only VS-285's.

## Goals / Non-Goals

**Goals:**
- Every field of `openspec`'s own diagnostic that names an actionable next step reaches the agent and
  the ticket, verbatim.
- A refusal openspec explains is reported under a code an agent (or a future gate) can branch on,
  distinct from a genuine crash.
- VS-285's change archives cleanly once this ticket's fix to `serialized-refresh/spec.md` reaches
  `main` — through the existing hourly reconciliation sweep
  (`packages/core/src/supervisor/index.ts`'s `reconcileOpenSpecArchives`), which already retries
  `archiveAfterMerge` for every finished ticket with an un-archived change. No new trigger is needed.

**Non-Goals:**
- Changing VS-285's shipped runtime-credentials code, or re-opening VS-293's propose-time gate.
- Patching `@fission-ai/openspec`. Its refusal is a correct safety check; see the next decision for
  why it fired on text that turned out not to be at risk.
- A generic "retry archive" command or ticket action. The sweep already exists and already covers
  this.

## Decisions

### 1. New code `openspec_archive_blocked`, not reusing `openspec_validation_failed`

`openspec_validation_failed` (`packages/shared/src/errors.ts`) already means one specific thing: the
`todo` → `proposed` gate rejected a change (`packages/core/src/tickets/service.ts:527`). Reusing it
for "an already-merged change refused to archive" would make that code ambiguous between two
completely different points in a ticket's lifecycle, for two different daemon-internal callers.
`openspec_archive_blocked` (422, `retryable: false`) is a second, sibling code, added the same way
`openspec_validation_failed` was. Its `details` carry `openspecCode` (the diagnostic's own `code`,
e.g. `archive_spec_validation_failed`) and `fix` (the diagnostic's own guidance text), so a caller
that wants to branch on the specific openspec-side reason still can, without the daemon inventing its
own enum that has to track openspec's.

**Alternative considered:** invent one daemon error code per openspec diagnostic code
(`archive_spec_validation_failed`, `archive_target_exists`, `archive_tasks_incomplete`, ...). Rejected
— `ArchiveBlockedError` in the installed CLI already has more than a dozen `code`s and adding a
capability version, `enum-in-two-repos` chase; `details.openspecCode` gets the same information onto
the wire without it.

### 2. `cli.ts` distinguishes a structured refusal from a bare crash by presence of a diagnostic, not by exit code

Both cases exit non-zero. The only reliable signal is whether `r.json`'s `status` array has an item
carrying a `code` field (every `ArchiveBlockedError` diagnostic has one; a raw thrown `Error` that
`toArchiveDiagnostic` falls back to becomes `{ severity: 'error', code: 'archive_error', message }` —
still structured, still gets `openspec_archive_blocked`). Only the total absence of a parseable
`status[]` (stdout wasn't JSON at all, or carried no items — the existing "falls back to stderr" test
case) stays `internal`. This keeps the existing `cli.test.ts` "falls back to stderr" case's behavior
and only changes the case that already carries a real diagnostic.

### 3. `mergeDone` rethrows the underlying `OcError` (code and details intact) instead of always wrapping to `internal`

```ts
throw e instanceof OcError ? new OcError(e.code, action, { ...(e.details ?? {}), ticketId: t.id }) : new OcError('internal', action, { ticketId: t.id });
```
`action` (the human-readable string already used for the ticket's `unblockJson` and system comment)
keeps its existing `openspec archive failed: ${detail}` shape — the ticket comment reads the same as
today, just with more detail in it (because `detail` now includes the `fix` text) — the code carried
on the re-thrown error is what actually changes, and that is what `ac_ticket_merge_done`'s
`ToolResult` and any future gate would read.

### 4. VS-285's blocker: reflow, not delete-by-hand or move-into-Purpose

The ticket's brief offered three routes openspec's own message suggests. Before picking one, I ran
`openspec`'s own `buildUpdatedSpec` (from the installed `@fission-ai/openspec` package, in-process,
read-only — no CLI archive invocation, nothing written) against the real
`runtime-credentials/serialized-refresh/spec.md` and VS-285's real delta. Its `unaccountedContent`
came back as exactly these ten lines:

```
"runtime's credential needs refreshing", "the same moment, and it needs refreshing", "enough",
"turn's timeout elapses", "long", "failure, and no agent that was waiting spawns a turn",
"authentication-failure behavior", "indication of a problem, and the local credential still cannot
be confirmed valid", "something the system cannot parse", "probe itself reported"
```

Every one of these is the soft-wrapped **second physical line** of a `- **WHEN**` / `- **THEN**` /
`- **AND**` scenario bullet whose first line is already accounted for. `openspec`'s unaccounted-content
scanner (`contentTheMergeCannotName` in the installed package's `specs-apply.js`) walks each
requirement block line by line and only recognizes a bullet's own opening line
(`/^\s*(?:[-*]|\d+[.)])\s/`); a continuation line that merely wraps the same bullet's prose onto a
second physical line matches none of its recognized shapes once the block is past its first
scenario, so it gets flagged as "content the merge cannot safely account for" even though it is
verbatim part of a bullet the scanner already counted. There is no second sentence, no dropped clause,
no information genuinely at risk — only a markdown line-wrap `openspec`'s scanner cannot see through.

I verified this by re-running the same in-process check against a copy of the spec with every
scenario bullet's `WHEN`/`THEN`/`AND` un-wrapped onto one physical line (wording byte-for-byte
identical, only the line breaks removed): `unaccountedContent` came back empty.

Given that, the two routes openspec's message suggests are both wrong for this file:
- **Move it into `## Purpose` or a canonical requirement** would keep prose alive for a capability
  that no longer exists, misrepresenting retired behavior as still-current — and there is nothing
  here that actually needs preserving, since it is not separate content at all.
- **Delete the spec by hand** sidesteps the tool's own safety check for a file where the check's
  premise (real content would be lost) does not hold, and forgoes the archive command's other work
  (moving VS-285's change under `openspec/changes/archive/`, recording `specsUpdated`).

**Decision:** reflow the three requirements' scenario bullets in
`openspec/specs/runtime-credentials/serialized-refresh/spec.md` so each `WHEN`/`THEN`/`AND` sits on
one physical line (wording unchanged). This clears `unaccountedContent` to empty, `isRetirableSpec`
returns true, and `openspec archive` deletes the file and archives VS-285's change entirely through
its own verified path — no bypass, nothing hand-maintained. This is not a change to VS-285's shipped
code (it never touches `packages/`) and not a patch to `@fission-ai/openspec` (only to a prose file in
our own `openspec/specs/` tree).

**Alternative considered:** patch `@fission-ai/openspec`'s scanner to recognize a wrapped bullet
continuation. Rejected per the ticket's own instruction not to patch the third-party install, and
unnecessary — the reflow fixes the one file that needs it without touching the tool.

## Risks / Trade-offs

- [The reflow changes the diff of a spec about to be deleted anyway] → harmless: the file is removed
  by `openspec archive` the moment VS-285's change reaches the primary clone and the next
  reconciliation sweep runs; the reflowed version only has to survive long enough for that.
- [A future author might reintroduce wrapped bullets in some other capability's spec and hit the same
  false-positive if they ever try to retire it] → out of scope here (would require patching the
  third-party tool, ruled out above); worth a knowledge-base note so the next person recognizes the
  pattern instead of re-deriving it.

## Migration Plan

No data migration. Once this ticket's PR merges to `main`, the next hourly reconciliation sweep
(already existing, unconditional) retries `archiveAfterMerge` for VS-285's ticket and succeeds.
