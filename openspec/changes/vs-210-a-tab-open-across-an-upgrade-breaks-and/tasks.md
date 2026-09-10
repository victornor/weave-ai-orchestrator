## 1. Server: missing asset 404s (`packages/server/src/static.ts`)

- [x] 1.1 Split the miss-path decision by whether the request is under the build's asset directory
      (`assets/`): a miss there throws `OcError('not_found', ...)` instead of falling back to
      `index.html`; a miss anywhere else keeps today's `index.html` fallback unchanged.
- [x] 1.2 Leave the "UI not built at all" placeholder path (`root` absent) untouched — it must not
      turn into a 404.
- [x] 1.3 Tests (new `packages/server/test/static.test.ts`, following the `mkdtempSync` fixture
      pattern used elsewhere in that directory): a missing file under `assets/` 404s with the
      standard error envelope and not `text/html`; an existing asset is still served with its current
      headers; a non-asset path with no matching file still falls back to `index.html` with `200`.

## 2. Web app: stale-tab recovery (`packages/ui`)

- [x] 2.1 New module `packages/ui/src/lib/chunkReload.ts`: `isDynamicImportError`,
      `shouldReloadForChunkError`, `markChunkReload`, per `design.md`'s decision — pure functions
      apart from the `sessionStorage` read/write, so the reload-vs-give-up decision is unit-testable
      without a real browser reload.
- [x] 2.2 A `defaultErrorComponent` wired into `createRouter` in `packages/ui/src/router.tsx`: for a
      dynamic-import error it reloads once (guarded) or shows the "update didn't finish" message with
      a manual reload; for anything else it renders today's generic error state unchanged.
- [x] 2.3 Tests: `chunkReload.ts`'s pure functions (fresh vs. within-window vs. later-and-independent);
      the error component's three branches (generic error still shows the old UI; a fresh
      dynamic-import error reloads exactly once; a repeated one inside the window does not reload
      again and shows the manual-reload message) — reload and `sessionStorage` mocked, per the
      project's convention of testing browser-API-adjacent logic through jsdom mocks rather than a
      real navigation.

## 3. Verify

- [x] 3.1 `pnpm lint && pnpm typecheck && pnpm test` green (both vitest configs). One unrelated flake
      seen on a full run, `packages/core/src/jobs/jobs.test.ts`'s "lists a project's jobs newest
      first..." (the documented ULID-tie flake, pre-existing on `main`, untouched by this change) —
      confirmed nondeterministic in isolation (fails, passes, passes on three back-to-back runs) and
      a clean full run afterwards passed all 2058 + 1329 tests.
- [x] 3.2 Confirm `packages/ui/public/sw.js` was not touched — out of scope per `design.md`.
