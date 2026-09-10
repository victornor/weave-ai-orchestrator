## Why

Captain, 2026-09-10: pasting a GitHub HTTPS URL (`https://github.com/victornor/WidgetShop`) into project add stored that URL as-is. Workers have SSH keys, not HTTPS credentials, so later push/fetch prompts or fails. GitHub's SSH equivalent is always `git@github.com:owner/repo.git`. They expected automatic conversion, not a re-paste.

## What Changes

- When a project is added (CLI, Settings, onboarding, `ac_project_add`, reconcile from `workspace.yaml`), a GitHub HTTPS URL — with or without `.git` — is rewritten to `git@github.com:owner/repo.git` before it is persisted. The add is not blocked and the human is not asked to re-paste SSH.
- The same rewrite applies to a schemeless `github.com/owner/repo` paste.
- The rewritten URL is what is stored on the project row (`git_url`) and in `workspace.yaml` (`projects[].url`), and is what `git clone` / later fetch and worker push use.
- Non-GitHub HTTPS remotes (GitLab, Codeberg, a self-hosted host, …) are stored unchanged.
- Already-SSH GitHub URLs (`git@github.com:…`, `ssh://git@github.com/…`) are stored as the canonical `git@github.com:owner/repo.git` form (idempotent).
- Existing projects already stored as HTTPS are not migrated. A failed add that is retried does rewrite on retry.

## Capabilities

### New Capabilities

- `workspace-setup/github-ssh-remote`: GitHub project remotes are persisted as SSH so workers can clone, fetch and push with the daemon user's existing SSH keys.

### Modified Capabilities

(none)

## Impact

- `packages/core/src/util/git.ts` — pure rewrite helper next to `projectKeyFromUrl`.
- `packages/core/src/projects/index.ts` — apply it in `createRow` (and on retry) so every add surface inherits it: `POST /projects`, `conductor project add`, onboarding, `ac_project_add`, reconcile.
- `packages/core/src/util/git.ts` tests (or colocated `git.test.ts`) — table of HTTPS / schemeless / SSH / non-GitHub / local path cases.
- `packages/core/src/projects/projects.test.ts` — an add with a GitHub HTTPS URL stores the SSH form on the row and in the saved config.
- No schema, no new route, no UI copy change. Placeholders already show `git@github.com:…`.
- Not Telegram / TUI. Not rewriting remotes on hosts other than `github.com`. Not migrating ready projects already stored as HTTPS.
