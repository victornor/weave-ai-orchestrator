## Why

agent-conductor is about to be published. The VS-796 audit found internal hostnames, other-project names and wrong documentation claims in the tree, no community files, a Google Fonts request that contradicts the README's "nothing phones home", and stale remote branches. This change is the docs-and-hygiene half; CI runner, dependency and auth fixes are a separate ticket.

## What Changes

- Scrub internal topology and other-project references (OPERATIONS §9, credentials test fixture, archived OpenSpec proposals, other-workspace ticket IDs, design-tool upload prompts).
- Add CONTRIBUTING, SECURITY (GitHub private reporting, no email), CODE_OF_CONDUCT (Covenant 2.1), CHANGELOG, CODEOWNERS, issue and PR templates; README points at CONTRIBUTING.
- Self-host Inter and JetBrains Mono (OFL, licences bundled) and verify the built UI makes no external request.
- Correct README/CLAUDE.md claims: visual contract location, `conductor` alias, HTTPS clone, Node/pnpm versions aligned across README, CI, `mise.toml`, Dockerfile.
- Renumber duplicate ADRs 0012/0013 (worker-model-options → 0023, daemon-model-overrides → 0024) and update links.
- Delete 7 stale remote branches (dry-run first; the two closed-unmerged ones only after the PR merges).

## Impact

Docs, test fixtures, comments, UI font assets and `index.html`. No runtime behaviour change. No spec deltas (`skip_specs`).
