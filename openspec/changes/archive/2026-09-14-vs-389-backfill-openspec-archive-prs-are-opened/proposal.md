## Why

Three `done` tickets (VS-334, VS-338, VS-339) left their OpenSpec changes unarchived on `main`. When a change is archived after the fact, `openspec.archiveAfterMerge` backfills it on a fresh `ac/archive-<change>` branch and opens a pull request — deliberately, so nothing is pushed straight to a protected branch. But that pull request is recorded only as an activity entry and a transient `ticket.updated` event: no decision is raised, the weaver is never woken, and the ticket is already `done`, so the pull request is invisible and never merged. `openspec/specs` therefore lacks VS-334's `plugins` capability and VS-338's and VS-339's, which already breaks new work — VS-385's `plugins/web-pages` MODIFIED delta has no base spec to modify.

## What Changes

- **A backfill archive pull request raises a merge approval.** When the daemon opens, or finds already open, an `ac/archive-<change>` pull request for a finished ticket, it raises exactly one open `merge_approval` card — owner human, attached to the ticket it belongs to, carrying the pull request link, reviewable by the weaver as any merge card is. The ticket stays `done`.
- **Approving it lands the archive like a ticket merge.** The daemon rebases the archive branch when stale, waits for the project's required checks, merges with the configured method under the project's one-landing-at-a-time serialization, and records the archive on the ticket. The ticket is never moved out of `done`.
- **No automatic landing without approval.** With YOLO off the pull request is not merged until the card is answered `approve`; under YOLO the daemon grants the approval itself, exactly as it does for a ticket merge. `auto_merge` is meaningless for a card whose ticket already finished.
- **The sweep converges existing strays.** The reconciliation sweep already backfills left-behind changes; it now also raises the card for an already-open archive pull request, so #282, #313 and #314 surface as soon as this lands, and retries an approved card whose landing could not complete (a rebase conflict or pending/failed checks).
- **A closed-unmerged archive pull request is recorded and replaced.** The daemon records that the pull request was closed unmerged and lets the sweep open a fresh one, whose own card is raised. It never reopens a closed pull request silently.
- **Visibility.** While an archive pull request is open, the ticket's delivery record carries its URL and the ticket detail view and the Work board card show "spec archive pending" with the link; the mark clears once the change is archived on the landing branch.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `ticket-delivery/openspec-archival`: a backfill archive pull request is surfaced as a merge approval, converged by the sweep, landed on approval, retried after a failed landing, and made visible on the ticket; a closed-unmerged one is recorded and replaced.
- `human-decisions/approval-integrity`: an archive-backfill merge approval stays attached to its already-finished ticket and is exempt from the withdrawal paths that close a terminal ticket's stale cards.

## Impact

- `packages/core/src/openspec/index.ts` — `archiveAfterMerge` records the pending pull request on the ticket's delivery and returns the change/branch/URL; detects a closed-unmerged pull request and opens a fresh one.
- `packages/core/src/tickets/service.ts` — `mergeDone` keeps the backfill result; a landing path for an approved archive pull request; the archive sweep/convergence pass.
- `packages/core/src/decisions/service.ts` — `create` keeps a terminal ticket's attachment for an archive-backfill merge card; `applyMergeApproval` lands the archive instead of transitioning the ticket.
- `packages/core/src/supervisor/index.ts` — the reconciliation pass raises cards for existing open archive pull requests and retries pending landings.
- `packages/ui/src/v2/ticket/Ticket.tsx`, `packages/ui/src/v2/work/Work.tsx` — the "spec archive pending" mark with its link.
- Optional forge read (`listPullRequests`) for the closed-unmerged branch; `ForgeAdapter` is unchanged if the existing optional list method suffices.
- No database migration: the ticket's `delivery_json` is free-form JSON.
- Tests: `packages/core/src/openspec/service.test.ts`, `packages/core/src/tickets/merge-done*.test.ts`, `packages/core/src/decisions/decisions.test.ts`, a sweep/reconcile test, and `packages/ui` tests. Fake forges and temp repos only — never live GitHub or the real PRs #282/#313/#314. Test commands run with `XDG_CONFIG_HOME="$(mktemp -d)"` until VS-388 lands.
