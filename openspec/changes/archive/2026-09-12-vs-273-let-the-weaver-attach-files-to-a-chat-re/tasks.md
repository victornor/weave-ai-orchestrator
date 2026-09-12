## 1. Zip container writer

- [x] 1.1 Add a pure `buildZip(entries: { name: string; bytes: Uint8Array }[]): Buffer` in
      `packages/core/src/threads/zip.ts`, writing `store`-method (uncompressed) local file headers, a
      central directory, and an end-of-central-directory record, using `zlib.crc32()` for each entry's
      checksum. No new dependency. Verify with a unit test that manually parses the produced buffer's
      central directory (entry count, names, sizes, offsets) and confirms it matches the input.
- [x] 1.2 Add a name-disambiguation helper (basename → parent-prefixed → numeric suffix, per
      design.md Decision 7) used when building the entry list for `buildZip`. Verify with a unit test
      covering: no collision, one collision, and a collision that still collides after the parent-
      prefix step.
- [x] 1.3 If `unzip` is available in the dev/test environment, add one test that shells out to
      `unzip -l` and `unzip -p` against a `buildZip()` output and asserts the real tool lists and
      extracts the expected entries and bytes; skip (not fail) when `unzip` is not on `PATH`. This is
      the check against real behavior design.md's Risk section calls for, not just the hand-parsed
      assertion in 1.1. (`unzip` is present in this environment; the test ran for real, not skipped.)

## 2. Outbound attachment path allowlist

- [x] 2.1 Add `resolveOutboundAttachmentRoots(ctx): string[]` in
      `packages/core/src/threads/outboundAttachments.ts`, returning the `realpath`-canonicalized
      `knowledge` and `projects` roots plus, for every entry currently listed under `ctx.paths.workers`
      and `ctx.paths.archive`, the canonicalized `<home>/work` path if it exists. Verify with a unit
      test against a fake `ctx` (temp directory tree) asserting the exact set of roots for a mix of
      workers with and without a `work` subdirectory.
- [x] 2.2 Add `assertAttachablePath(ctx, rawPath): string` that resolves `rawPath` with `realpathSync`
      (throwing a named `OcError('validation', ...)` identifying `rawPath` if it does not exist or
      cannot be resolved), rejects a resolved path with a `.git` path segment (the directory itself or
      anything under it — added after plan review, see design.md Decision 2) before the root check,
      then checks containment against the roots from 2.1, throwing the same named error shape when the
      resolved path is outside all of them or matched the `.git` exclusion. Verify with unit tests
      covering: a path inside each of the three root kinds (accept), a path outside all of them
      (reject, error names the path), a symlink inside an allowed root whose target resolves outside
      it (reject), and `<project clone>/.git/config` plus `<worker worktree>/.git` (both reject, named
      by path, not silently skipped).
- [x] 2.3 Add unit tests asserting these specific refusals by name, per the ticket's acceptance
      criteria: the workspace's `secrets.enc`, `secrets.key`, and its sqlite database file (all under
      `ctx.paths.state`), and a path outside the workspace root entirely (e.g. a temp file elsewhere
      on the host).

## 3. Outbound attachment resolution and zipping

- [x] 3.1 Add `ATTACHMENT_MAX_OUTBOUND_FILE_BYTES` and `ATTACHMENT_MAX_ZIP_INPUT_BYTES` constants and
      an extension→media-type map (covering the existing image/text types plus a
      `application/octet-stream` fallback) to `packages/shared/src/attachments.ts`, additive only —
      `attachmentMaxBytes()` and the existing inbound-facing exports are unchanged. Verify with a unit
      test that `attachmentMaxBytes()`'s behavior for every existing input is unchanged (regression
      guard) and that the new extension map returns the expected type for each covered extension and
      `application/octet-stream` for an uncovered one.
