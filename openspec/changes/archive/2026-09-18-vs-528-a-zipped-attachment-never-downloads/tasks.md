## 1. Serve the response honestly

- [x] 1.1 Add `attachmentContentDisposition(mediaType, filename)` to `packages/shared/src/attachments.ts`: `inline` for image media types, otherwise `attachment; filename="<ascii-fallback>"; filename*=UTF-8''<pct-encoded>` with characters outside `\x20`–`\x7e` plus `"`/`\` replaced by `_`; verify with a unit test in `packages/shared/src/attachments.test.ts` covering a plain name, quotes/backslashes, and a non-ASCII name, and that `pnpm vitest run packages/shared/src/attachments.test.ts` passes.
- [x] 1.2 In `packages/server/src/routes/threads.ts`, set the serving route's `Content-Length` from `bytes.byteLength` and its `Content-Disposition` from the helper; verify `pnpm typecheck` passes.

## 2. Lock the bundled-zip download

- [x] 2.1 Extend `packages/server/test/threads-attachments.test.ts` with a case that sends an outbound reply carrying a bundled zip of several files and a single file, fetches each through `GET /api/w/:ws/threads/:threadId/attachments/:id`, and asserts 200, `content-type`, `content-length` equal to the body length, and the body byte-identical to the stored attachment; verify `pnpm vitest run packages/server/test/threads-attachments.test.ts` passes.
- [x] 2.2 Add a case asserting a non-image attachment's `content-disposition` starts with `attachment;` and an image's is `inline`; verify the same suite passes.
- [x] 2.3 Run `pnpm lint && pnpm typecheck && pnpm test` and paste both suite blocks (core/server and UI) verbatim in the ticket report.

## 3. Record the finding and document the contract

- [x] 3.1 Update the attachment-serving sentence in `docs/API.md` to name the response headers (`content-type`, `content-length`, `content-disposition`); verify the sentence reads correctly and matches the route.
- [x] 3.2 In the pull request body, state plainly that the reported failure was **not reproduced at HEAD**, that the suspected cause is per-origin connection starvation fixed by VS-509 and awaiting a release, and that this change is defensive — verify the PR body says all three.
