## Approach

Order inside `update()`, before any DB or config write, when `patch.url` is set and differs from `project.gitUrl`:

1. Refuse if the project is not `ready` or a job is running on it.
2. Probe the candidate with `git ls-remote --heads <url> <defaultBranch>` (local paths resolved as `clone()` does). Non-zero exit → `validation` error "cannot reach <url>"; empty output → `validation` error "default branch '<b>' not found on <url>". This never touches the clone, so refusal is trivially side-effect free.
3. `git remote set-url origin <url>` then fetch (`fetchOriginWithRetry`). If the fetch fails, restore the previous origin URL and throw.
4. Only then continue with the normal path, adding `gitUrl` to the `ctx.db.update('projects', …)` and the merged config (already carries `url`).

Local `origin/*` refs from the old remote are replaced by the fetch (`--prune` semantics as used by the existing fetch helper); history shared with the old repo is expected, as in the migration this serves. Old repo is never written to.

UI: a text field in the project editor beside the existing controls, with a Save that sends `{ url }` through the existing update mutation; error text from the response is shown inline and the draft stays for correction.

## Alternatives

Re-cloning into a new path was rejected: it would orphan worktrees and the clone path other rows reference.
