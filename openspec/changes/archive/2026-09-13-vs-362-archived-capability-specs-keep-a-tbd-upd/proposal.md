## Why

`openspec validate --all --strict` fails on `main` because 24 capability specs under `openspec/specs/**` still carry the Purpose that `openspec archive` writes when it creates a capability: "TBD - created by archiving change <name>. Update Purpose after archive." Nothing replaces it, so every change that introduces a capability adds another red spec and the repo-wide strict check can never pass.

## What Changes

- **Backfill.** Replace the placeholder Purpose in each of the 24 affected specs with a real one- to three-sentence Purpose written from that spec's own requirements, using the originating change's proposal "Why" where that change still exists under `openspec/changes/archive/`.
- **Stop new placeholders.** After the daemon archives a change, give every capability spec the archive created whose Purpose is still the placeholder a real Purpose taken from the archived change's proposal "Why" (its first paragraph, trimmed). When that change has no usable "Why", do not complete the archive: fail it with a message naming the capability and saying what to add, rather than land a placeholder.
- **Both archive paths.** Apply the same fill-or-fail step to the archive-then-merge step and to the reconciliation backfill, on both the local-branch and pull-request paths, before the archive is committed or pushed.
- **Guard.** Add a repository check that fails when any `openspec/specs/**/spec.md` still contains the archive placeholder sentence, so it cannot return unnoticed.
- **Guidance.** Add the rule to the worker-facing OpenSpec propose guidance: a change that creates a capability must give that capability its own `## Purpose` in the delta, which `openspec archive` carries over when it builds the main spec.

## Capabilities

### New Capabilities
- `ticket-delivery/openspec-spec-purpose`: every capability spec carries an authored Purpose; the daemon fills a newly created capability's Purpose from the archived change's proposal or refuses to complete the archive; a repository check rejects the placeholder; the OpenSpec propose guidance tells a proposer how to write one.

### Modified Capabilities

None. The behavior is one cross-cutting invariant, and the failure path for a change with no usable "Why" is already an archive failure, which `ticket-delivery/archive-before-merge` ("An archive failure blocks the merge entirely") and `ticket-delivery/openspec-archival` ("An archive failure carries the validator's own reason") already cover.

## Impact

- `packages/core/src/openspec/` — a new `purpose.ts` leaf helper (placeholder detection, proposal "Why" extraction, fill, repo scan); `cli.ts` is unchanged.
- `packages/core/src/tickets/archive-before-merge.ts` (`archiveOnBranch`) — fill after `openspec archive` and before the archive commit.
- `packages/core/src/openspec/index.ts` (`archiveAfterMerge`) — fill on the local-branch commit path and on the pull-request scratch branch before its commit and push.
- `openspec/specs/**` — 24 backfilled Purposes.
- `skills/weave-ai-openspec/SKILL.md` — the propose-time rule.
- A new guard test under `packages/core/src/openspec/`, plus tests for the helper and both archive paths.
