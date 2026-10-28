## Why

A worker commits as whoever cloned the repository. `packages/core/src/runs/engine.ts` *reads* the
identity from the worktree (or the clone) instead of deciding what a worker ought to commit as, and
provisioning copies the clone's identity into every new worktree. On 2026-10-27 VS-831 rewrote a
repository's history to remove a personal address; the next merged pull request put it back, because
`main` is now authored by the same personal address and all 37 worktree configs carry it. The history
rewrite treated the symptom; this is the cause.

It is also not one operator's problem. Any workspace cloned with a personal identity attributes every
piece of machine work to a human, and publishes that private address the moment the repository goes
public.

## What Changes

- A worker's commit identity becomes **configured**, not inherited: a workspace default
  (`defaults.workerGitIdentity`) and a per-project override (`projects[].workerGitIdentity`), the
  project winning when both are set.
- With neither configured, the daemon derives a non-personal default from the repository URL —
  `Weave AI <owner@users.noreply.github.com>` for a GitHub remote, otherwise
  `Weave AI <weave-ai@users.noreply.github.com>` — and never falls back to the clone's `user.email`.
- The resolved identity is applied **when the worktree is created**, written as `--worktree` config,
  so `git var GIT_AUTHOR_IDENT` inside a worker's checkout already answers correctly for anything the
  worker shells out to. The same identity is passed to the runtime environment. The engine stops
  reading the worktree/clone identity.
- Provisioning no longer fails because the clone has no identity: the clone's identity is irrelevant
  to a worker checkout.
- An existing workspace is made aware once: at daemon startup, a ready project whose clone commits as
  a personal-looking address and that has no configured worker identity gets **one** warning, recorded
  once per project (not a warning on every boot or every view).
- **BREAKING** for a workspace that relied on the clone's identity being the worker's identity: after
  this change workers commit as the derived/configured identity, not as the clone. Documented, with
  the one-time operator action for a workspace that already has worktrees.
- Out of scope, deliberately: rewriting history, touching the existing clone or its 37 worktrees, and
  changing how the daemon merges or pushes. Those remain with VS-833.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `worker-git-identity`: the identity is configured (workspace default, project override, derived
  non-personal default) rather than read from the repository, applied at worktree creation, and a
  clone carrying a personal identity is reported once.

## Impact

- `packages/shared/src/config.ts` (identity schema, workspace default, project field) and
  `packages/shared/src/types.ts` (the project row's field).
- `packages/db/src/migrations/` — one migration adding `projects.worker_identity_json`.
- `packages/core/src/util/git.ts` (identity resolution, GitHub-URL derivation, personal-address
  heuristic), `packages/core/src/workers/index.ts` (three provisioning call sites),
  `packages/core/src/runs/engine.ts` (runtime environment), and a startup scan called from the
  supervisor.
- `packages/core/src/projects/index.ts` (row/config round-trip for the project override).
- Tests in `workers.test.ts`, `engine.test.ts`, `projects.test.ts`/a new identity suite, and the DB
  migration suite.
- Documentation: `docs/CONFIGURATION.md` (where to set it) and `docs/OPERATIONS.md` (the one-time
  action for an existing workspace).