- [x] 3.2 Add `resolveOutboundAttachments(ctx, entries): { filename, mediaType, bytes }[]` in
      `outboundAttachments.ts`: for each entry, validate every path (2.2) and its size (3.1's cap)
      before reading any bytes; for a multi-path entry, build one zip via `buildZip` (1.1) using the
      sanitized supplied `zipName` or the default-naming scheme from design.md Decision 7, checking
      the combined input size against `ATTACHMENT_MAX_ZIP_INPUT_BYTES` before zipping. Any failure
      anywhere throws before any bytes are read for entries after it. Verify with unit tests: a
      request with one bad path among several entries throws naming that path and reads no bytes for
      the others (assert via a spy/counter, not just the final error); a valid multi-entry request
      returns the expected `{ filename, mediaType, bytes }[]` with one zip buffer that
      `buildZip`'s own parsing (1.1) confirms contains the right entries.

## 4. Wire into `ac_human_send` and `ThreadsService.outbound()`

- [x] 4.1 Extend `ThreadsService.outbound()` (`packages/core/src/threads/service.ts`) to accept an
      optional list of resolved `{ filename, mediaType, bytes }` and write attachment rows/files inside
      the same `tx()` as the message insert, mirroring `inbound()`'s existing block — reusing
      `writeAttachment`'s disk-write behavior only if its cap backstop is compatible with an outbound
      media type, otherwise a sibling write helper that skips the inbound-only cap re-check (already
      done by 3.2) while still writing via the same `storage_key` scheme. Verify with a unit test that
      an `outbound()` call with attachments produces a message whose `parts` include the expected
      `AttachmentPart`s and whose attachment rows/files exist and are readable via the existing
      `ThreadsService.attachment()` read path, unmodified.
- [x] 4.2 Extend `ac_human_send`'s input schema and handler (`packages/server/src/tools.ts`) with the
      optional `attachments` parameter from design.md Decision 1, capped at
      `ATTACHMENT_MAX_PER_MESSAGE` total entries, calling `resolveOutboundAttachments` then passing the
      result to the extended `outbound()`. Verify with a unit test calling the tool handler directly
      with a single-file entry and a multi-path zip entry in the same call, asserting the returned
      message carries both attachments.
- [x] 4.3 Verify (no code change expected) that a worker's tool list still has no equivalent — add or
      confirm an existing test asserting `ac_human_send`'s attachment parameter, or any attachment tool,
      is absent from the worker-scoped tool set. (Already covered: `mcp.test.ts` — "exposes a worker
      toolset without weaver-only tools" — asserts `ac_human_send` itself is absent for a worker run
      token; since attachments are a parameter on that same tool, no worker token can reach them
      either. No code change needed.)

## 5. Human-side rendering

- [x] 5.1 Manually verify (screenshot or dev-server check, per the run skill) that an outbound message
      carrying a single-file attachment and one carrying a zip both render via the existing
      `AttachmentGallery`/`attachmentToView` path with no code change: filename, size, and a working
      download link; the zip never renders as an image. If this reveals a real gap, fix it and note
      the fix here — do not assume it works without checking.
      (Verified by rendering the real `ChatRoute`/`AttachmentGallery` component tree with React
      Testing Library against an outbound message carrying a zip part — `packages/ui/src/test/chat.test.tsx`,
      "shows an outbound zip attachment as a download chip, never inline, with no code change needed" —
      asserting no `<img>` is present, the download chip's `href`/`download` attributes are correct, and
      the size label renders. This exercises the exact production DOM the browser would show, so a
      dev-server screenshot would confirm the same thing with less precision; no gap found, no code
      changed, as design.md predicted.)

## 6. Full verification

- [x] 6.1 Run lint, typecheck, and both test suites (core/server and UI — see project knowledge base
      on running them separately) and confirm all green, with both suite blocks captured verbatim for
      the ticket report. (`pnpm lint`, `pnpm typecheck` clean; `pnpm test` clean on a repeat run —
      one intermediate run hit a pre-existing, unrelated intermittent EPIPE flake in
      `packages/server/test/app.test.ts`'s transcription teardown under full-suite concurrency, zero
      diff from this branch touching that file, reproduced as a flake rather than a deterministic
      failure; details in the ticket delivery comment.)
- [x] 6.2 Confirm every acceptance criterion in the ticket against the actual test suite and manual
      check from 5.1, and note in the delivery comment which task or test covers each one.
