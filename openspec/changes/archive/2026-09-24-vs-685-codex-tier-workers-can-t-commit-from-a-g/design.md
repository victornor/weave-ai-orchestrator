## Context

`buildArgs` maps a Codex turn's permission postures onto the sandbox: `auto` →
`workspace-write`, `restricted` → `read-only`, `bypass` →
`--dangerously-bypass-approvals-and-sandbox` (VS-485, VS-508, VS-544). The run engine spawns a
turn with `cwd = agent.homePath` (the worker home, `workers/<id>`), which is also the Codex `-C`
target for a new `exec` turn. A worker's checkout is the git worktree at `<home>/work`, inside
that cwd, so the checkout's *files* are already writable.

A linked worktree, however, keeps its per-worktree git metadata — `index.lock`, `HEAD`, the
worktree gitdir — in the **common** git directory of the main clone
(`projects/<project>/.git/worktrees/<name>/`), which is outside the worker's cwd and outside the
home entirely. Codex's `workspace-write` sandbox denies that write and surfaces it as `EROFS`,
which is indistinguishable from a real read-only mount and is why VS-680 misdiagnosed it as a
broken mount twice. A host-side `touch` on the same path succeeds, ruling out a real mount.

Read-only inspection of the installed `codex-cli 0.154.0` binary confirms the config surface:
`ConfigToml` carries `sandbox_workspace_write` with fields `writable_roots`, `network_access`,
`exclude_tmpdir_env_var`, `exclude_slash_tmp`, and the app-server's structured policy has a
`workspaceWrite` variant carrying the same `writableRoots`. Writable roots are additional to the
policy's cwd (the binary carries a `sandbox-policy-cwd` / `SANDBOX_POLICY_CWD` mechanism
precisely because the policy cwd may differ from the spawn cwd). The real coding CLI is **not**
launched from this ticket: doing so can rotate the owner's login out from under every agent, so
acceptance of the fix against the real CLI is an owner-run check.

## Goals / Non-Goals

**Goals:**

- Let a Codex `workspace-write` turn write its worktree's git metadata, so `git add && git commit`
  from `<home>/work` no longer fails with `EROFS`.
- Cover every Codex invocation path that configures the sandbox: a new `exec` turn, a resumed or
  forked `exec` turn, and the `codex app-server` used by default.
- Keep `restricted` read-only and `bypass` unsandboxed; add roots only where Codex has a
  `workspace-write` sandbox.
- Verify with fake-CLI/unit tests plus a documented owner-run repro.

**Non-Goals:**

- Changing permission-mode resolution in the run engine or the meaning of the three modes.
- Widening Codex's write access beyond the checkout and its git metadata.
- Changing any other runtime adapter (see Decision 4).
- Running the real Codex CLI or touching credentials.

## Decisions

### 1. Resolve the git common dir from the checkout, without invoking git

Add a small resolver in the Codex package:

- `<checkout>/.git` is a **directory** (a primary clone; the curation-ticket case, where
  `input.worktree.path` is the project clone) → the common dir is that `.git` directory.
- `<checkout>/.git` is a **file** (`gitdir: <gitdir>`, a linked worktree) → read
  `<gitdir>/commondir`; when present, resolve it relative to `<gitdir>`. When absent, treat the
  per-worktree gitdir's grandparent as the common dir only if it is under a `worktrees/` segment;
  otherwise return `null`.
- Anything missing or malformed → `null` (no root added; the turn behaves exactly as today).

Reading two small files is deterministic and avoids spawning `git` on every turn. Spawning
`git rev-parse --git-common-dir` was rejected as needless process cost and a new failure mode in
a hot path; parsing the documented worktree layout is sufficient and testable.

### 2. Emit the roots as a `-c` config override, so both `exec` and app-server inherit them

`buildArgs` gains an optional `writableRoots?: string[]` in `CodexBuildOpts` (it stays pure; the
adapter resolves the paths). When the resolved sandbox is `workspace-write` and the list is
non-empty, it pushes:

```
-c sandbox_workspace_write.writable_roots=["/abs/root", …]
```

once, for `new`, `resume` and `fork`. `runAppServerTurn` already forwards every `-c` pair from
`built.args` to the server through `configOverrides(built.args)`, and the thread request's
`sandbox: "workspace-write"` selects the mode whose policy the config supplies — so the same
override reaches the app-server path with no protocol change. The proven thread-param shape
(`sandbox` as a string, per the recorded `codex-cli 0.154.0` fixtures) is left alone rather than
replaced with the unverified structured `sandboxPolicy` object.

The roots are computed once in `adapter.runTurn` and passed to both `buildArgs` calls (the first
and the `EEXIST` re-build) so a config-file collision cannot drop them.

### 3. Include the checkout itself when it is outside the spawn cwd

`workspace-write` already makes the cwd writable, but a worktree can live outside it (curation
tickets pass the project clone; a future provider could place worktrees elsewhere). Mirror the
existing Claude/Gemini `--add-dir`/`--include-directories` rule: when
`input.worktree.path` does not start with `input.cwd`, add it too. Dedupe, keep only absolute
paths, and keep only paths that exist so a stale worktree path cannot make Codex reject the
config.

### 4. Leave the other runtimes unchanged

- **Claude** (`auto`): `--permission-mode auto`, no OS write sandbox; its `--add-dir` already
  covers an out-of-cwd worktree. The commondir is reachable.
- **OpenCode** (`auto`): `--auto`; permission is enforced by its own server, not a kernel
  sandbox. Reachable.
- **Gemini**: no sandbox flag; `--include-directories` for an out-of-cwd worktree. Reachable.
- **Cursor** (`auto`): `--sandbox disabled`; reachable.

Only Codex sandboxes writes at the kernel level, so only Codex needs the root.

## Risks / Trade-offs

- [Codex treats `writable_roots` as replacing rather than extending the cwd] → The binary's
  `sandbox-policy-cwd` machinery shows the policy cwd is tracked separately from added roots; the
  unit tests pin the override, and the owner-run repro confirms a real commit.
- [The app-server thread's `sandbox` param rebuilds the policy without the config roots] → The
  `-c` override is the config path for that mode; the fake-app-server test asserts the override
  reaches the server argv. If the live repro still fails on the app-server path, the fallback is
  to pass the structured `sandboxPolicy` with `workspaceWrite.writableRoots` instead of the
  `sandbox` string; that shape is deliberately not shipped unverified.
- [Adding the whole `.git` dir is broader than the one lock file] → Scoped to the common dir of
  the run's own repository; no other user or project path is exposed, and the sandbox is already
  process-scoped to one worker run.
- [A malformed `.git` breaks every turn] → The resolver returns `null` on any error, so the
  failure mode is today's behaviour, never a hard error.

## Migration Plan

1. Land the resolver, the `buildArgs` option, the adapter wiring and the tests.
2. Codex workers get the root on their next turn; in-flight sessions resume with it because the
   option is recomputed per turn, including on `resume`/`fork`.
3. Roll back by reverting the commit; no persisted config or schema change is involved.
