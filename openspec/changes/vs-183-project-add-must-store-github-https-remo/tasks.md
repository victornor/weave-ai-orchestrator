## 1. Rewrite helper

- [x] 1.1 Add `githubSshRemote(url: string): string` in `packages/core/src/util/git.ts` per design.md (GitHub owner/repo → `git@github.com:owner/repo.git`; otherwise the trimmed original). Verify with a new `packages/core/src/util/git.test.ts` table: HTTPS ± `.git` ± trailing slash, `http://`, schemeless `github.com/owner/repo`, already-SSH, `ssh://git@github.com/…`, GitLab HTTPS, local path, extra path segments, `gist.github.com`, userinfo.

## 2. Persist on add and retry

- [x] 2.1 Apply `githubSshRemote` in `createRow` before insert so `git_url` and the cfg passed to clone/yaml are SSH. Verify `packages/core/src/projects/projects.test.ts`: `startAdd` with `https://github.com/acme/api.git` stores `git@github.com:acme/api.git` on the row before clone runs (drain the detached job).

- [x] 2.2 Apply the same helper in `configFor` and write `gitUrl: cfg.url` in `retryAdd` before detaching `runAdd`. Verify a project row left in `error` with a GitHub HTTPS `git_url` has the SSH form on the row after `retryAdd`.

## 3. Checks

- [x] 3.1 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all are green.
