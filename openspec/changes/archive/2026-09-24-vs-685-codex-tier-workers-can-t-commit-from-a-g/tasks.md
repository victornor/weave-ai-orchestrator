## 1. Resolve the checkout's git common directory

- [x] 1.1 Add a pure resolver in `packages/runtimes/codex/src/` that returns a checkout's git common directory: a `.git` directory returns itself; a `.git` file (`gitdir: <gitdir>`) resolves through `<gitdir>/commondir`; a missing or malformed input returns `null`. Verify with unit tests over a plain `.git` directory, a linked-worktree `.git` file with a `commondir`, one without it, and a directory with no `.git` at all.

## 2. Add the common dir as a writable root for workspace-write turns

- [x] 2.1 Add an optional `writableRoots` to `CodexBuildOpts` and have `buildArgs` emit `-c sandbox_workspace_write.writable_roots=["…"]` for `new`, `resume` and `fork` when the resolved sandbox is `workspace-write` and the list is non-empty. Verify focused Codex argument tests assert the override on each of the three invocation modes.
- [x] 2.2 Keep `restricted` and `bypass` untouched. Verify tests assert no `sandbox_workspace_write.writable_roots` appears for either mode.
- [x] 2.3 In `adapter.runTurn`, resolve the roots from `input.worktree` (the git common dir, plus the checkout itself only when it is outside `input.cwd`), pass them into every `buildArgs` call for the turn, and keep only absolute, existing, de-duplicated paths. Verify a unit test covers the out-of-cwd case and the resolver's `null` case (no root, turn still runs).
- [x] 2.4 Verify the app-server path inherits the override: extend the fake-app-server test to assert the override reaches the `codex app-server` argv for a `workspace-write` turn.

## 3. Confirm the sibling runtimes

- [x] 3.1 Confirm by reading the adapters that Claude (`--permission-mode auto`) and OpenCode (`--auto`) impose no OS-level write sandbox, and that Gemini and Cursor's `auto` (`--sandbox disabled`) do not either, so only Codex needs the root; record the finding with file references in the ticket report.

## 4. Verify and hand off

- [x] 4.1 Run the Codex adapter tests and the runtime suite against fake executables and scratch directories only; verify the selected suites pass.
- [x] 4.2 Run `pnpm lint`, `pnpm typecheck` and `pnpm test`; verify and record both suite blocks verbatim in the delivery report.
- [x] 4.3 Write a `report` document carrying the root cause, the fix, the owner-run live repro steps (create a worktree, open a Codex `auto` worker, run `git add && git commit` in `work/`, expect success), and the explicit statement that no live Codex CLI was invoked and live acceptance remains unverified.
