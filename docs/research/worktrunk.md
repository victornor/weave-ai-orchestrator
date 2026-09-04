# worktrunk research note (wt v0.68.0, Arch `extra/worktrunk`, verified 2026-09-03)

Verified by running the binary against a scratch repo. This is the contract the `worktrunk` WorktreeProvider (§11.5) relies on.

## Invocation shape the daemon uses

```
wt -C <primary-clone> --config <workspace>/.agent-conductor/wt.toml \
   --config-set 'worktree-path="<workspace>/workers/<workerId>/work"' -y \
   switch --create ac/<ticket>-<slug> --base main --no-cd --format json
```

- `--config <path>` selects the *user* config for this invocation, so the human's `~/.config/worktrunk/config.toml` is never read or written. `--config-set <toml>` is a repeatable inline override; a literal `worktree-path` with no template variables works (verified: worktree created at exactly `workers/01JULID/work`).
- `-y` skips approval prompts. Hooks defined in the **user** config need no approval; hooks in a repo's `.config/wt.toml` (project config) require a one-time approval on first run and are therefore avoided for daemon runs.
- `--no-cd` and `--format json` make `switch` non-interactive. Output (verified):
  `{"action":"created","branch":"ac/demo-2","path":"/…/workers/01JULID/work","created_branch":true,"base_branch":"main"}`
- Path template variables available: `{{ repo_path }}`, `{{ repo }}`, `{{ owner }}`, `{{ branch }}`, filters `sanitize`, `sanitize_db`, `codename(n)`. Since the worker id is not a variable, the daemon passes the literal path per invocation (above).

## Listing (state mirror)

`wt -C <clone> --config … list --format json --no-progressive` with `[list] json-schema = 2` in the workspace config returns an envelope:

```
{ "schema": 2, "repo": {"default_branch": "main"}, "collected": {"ci": false, "summary": false},
  "items": [ { "branch", "head": {sha, short_sha, subject, committed_at},
               "worktree": { "path", "main", "current", "detached", "branch_mismatch",
                             "changes": {staged, modified, untracked, renamed, deleted, conflicted, diff{added, deleted}} },
               "default_branch": { "ahead", "behind", "diff", "orphan", "merge_conflicts" },   // absent for the main worktree
               "upstream": {...}   // when tracking
               "display": {state, symbols, statusline} } ] }
```

This feeds the `worktrees` table and `ac_worktree_status` (dirty flags, ahead/behind, predicted merge conflicts). `--full` adds CI status via `gh`/`glab`; not needed, the daemon reads PR state itself.

## Removal semantics (verified)

- `wt remove <branch> --foreground --format json` on a **dirty** worktree refuses: "Cannot remove worktree: … has uncommitted changes … run wt remove --force". Exit code is 0 even on refusal; the daemon must check the JSON/absence of the path, not the exit code.
- On a clean worktree whose branch is **unmerged**, the worktree is removed and the branch is kept ("Branch unmerged; to delete, run wt remove -D"). The JSON reports `"branch_deleted": true` even in that case, which is wrong; trust `git branch --list`, never that field.
- `--no-delete-branch` keeps the branch explicitly; `-D` deletes an unmerged branch; `--force` removes a dirty worktree. Removal is background by default (rename into `.git/wt/trash/`, swept after 24 h); `--foreground` blocks.
- Branch cleanup checks six merged-ness conditions (same commit, ancestor, empty three-dot diff, tree match, simulated merge adds nothing, patch-id match against a squash commit). This is a superset of the plan's landed-work test for the *branch* half; the daemon still applies its own rule (remote reachability or merged PR containment) before calling `remove`, and passes `--no-delete-branch` unless landed.
- `--reap` (experimental) kills detached processes whose cwd is under the worktree before removal; `wt step tether -- <cmd>` ties a process tree to the worktree's lifetime. The daemon manages worker processes itself, so these are optional.

## Hooks

Events: `pre-switch`/`post-switch`, `pre-start`/`post-start` (worktree creation), `pre-commit`/`post-commit`, `pre-merge`/`post-merge`, `pre-remove`/`post-remove`. `pre-*` block and abort on failure; `post-*` run in the background with logs under `.git/wt/logs/`. Template variables include `{{ branch }}`, `{{ worktree_path }}`, `{{ worktree_name }}`, `{{ commit }}`, `{{ base }}`, `{{ base_worktree_path }}`, `{{ target }}`, `{{ vars.* }}`. Forms: single string, table (concurrent), array-of-tables (pipeline). Per-project overrides in user config under `[projects."github.com/owner/repo"]` (scalars replace, hooks append).

Daemon's generated `.agent-conductor/wt.toml` (user-config format, per workspace):

```toml
[list]
json-schema = 2

[projects."<host>/<owner>/<repo>"]        # one block per project, identifier from `wt config show`
[[projects."<host>/<owner>/<repo>".pre-start]]
warm = "wt step copy-ignored --from main --to '{{ branch }}'"   # copies gitignored caches (node_modules, target/) from the primary clone
[[projects."<host>/<owner>/<repo>".pre-start]]
setup = "<project.setup_command>"                              # e.g. pnpm install
```

`pre-start` (blocking) is chosen over `post-start` so the worktree is fully set up before the worker's first turn.

## Not used

- `wt merge` (commit → squash → rebase → hooks → ff-push → remove): the plan's merge is performed by the worker through the forge PR (`gh pr merge`) so branch protection and CI apply; `wt merge` may be offered by the provider's optional `syncBase` for the `local-branch` delivery mode only.
- LLM commit generation, picker, aliases, PR shortcuts (`pr:N`).
- `wt config shell install` (directory switching) is for humans, not the daemon.
