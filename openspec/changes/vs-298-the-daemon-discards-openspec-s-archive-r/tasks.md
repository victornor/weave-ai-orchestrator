## 1. Surface the archive diagnostic

- [x] 1.1 Add `openspec_archive_blocked` to `ERROR_CODES` in `packages/shared/src/errors.ts`, map it
      to HTTP 422 in `OcError.status`, and verify `packages/shared/src/errors.test.ts` (or a new test
      alongside it) asserts the code exists and maps to 422.
- [x] 1.2 In `packages/core/src/openspec/cli.ts`'s `archive()`, read each failed-response `status[]`
      item's `code` and `fix` fields in addition to `message`. When at least one item carries a
      `code`, throw `OcError('openspec_archive_blocked', <message + fix, joined readably>, {
      changeName, openspecCode: <first item's code>, fix: <first item's fix ?? null>, issues:
      <full items> })`. When no item carries a `code` (stdout wasn't structured JSON at all, or the
      array was empty), keep throwing `OcError('internal', ...)` exactly as today. Verify with
      `packages/core/src/openspec/cli.test.ts`: extend the existing "surfaces the real reason" test
      (or add a sibling) so its fixture carries a `fix` field matching the real
      `archive_spec_validation_failed` diagnostic shape (see `design.md`'s Decision 1), and assert
      the thrown error's `.code === 'openspec_archive_blocked'`, `.message` contains both the
      headline and the fix text, and `.details.fix` is set; keep the existing "falls back to stderr"
      test passing unchanged (still `internal`).
- [x] 1.3 In `packages/core/src/tickets/service.ts`'s `mergeDone()`, change the `archiveAfterMerge`
      catch block so the re-thrown error preserves the caught `OcError`'s own `code` and `details`
      (merged with `ticketId`) instead of always wrapping to `'internal'`; keep the existing
      `action` string (used for the ticket's `unblockJson` and system comment) built from the
      caught error's `.message`. A non-`OcError` throwable still wraps to `internal` as today.
      Verify with a new test in `packages/core/src/tickets/merge-done.test.ts`: stub
      `deps().openspec.archiveAfterMerge` to reject with
      `new OcError('openspec_archive_blocked', '<capability> failed: <fix text>', { openspecCode:
      'archive_spec_validation_failed', fix: '<fix text>' })`, then assert `mergeDone` rejects with
      `.code === 'openspec_archive_blocked'` (not `'internal'`), the ticket's `unblockJson.action`
      and its system comment both contain the fix text, and the ticket's status is unchanged (still
      `merging`, not advanced to `done`).

## 2. Clear VS-285's actual blocker

- [x] 2.1 Reflow `openspec/specs/runtime-credentials/serialized-refresh/spec.md`: for each of its
      three requirements' scenario bullets, join each `- **WHEN**` / `- **THEN**` / `- **AND**`
      bullet's wrapped continuation back onto its own line, so every bullet is one physical line.
      Wording stays byte-for-byte identical — only line breaks move. Verify by re-running the same
      in-process check used in `design.md` (`buildUpdatedSpec` from the installed
      `@fission-ai/openspec` package against this file and VS-285's real delta at
      `openspec/changes/vs-285-stop-forcing-claude-credential-refreshes/specs/runtime-credentials/serialized-refresh/spec.md`)
      and confirm `unaccountedContent` is `[]`. Do not run `openspec archive` itself on this
      repository's own worktree or primary clone — the daemon's reconciliation sweep completes the
      actual archive after this change merges.
- [x] 2.2 Confirm (by reading, not editing) that
      `openspec/changes/vs-285-stop-forcing-claude-credential-refreshes/specs/runtime-credentials/single-credential/spec.md`
      and `.../login-outage/spec.md` still contain only the modified requirements VS-293's verified
      table described, unchanged by this ticket.

## 3. Whole-suite verification

- [x] 3.1 `pnpm lint && pnpm typecheck` clean.
- [x] 3.2 `pnpm test` both suites green; paste both blocks (core/server and UI) verbatim in the
      delivery comment per this project's reporting convention.
