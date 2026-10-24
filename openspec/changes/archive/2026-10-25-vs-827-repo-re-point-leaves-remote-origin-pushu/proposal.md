## Why

VS-811's re-point runs `git remote set-url origin <new>`, which changes only the fetch URL. A `remote.origin.pushurl` already on the clone survives, and git prefers it for `git push origin …`, so after a re-point ticket branches and PRs are still pushed to the old repository, silently. Found live during the WeaveAI migration (2026-10-24).

## What Changes

- `repointOrigin` also clears any `remote.origin.pushurl` after setting the fetch URL, so push follows the new URL.
- After the re-point it checks that both `git remote get-url origin` and `git remote get-url --push origin` equal the new URL, and fails the re-point (with rollback) if not.
- Rollback on any failure after the first write restores the previous fetch URL and any previous push URLs.
- Tests: a clone with a distinct `pushurl` ends with both URLs on repo B; a failed fetch restores both.
- Not changed: a stray `[branch "ac/vs-147-…"] remote = <url>` on the live clone is outside the re-point; noted in the ticket, not normalised here.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `project-repo-url`: re-pointing moves the push URL as well as the fetch URL.

## Impact

`packages/core/src/projects/index.ts` (`repointOrigin`) and `projects.test.ts`.
