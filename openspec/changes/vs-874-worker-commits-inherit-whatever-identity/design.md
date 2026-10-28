## Context

See `proposal.md` — Why. Two facts shape the approach:

- The daemon already has the mechanism to give a worktree its own identity:
  `configureGitWorktreeIdentity` enables `extensions.worktreeConfig` and writes `--worktree
  user.name`/`user.email`. What it lacks is a value that is not read from the clone
  (`packages/core/src/workers/index.ts` calls `requireGitIdentity(project.clonePath)` at three
  provisioning sites).
- `packages/core/src/runs/engine.ts` independently re-reads the worktree (falling back to the clone)
  to populate `GIT_AUTHOR_*`/`GIT_COMMITTER_*` for the turn. Even after the worktree is corrected, this
  read is the second path by which a stale checkout or a session without a worktree inherits the
  clone's address.

Workspace config is parsed once into `ctx.config` (`WorkspaceConfigSchema`); a project's own config
lives in `workspace.yaml` and is mirrored into the `projects` row, whose JSON columns round-trip
through `db.camel`.

## Goals / Non-Goals

**Goals:**

- One identity decision, made once, used by provisioning, the runtime environment and the startup
  diagnostic.
- A workspace can set it once; a project can override it; neither falls back to the clone.
- Existing unsafe state is surfaced without ever writing to the clone or old worktrees.

**Non-Goals:**

- Repairing the existing clone or 37 worktrees (VS-833 owns the host change).
- Changing the identity the daemon itself commits with when it archives or merges.
- Deriving an identity for a non-GitHub forge from that forge's own noreply convention.
- A UI control: the field is part of the documented workspace/project configuration.

## Decisions

### Both a workspace default and a project override; project wins

A workspace-level default answers "set this once" for the common case, and a project override answers
"this repository wants different attribution". A project can be added long after the workspace exists,
so an absent project value must mean "inherit the workspace", and an absent workspace value must mean
"use the derived default" — never "read the clone".

*Alternatives:* workspace-only (cannot attribute different repos differently); project-only (every
new project silently gets the generic bot address, and there is no single place to set the operator's
preference); clone-plus-warning (still inheritance, which is the bug).

The workspace value goes in `defaults.workerGitIdentity` (`null` = not configured). The project value
goes in `projects[].workerGitIdentity` (absent = inherit) and is mirrored into a new
`projects.worker_identity_json` column so a project row carries its own value without a config lookup
on every provision.

### The default is derived from the repository URL, not a single shared address

`Weave AI <owner@users.noreply.github.com>` for a GitHub remote is GitHub's conventional
non-personal address: it is publishable, attributes the commit to the repository owner's account, and
contains no private information. For a non-GitHub remote there is no such convention, so the fallback
is `Weave AI <weave-ai@users.noreply.github.com>`. Parsing the owner from `https://`, `ssh://` and
`git@host:owner/repo` forms is a small, tested pure function; anything unrecognised falls back rather
than guessing.

*Alternatives:* one shared `weave-ai@users.noreply.github.com` everywhere (simplest, but loses the
owner attribution GitHub supports); refuse to provision until configured (makes first use of a project
fail for a setting whose safe default is obvious); use the git user's GitHub login (a second lookup,
and still personal-ish).

### Apply at worktree creation, and stop reading identity in the engine

The identity is written as worktree config immediately after `provider.create`, at all three
provisioning sites (worker, repaired worker, planner). This is what makes
`git var GIT_AUTHOR_IDENT` correct for a worker's own shell commands, not only daemon-mediated
commits. The engine then uses the same resolver instead of `readGitIdentity` for the turn environment,
so a session without a worktree can no longer pick up the clone's address.

*Alternative:* keep the engine read and only set env at run time — leaves a tool shelling out to Git
inside the worktree inheriting the clone.

### Provisioning no longer requires an identity on the clone

`requireGitIdentity` is removed from the three provisioning paths. Its old error ("set user.name and
user.email") was itself the inheritance assumption; with a resolved value there is nothing to require
from the clone. `readGitIdentity` stays, but only for the startup diagnostic and tests.

### The existing-state signal is one startup warning, recorded once per project

A daemon-startup pass looks at each ready project with no configured identity, reads the clone's
identity, and when the address looks personal emits one `log.warn` naming the project and the address,
then writes a `meta` marker (`worker_identity_warning:<projectId>`) so it is never repeated for that
project in that workspace database. This matches the ticket's own acceptable surfaces (startup log)
and keeps the signal singular.

"Personal-looking" means an address that is neither `...@users.noreply.github.com` nor has a
`noreply`/`no-reply` local part. That is deliberately broad — the cost of a false positive is one
informational line; the cost of a false negative is a published private address.

*Alternatives:* a project-overview/health field (would need an API and UI surface, and would repeat on
every view); a decision card (noisy, and asks the operator to make a choice this ticket already
makes); warning on every boot (the ticket explicitly rejects a repeated warning).

### Existing worktrees are not touched

A worktree created before this change keeps its old `--worktree` config until the worker or ticket is
retired and a new checkout is made. Repairing them would mean writing into the existing clone and 37
worktrees, which VS-833 owns; the one-time operator action is documented in `docs/OPERATIONS.md`.

## Risks / Trade-offs

- **An operator who deliberately wanted their clone's identity on worker commits loses it.** Mitigated
  by the project/workspace setting, which is the deliberate opt-in; a personal address now requires
  typing it, never inheriting it.
- **A derived owner noreply may not resolve to a GitHub account** (an org slug, or a login that never
  enabled the address). Harmless: the commit is still non-personal; attribution is a nicety.
- **The personal-address heuristic can flag a shared team address** (e.g. `dev@company.com`).
  Mitigated by firing once and being informational only.
- **Existing worktrees still leak until replaced.** Documented as the required one-time operator
  action; automatic repair is explicitly out of scope.
- **The `meta` marker is per workspace database.** A restored or copied database may warn again; that
  is better than suppressing a real condition forever.

## Migration Plan

1. Ship the migration (`ALTER TABLE projects ADD COLUMN worker_identity_json TEXT`) and the code; no
   data backfill.
2. Deploy/restart. Existing worktrees are unchanged; new worktrees use the configured or derived
   identity.
3. Operator action (documented, once): set `defaults.workerGitIdentity` and/or per-project
   `workerGitIdentity` if the derived default is not wanted; retires/replaces existing worker
   worktrees for tickets in flight if their history must not carry the old address.

Rollback is a code rollback: the new column is nullable and ignored by an older daemon; older workers
resume reading the clone as before.
