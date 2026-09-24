## Why

A Codex-tier worker cannot commit from its git worktree checkout. `git commit` (and any
index write) fails with `fatal: Unable to create '…/<project>/.git/worktrees/<name>/index.lock':
Read-only file system`, even though the same path is writable from the host. This reproduced
across three runs and two worker instances (VS-680, incident `01M38Y96RH6ADFZAQSB83VKEE7`), so
it is not a broken mount. Codex's `workspace-write` sandbox grants write access only to the
process's working directory; a linked worktree's per-worktree metadata (`index.lock`, `HEAD`,
`gitdir` bookkeeping) lives in the *common* git directory under the project's main clone,
outside that directory. Every Codex-tier ("quick") worker on every worktree-based project hits
this the moment it tries to commit.

## What Changes

- Grant each Codex `workspace-write` turn the checkout's **git common directory** as an
  additional sandbox writable root, so the worktree's own git metadata is writable.
- Resolve that directory from the run's checkout without invoking git: a `.git` directory is
  itself the common dir, and a linked worktree's `.git` file points at its per-worktree gitdir
  whose `commondir` file resolves the common dir.
- Also grant the checkout itself as a writable root when it lies outside the spawn cwd (the
  curation case and any provider that places a worktree outside the worker home), mirroring the
  existing `--add-dir` behaviour other runtimes already have.
- Apply the setting to a new `exec` turn, to resumed/forked `exec` turns and to the
  `codex app-server` startup, since those configure the sandbox through different channels
  (flag vs `-c` override); `restricted` stays `read-only` and `bypass` stays unsandboxed.
- Confirm the sibling runtimes: Claude, OpenCode and Gemini impose no OS-level write sandbox,
  and Cursor's `auto` uses `--sandbox disabled`, so none of them needs the equivalent.
- Record that live Codex acceptance is owner-run: a ticket may not launch the real CLI.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `codex-runtime`: adds a requirement that a `workspace-write` Codex turn includes the
  checkout's git common directory among its sandbox writable roots, so `git add`/`git commit`
  from the worktree succeeds.

## Impact

- `packages/runtimes/codex/src/` — argument construction (a new writable-root option), a small
  git-common-dir resolver, and the adapter's turn setup; plus its unit and fake-CLI tests.
- No change to permission-mode resolution, no `RuntimeAdapter` SDK contract change, no change to
  Claude/OpenCode/Gemini/Cursor adapters, and no public API or config-schema change.
