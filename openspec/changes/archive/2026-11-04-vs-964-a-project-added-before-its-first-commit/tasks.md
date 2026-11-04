## 1. State and storage

- [x] 1.1 Add `empty` to `PROJECT_SYNC_STATES`; add migration 0067 rebuilding `projects` with the widened CHECK; extend the migration CHECK test

## 2. Detection and wording

- [x] 2.1 `cloneIsEmpty` + `EMPTY_REMOTE_MESSAGE` in the projects service; `fetch` records `empty` without touching the clone; `checkSync` returns it with `message` (api type updated)
- [x] 2.2 Tests: empty remote reports `empty` with the message; first commit then fetch goes `in_sync`; existing diverged tests still pass

## 3. Where it is shown

- [x] 3.1 Project page shows a neutral "No commits yet" tag with the message; sync hook type and `docs/API.md` sync response gain `message`
- [x] 3.2 Curation freshness gate block text for `empty`

## 4. On-demand fetch

- [x] 4.1 `withFreshEmptyClone` before worktree creation (spawn/session pickup and `ensureWorktree`); test: fetches once, no loop while still empty, none when `in_sync`

## 5. Verify

- [x] 5.1 `pnpm typecheck`, `pnpm lint`, and the affected suites green
