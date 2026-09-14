# Tasks

## 1. Rebase and settle the title defect

- [x] 1.1 Base on the VS-367 fix. It is **not on `main`** (PR #317 is still open, `origin/main` at
  `2fe97904`, no `@theme inline`), so per design D1's fallback the same root fix is applied here:
  `index.css`'s `@theme` becomes `@theme inline`. Verified `packages/ui/src/index.css` reads
  `@theme inline` and the built CSS emits `.text-text-1{color:var(--text-1)}`.
- [x] 1.2 Reproduce and prove in a real browser. Scratch daemon on `127.0.0.1:18931`, two seeded
  workspaces; Chromium (CDP) with `<html data-theme="light">` and V2 dark. Before the fix
  `text-text-1`/`text-text-strong` computed to `rgb(22,24,28)`/`rgb(12,13,16)` while `.v2-root`'s
  `--text-1` was `#e9eaec`; after, they compute to `rgb(233,234,236)`/`rgb(242,243,245)` in dark and
  `rgb(22,24,28)`/`rgb(12,13,16)` in light.
- [x] 1.3 No per-component change: the fix is the shared mapping, and every token utility repaints.
- [x] 1.4 `packages/ui/src/test/v2TokenResolution.test.ts` pins `@theme inline` (and the absence of a
  non-inline `@theme`); it fails against the pre-fix mapping.

## 2. Global run detail resolves its workspace

- [x] 2.1 `GET /api/runs/{id}` in `packages/server/src/routes/daemon.ts` searches the loaded
  workspaces and returns the first match, `not_found` when none. `globalRunRoute.test.ts` proves a run
  in the second workspace resolves and an unknown id is 404.
- [x] 2.2 Registered in `packages/server/src/routetable.ts` and documented in `docs/API.md`.
- [x] 2.3 `useRunGlobal` in `packages/ui/src/api/hooks.ts` fetches `/runs/{id}` through `api.root`;
  `qk.runGlobal` is invalidated alongside `qk.run` on run started/finished.
- [x] 2.4 `RunPage.tsx` fetches through `useRunGlobal` and passes the resolved `run.workspaceId` to
  `useRunEventStream` and `useWorkersMany`.
- [x] 2.5 The global route is unchanged (`v2ShellRoute`), never wrapped in a `WorkspaceProvider`.

## 3. Regression tests

- [x] 3.1 `v2runGlobal.test.tsx` mounts the real `RunBody` with the real hooks and no
  `WorkspaceProvider`; verified it fails on the pre-fix `useRun` with
  `useWorkspace outside WorkspaceProvider` and passes after.
- [x] 3.2 `v2run`, `v2runs`, `runPages`, `runStream` and the full suites pass.

## 4. Rendered check (scratch daemon only)

- [x] 4.1 Scratch daemon with its own `--config-dir` (`/tmp/opencode/vs386-scratch`), port `18931`,
  two seeded workspaces (Acme first, Fernwood second) with a project, role, ticket, open decision and
  a run in the second workspace.
- [x] 4.2 Captured Needs you, Ticket, Roles and Run detail at 1280×820 in dark and light with real
  Chromium; compared against the reference set at
  `/home/user/Downloads/Weave Control Plane Redesign/shots/{desktop-dark,desktop-light}/` (see report).
- [x] 4.3 Stopped by its recorded PID (`1108926`) via `scripts/scratch-daemon.sh` only.

## 5. Checks and delivery

- [x] 5.1 `pnpm lint` and `pnpm typecheck` green.
- [x] 5.2 Both suites green under `XDG_CONFIG_HOME="$(mktemp -d)"`: core/server 208 passed | 1 skipped
  (209 files), 3181 passed | 1 skipped (3182 tests); UI 150 passed (150 files), 2176 passed (2176).
- [ ] 5.3 Open the PR, record it as the work product, transition to `in_review`.
