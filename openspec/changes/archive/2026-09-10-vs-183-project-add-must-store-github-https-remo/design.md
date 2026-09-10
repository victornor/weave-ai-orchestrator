## Context

See proposal.md for motivation. `createProjectsService` (`packages/core/src/projects/index.ts`) stores `cfg.url` on the row (`git_url`) in `createRow` and later writes the same string into `workspace.yaml` via `upsertConfigBlock`. `clone()` then `git clone`s that URL. Every add surface funnels here: `POST /projects` → `startAdd`, CLI, onboarding, `ac_project_add` → `add`, reconcile → `add`. `update()` does not write `gitUrl`. `retryAdd` rebuilds config from the row / yaml via `configFor` and does not currently rewrite `git_url`.

`projectKeyFromUrl` in `packages/core/src/util/git.ts` already parses scp-style, `https://`, and `ssh://` into `host/owner/repo`. There is no rewrite today.

Workers run as the daemon user and authenticate to GitHub with SSH keys (`ssh -T git@github.com`). HTTPS remotes prompt or fail (`GIT_TERMINAL_PROMPT=0` on daemon git).

## Goals / Non-Goals

**Goals:**

- One pure helper that maps a GitHub owner/repo paste onto `git@github.com:owner/repo.git`.
- Applied once, before persist, so clone, yaml, and later fetch/push all see SSH.
- Retry of a failed HTTPS add also rewrites and writes the SSH form back onto the row.

**Non-Goals:**

- Not migrating `ready` projects already stored as HTTPS.
- Not rewriting GitLab / GitHub Enterprise / gist.github.com / extra-path GitHub URLs.
- Not changing `update()` to accept a new url (it still does not).
- Not UI/CLI copy, placeholders, or Telegram/TUI.
- Not teaching other workspaces' conductors.

## Decisions

### Rewrite in core, not per surface

Apply the helper in `createRow` (before insert) so CLI, Settings, onboarding, `ac_project_add` and reconcile all inherit it. `slugFromUrl` on `POST /projects` still runs on the original paste and already yields the repo tail from either form.

*Alternatives considered.* Rewrite only in the Settings form: would miss CLI and `ac_project_add` (the conductor path that refused the HTTPS paste). Rejected. Rewrite in `ProjectConfigSchema`: Zod belongs to shape, not host-specific policy, and shared cannot grow GitHub-only git logic without a new home. Rejected.

### Pure helper next to `projectKeyFromUrl`

`githubSshRemote(url: string): string` in `packages/core/src/util/git.ts`. Returns the canonical SSH form when the input is a GitHub owner/repo remote; otherwise returns the trimmed original. Rules:

1. Trim. If `looksLocal` (absolute / `.` / `~` / existing path) **and** the string does not match `github.com/owner/repo`, return as given. A schemeless `github.com/owner/repo` paste is never treated as local even if `existsSync` would fire relative to cwd.
2. Accept: `https://` / `http://` github.com/owner/repo[/.git][/], `ssh://git@github.com/owner/repo.git`, `git@github.com:owner/repo.git`, schemeless `github.com/owner/repo`. Host match is case-insensitive `github.com` only (not `www.github.com`, not `gist.github.com`, not GitHub Enterprise).
3. Path must be exactly two segments after stripping a trailing `.git` and trailing slashes. Extra segments (`/tree/main`, `/issues/1`) → unchanged.
4. Drop userinfo (`https://user:token@github.com/…`) by converting; do not log the original when it contained userinfo.
5. Output is always `git@github.com:${owner}/${repo}.git` with the owner/repo casing preserved.

Unit-test the table in `packages/core/src/util/git.test.ts` (new file next to `git.ts`; there is no existing colocated test).

*Alternatives considered.* Reuse `projectKeyFromUrl` then reassemble: it maps unknown forms to `local/…`, which would wrongly rewrite a local path that happens to look like a URL. Keep it independent; both can share a future parser later. Rejected for this ticket.

### Persist the rewrite on retry

`retryAdd` currently clones whatever `configFor` rebuilt. If the failed attempt stored HTTPS, retry would keep HTTPS. After rewriting `cfg.url` in `createRow`, also:

- Rewrite in `configFor` (so a yaml/row HTTPS value becomes SSH on retry).
- `retryAdd` writes `gitUrl: cfg.url` onto the row before detaching `runAdd`.

`runAdd` already clones `cfg.url` and upserts that cfg, so yaml follows.

*Alternatives considered.* Migrate every existing HTTPS row on startup: out of scope; a ready project may have a working HTTPS credential helper. Retry is the one in-flight case that would otherwise keep failing.

### Tests at two layers

1. Helper table: HTTPS ± `.git`, trailing slash, `http://`, schemeless, already-SSH, `ssh://`, GitLab HTTPS, local path, extra path segments, `gist.github.com`, userinfo.
2. `projects.test.ts`: `add` with `https://github.com/acme/api.git` against a local source is awkward (clone would hit the network). Do **not** network. Assert the helper output in the git unit tests, and in `projects.test.ts` spy/assert that the **stored** `gitUrl` and saved yaml url equal the helper's result when `createRow` is exercised with a GitHub HTTPS url — the existing local-repo add still uses a filesystem path (unchanged). A focused test can call `createRow` indirectly via `startAdd` with a GitHub HTTPS url **if** clone is not awaited, or unit-test that the config written at declare time used the rewritten url by stubbing clone. Prefer: export the helper, unit-test it thoroughly, and add one `projects.test.ts` case that inspects the row immediately after `startAdd` (clone will fail in the detached job against a fake GitHub URL; drain the job) and asserts `gitUrl` was already SSH before clone ran.

The last option is the acceptance "a test covers the rewrite" at the persist boundary. Drain the job in `afterEach` as the file already does.

## Risks / Trade-offs

- [Public repo HTTPS clone works today via anonymous HTTPS; SSH requires a GitHub key] → The daemon host is already expected to have `ssh -T git@github.com` (OPERATIONS.md). Anonymous HTTPS add of a public repo the worker cannot push to is the bug. Accept.
- [Userinfo tokens in the paste are dropped] → Intended; we must not persist HTTPS credentials in yaml. Do not log the pre-rewrite URL when it contains `@` before the host.
- [Existing ready HTTPS projects stay HTTPS] → Named non-goal. A later ticket can rewrite on fetch if it bites.
- [www.github.com / gist.github.com unchanged] → Host is exactly `github.com`. Unusual pastes stay as given rather than guessing.

## Migration Plan

None. Rollback is revert. No data migration.

## Open Questions

None.
