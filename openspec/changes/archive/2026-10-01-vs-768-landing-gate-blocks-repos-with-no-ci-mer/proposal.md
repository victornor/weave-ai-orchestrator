## Why

On 2026-09-30 ACME-276 (repo `acme/widget-app`, PR #51, no workflows, empty `statusCheckRollup`, `mergeStateStatus` CLEAN) was refused `merge_checks_pending` five times in about eight minutes and held the merge slot for over twenty until captain merged it by hand. The landing gate (VS-393/VS-466/VS-467) is meant to merge a repository with no CI immediately; here it never did. Reading `attemptArchiveThenMerge` against that evidence finds two defects that each produce exactly this, plus two that make the bounded wait unreliable:

1. **A failed "does this repo have workflows" query is cached as an answer.** `repoHasCiWorkflows` (`packages/core/src/tickets/archive-before-merge.ts:200-207`) stores `null` from a failed or timed-out `gh api …/actions/workflows` for five minutes (`CI_WORKFLOWS_TTL_MS`, line 167) and returns it to every later `merge_done` without asking again. The incident had a GitHub SSH timeout in the same window; one transient failure turns every retry for five minutes into "cannot classify", which waits for the ten-minute grace (`CI_NONE_GRACE_MS`, line 156) — longer than the five refusals the worker made before the slot alarm fired.
2. **The workflow count includes workflows that are not files and cannot run on a pull request.** `GhForge.hasCiWorkflows` (`packages/core/src/forge/gh.ts:330-333`) reads `.total_count`, which also counts GitHub's built-in "dynamic" workflows (Dependabot updates, default-setup CodeQL, Copilot review) and disabled workflows. A repository with none of its own workflow files but one of those reports `true`, so the gate takes the VS-466 path (line 314) and waits forever for a run that never comes, retriggering an empty commit as it goes. This fits the evidence equally well and could not be ruled out without reading the repository's own Actions list, which belongs to another project.
3. **The no-CI wait is keyed on the pull request and wiped by unrelated observations.** `noneSinceByPr` (line 164) is deleted when the forge reports a head other than the one just pushed (line 300) and whenever the rollup reads `pending` (line 304), so a lagging head read restarts the ten minutes.
4. **No ticket comment records a landing that skipped CI because the repository has none** — only the timeout path comments (`onNoCiTimeout`).

The combined-status candidate from the ticket is not a cause in the current code: the gate never calls the combined-status endpoint (`rg combined` finds nothing), and `rollupState([])` already returns `none` (`packages/core/src/forge/gh.ts:217-218`). It is pinned with a test rather than changed.

## What Changes

- `hasCiWorkflows` counts only active workflows whose path is under `.github/workflows/`, so dynamic and disabled workflows do not make a repository look like it has CI. Requests `per_page=100` so the first page cannot be all dynamic entries.
- The landing sequence never caches a failed classification, and retries the query a few times (short, injectable delay) within one attempt before giving up on it.
- When a repository still cannot be classified, the no-CI wait is measured from the first attempt for that head, kept in one per-(pull request, head) entry that survives later `merge_done` calls, a lagging head read and pending reads. Once it elapses the sequence lands as VS-393 does and comments.
- A landing that proceeds because the repository has no workflows records one ticket comment saying so; this holds with the default `requireCi`.
- Behaviour is unchanged for a repository that has workflow files: an absent, all-skipped, cancelled or wrong-head rollup still never passes (VS-466), and a success on the exact head lands. `requireCi: false` stays the explicit override.
- Both behaviours are documented in `README.md` and `docs/PLAN.md`.

## Capabilities

### Modified Capabilities
- `ticket-delivery/archive-before-merge`: the "no CI, or one the forge cannot classify, still lands" requirement is tightened: classification ignores non-file workflows, a failed query is retried and never cached, the wait is anchored to the first attempt per head, and a no-workflow landing is recorded on the ticket.

## Impact

- `packages/core/src/tickets/archive-before-merge.ts`, `packages/core/src/forge/gh.ts`, `packages/core/src/tickets/service.ts` (one new callback and comment), their tests, `README.md`, `docs/PLAN.md`.
- No schema, API or config change. Out of scope: `promotion/index.ts:291` has its own `requireCi` check and is not touched.
