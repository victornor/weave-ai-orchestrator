## Why

A project whose default branch is protected cannot be promoted by the daemon's direct
`git push edge:main`: Fernwood's `main` ruleset requires a pull request (and only one sourced from
`edge`), so the first real promotion card was rejected with `GH013` and no route forward. The daemon
must promote through a pull request when the repository requires one, with honest content and a merge
the repository allows, while keeping the human's approval as the only thing that lands it.

## What Changes

- **Promote through a pull request by default.** When a forge that can open pull requests is available,
  the daemon opens (or reuses the open) pull request from the landing branch to the default branch,
  titled from policy, with a body that fills the repository's pull-request template where one exists,
  and carrying the tickets and the honest changed-file summary. On the human's approval it merges that
  pull request with a repository-allowed method, waiting for required checks, and reports progress.
- **Choose pull request vs direct push per project, safe by default.** A new `promotionMode` project
  policy (`auto` | `pull-request` | `direct-push`) defaults to `auto`: a pull request whenever a forge
  that can open one is available; direct push only for a project whose policy says so or that has no
  forge remote (scratch repositories, tests). A rejected direct push names the pull-request path rather
  than dead-ending.
- **Merge method.** `mergeMethod` stays the project policy (default `squash`); the daemon reads the
  repository's allowed methods and uses the configured one only when allowed, otherwise the repository's
  allowed method, and says which method the promotion used. It never force-pushes, admin-merges or
  changes a ruleset.
- **Honest content.** The promotion reports the tree diff (`default...landing`: files,
  insertions/deletions) and the tickets whose landing records carry it — not the `default..landing`
  commit count, which stays wrong forever after a squash promotion. The commit list is kept as labelled
  detail only.
- **Squash-aware closure.** A promotion records the forge's merge commit and stamps the included
  tickets promoted, so a squash that rewrites the ticket commits on the default branch does not read as
  unpromoted, no card reopens for content already shipped, and the next card lists only what is new.
- **Progress and holds on the project surface.** While a promotion pull request is open or its checks
  run, the project's promotion surface shows the pull-request link and state; a required check that
  fails or cannot run holds the promotion with the reason named.
- **BREAKING (spec):** the requirement that promotion is fast-forward-only and never goes through the
  forge is removed. Promotion may be performed through a pull request; it still happens only on the
  human's approval.
- Update promotion documentation (`docs/PLAN.md`, ADR 0014), the `promotionNotes` guidance, and the
  weaver/worker skill and prompt copy so nobody expects a direct push or a hand `gh pr merge`.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `ticket-delivery/promotion`: promotion may go through a pull request; its content is the tree diff; the
  strategy is a safe-by-default project policy; merge method and required checks are honoured; closure is
  squash-aware; the surface reports progress and holds with a reason.

## Impact

- `packages/shared`: `ProjectPoliciesSchema` gains `promotionMode` and `promotionPrTitle`; the promotion
  status shape gains content and in-flight fields.
- `packages/plugin-sdk`: `ForgeAdapter` gains an optional repository-merge-settings read.
- `packages/core`: `GhForge` reads the repository's allowed merge methods; the promotion service resolves
  strategy, opens/reuses the pull request, builds its body from the repository template, resolves the
  method, waits for checks, records in-flight progress and finalises squash-aware; a supervisor sweep
  advances an in-flight promotion; prompt defaults copy.
- `packages/server` / `packages/ui`: the project promotion status payload carries the content summary
  and the in-flight/held state; the Promote control shows them.
- `docs/PLAN.md`, `docs/adr/0014-project-landing-branch.md`, `skills/`, `packages/core/src/prompts/`.
- No DB migration is planned: in-flight progress rides the existing decision `target_json`. (Reviewed in
  design.md.)
