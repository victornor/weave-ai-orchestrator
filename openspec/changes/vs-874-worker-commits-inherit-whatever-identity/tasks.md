## 1. Configuration and storage

- [ ] 1.1 Add `WorkerGitIdentitySchema` (`name`, `email`) to `packages/shared/src/config.ts`, the nullable `defaults.workerGitIdentity` workspace default, the optional `workerGitIdentity` project field, and the `workerIdentity` field on the `Project` type.
- [ ] 1.2 Add migration `0064_project_worker_identity.sql` (`projects.worker_identity_json TEXT`) and round-trip the project field through `createRow`, `update` and `configFor` in `packages/core/src/projects/index.ts`.
- [ ] 1.3 Test that a project's `workerGitIdentity` survives add/update in both the row and `workspace.yaml`, and that a workspace default parses with and without the field.

## 2. Resolve, then write it at provisioning

- [ ] 2.1 Add to `packages/core/src/util/git.ts`: `defaultWorkerGitIdentity` (one generic `Weave AI <weave-ai@users.noreply.github.com>` for every remote), `looksPersonalGitEmail` and `resolveWorkerIdentity` (project → workspace → default, with the source returned), as pure functions.
- [ ] 2.2 Replace `requireGitIdentity(project.clonePath)` at the three provisioning sites in `packages/core/src/workers/index.ts` with the resolver, still writing the result through `configureGitWorktreeIdentity`; remove `requireGitIdentity`.
- [ ] 2.3 Replace the worktree/clone identity read in `packages/core/src/runs/engine.ts` with the same resolver for the turn's `GIT_AUTHOR_*`/`GIT_COMMITTER_*` environment.
- [ ] 2.4 Test, through `workers.spawnForTicket`, that `git var GIT_AUTHOR_IDENT` inside the new worktree (with `GIT_AUTHOR_*`/`GIT_COMMITTER_*` unset) reports the resolved identity: project override beats workspace and clone; workspace beats clone; a personal clone identity with nothing configured yields the generic default; an identity-less clone still provisions.
- [ ] 2.5 Test the pure functions: one generic default for a GitHub and a non-GitHub remote alike, and the personal-address heuristic (personal, `users.noreply.github.com`, `noreply@`).
- [ ] 2.6 Update the engine test so the turn environment carries the configured/resolved identity rather than the worktree's legacy config.

## 3. One-time existing-state signal

- [ ] 3.1 Add `reportInheritedWorkerIdentities(ctx)` in `packages/core/src/projects/identity.ts`: for each ready project with no configured identity, read the clone identity, and when it looks personal emit one `log.warn` and write a `worker_identity_warning:<projectId>` `meta` marker; return the findings.
- [ ] 3.2 Call it once from the supervisor's startup path (alongside `bootRecovery`), best-effort.
- [ ] 3.3 Test that a personal-identity clone is reported on the first call and not the second, and that a project with a project or workspace identity, or a non-personal clone address, is never reported.

## 4. Documentation

- [ ] 4.1 Document `defaults.workerGitIdentity` and `projects[].workerGitIdentity` in `docs/CONFIGURATION.md`, including precedence, the generic default, and how an operator sets an account-linked `<numeric-id>+<login>@users.noreply.github.com` address themselves.
- [ ] 4.2 Add an `docs/OPERATIONS.md` section: where to set the identity, what the startup warning means, and the one-time action for a workspace whose existing clone/worktrees carry a personal address.

## 5. Verification

- [ ] 5.1 Run the touched test suites, then `pnpm test` for both core and UI; paste both suite blocks verbatim in the ticket and PR.
