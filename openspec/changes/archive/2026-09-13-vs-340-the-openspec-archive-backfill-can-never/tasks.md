## 1. Fix the `gh` backfill PR creation

- [x] 1.1 In `packages/core/src/forge/gh.ts`, add an exported pure `parsePullRequestUrl(text:
  string): { url: string; number: number } | null` that matches the first `.../pull/<number>` URL in
  the text and returns it with the parsed number, else `null`.
- [x] 1.2 Rewrite `GhForge.createPullRequest` to build exactly
  `['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body ?? '']` — no
  `--json` — and to derive `{ url, number }` from the printed URL via `parsePullRequestUrl`. A
  non-zero exit keeps the existing `gh pr create failed` error; stdout with no parseable URL raises a
  recorded `OcError` naming the branch.
- [x] 1.3 Add `GhForge.pullRequestForBranch(cwd, branch): Promise<{ url: string; number: number } |
  null>` using `['pr', 'list', '--head', branch, '--state', 'open', '--limit', '1', '--json',
  'url,number']`, returning the first entry or `null` for an empty list; a non-zero exit or
  unparseable JSON throws the same recorded error style as the other methods.
- [x] 1.4 Add the optional `pullRequestForBranch?(cwd: string, branch: string): Promise<{ url:
  string; number: number } | null>` to `ForgeAdapter` in `packages/plugin-sdk/src/index.ts`, with a
  doc comment saying it is used by the OpenSpec archive backfill to recognise a PR an earlier attempt
  opened before failing.

## 2. Make the backfill retry converge

- [x] 2.1 In `packages/core/src/openspec/index.ts`'s `archiveAfterMerge`, resolve the forge before
  the branch check so both the lookup and the open use it.
- [x] 2.2 When the `ac/archive-<change>` branch already exists on the remote: call
  `forge.pullRequestForBranch` (when the forge implements it). If it returns a PR, record activity
  `openspec.archive_pr_opened`, emit `openspecArchivePendingPrUrl` on the ticket and return
  `{ archivedAs: null, skipped: null, pendingPrUrl }` without opening anything.
- [x] 2.3 When the branch exists and no open PR is found, open the PR from the existing branch via
  `forge.createPullRequest`, then record it and return the same `{ archivedAs: null, skipped: null,
  pendingPrUrl }` shape. The `already pending` skip is removed.
- [x] 2.4 Keep the branch-absent path as it is today: archive on the scratch branch, commit, push,
  then open and record the PR.
- [x] 2.5 When no forge can open a PR at all, keep raising the existing "no forge available that can
  open a backfill pull request" error — never skip silently.

## 3. Tests

- [x] 3.1 In `packages/core/src/forge/gh.test.ts`, make the fake `gh` write one argument per line so
  the exact argv can be asserted without changing the existing `toContain` assertions.
- [x] 3.2 Add a `parsePullRequestUrl` test: a URL-only stdout gives the number; text with no PR URL
  gives `null`.
- [x] 3.3 Add a `createPullRequest` test asserting the exact argument list, that it contains no
  `--json`, and that a URL-only stdout yields the URL and number; and a test that an unparseable
  stdout throws.
- [x] 3.4 Add a `pullRequestForBranch` test asserting its exact args (`--head`, `--state open`,
  `--json url,number`) and that it returns the PR from a one-element list and `null` from `[]`.
- [x] 3.5 In `packages/core/src/openspec/service.test.ts` (`pr` delivery backfill), add: a retry with
  the branch already pushed and no open PR opens one and records `pendingPrUrl`; a retry with the
  branch pushed and an open PR records it, opens nothing, and returns its URL; and the existing
  "does not open a second pull request" test is updated to the found-PR premise instead of
  branch-existence-already-pending.
- [x] 3.6 Confirm the new retry tests fail against the pre-change `archiveAfterMerge` (which skips on
  branch existence) and the create-args test fails against the pre-change `createPullRequest`.

## 4. Scan the rest of the forge for the same class of bug

- [x] 4.1 Check every `gh` invocation in `packages/core/src/forge/gh.ts` for `--json` on a
  subcommand that does not accept it. Record the conclusion (only `pr create` was wrong; `pr view`
  and `pr list` legitimately take `--json`; `pr merge`, `pr diff` and `auth status` do not use it) in
  the ticket comment or the task note.

## 5. Spec and verification

- [x] 5.1 The `ticket-delivery/openspec-archival` delta in `specs/` is written as part of this
  change's planning; adjust the wording only if implementation shows it wrong.
- [x] 5.2 Run `openspec validate vs-340-the-openspec-archive-backfill-can-never --json --strict` and
  verify it is clean.
- [x] 5.3 Run `pnpm lint` and `pnpm typecheck`; verify both are clean.
- [x] 5.4 Run `pnpm test` (core/server suite) and
  `pnpm --filter @weave-ai/ui exec vitest run` separately; paste both suite blocks verbatim in the
  report and verify both pass, including every new test above.
- [x] 5.5 Confirm no live GitHub call, daemon, systemd unit or credential was used, and that no
  database migration, HTTP route, MCP tool or CLI command was added.
