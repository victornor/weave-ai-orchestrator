## Context

VS-389 made the reconciliation sweep (`reconcileOpenSpecArchives`, hourly) open a draft archive PR for a finished ticket's leftover change and raise a human `merge_approval` (`merge_approval:archive:<ticket>:<change>`). Approving lands it via `tickets.landArchiveBackfill`, which already runs the project-serialized archive-then-merge with rebuild-on-conflict and never touches ticket status. The card is the only human-facing part; the landing machinery is already system-safe (`landArchiveBackfill` is called with `SYSTEM` by the sweep's retry path).

## Decisions

1. **Land directly, drop the card.** Both places that call `raiseArchiveBackfillCard` (the sweep and `mergeDone`'s out-of-band path) call `landArchiveBackfill(SYSTEM, …)` instead. Alternative considered: keep a card but auto-answer it as system. Rejected: the card row still exists, shows in Needs you until answered, and drags the weaver-review gate (VS-474) in for housekeeping.
2. **The sweep drives retries from the pending PR, not an approved card.** The retry currently keys off an answered-`approve` card; it now keys off the ticket's pending archive PR (`res.pendingPrUrl` / stored `pendingPrUrl`). `landArchiveBackfill` already returns `{landed:false}` and records a deduped failure for pending checks, so calling it every pass is safe. Concurrent landings are covered by the per-project `serialize`.
3. **Legacy cards.** The sweep withdraws any open `merge_approval:archive:%` decision on the ticket via `decisions.withdraw` before landing. The answer path (`applyMergeApproval` archive branch) and `declineArchiveBackfill` stay so a card answered by a human in flight still behaves, but nothing raises new ones. `raiseArchiveBackfillCard` is removed from the service API.
4. **Weaver prompts.** Repo prompts and skills contain no instruction to approve archive backfills (checked); a test guards the shipped prompts against re-introducing it.

## Risks

- A bad archive now lands without a human seeing it. Mitigation: the landing already requires green required checks and refuses on `openspec archive` failure, and it only ever adds the archived change, exactly what the ticket-merge path does unattended.
- The sweep now merges on the forge every hour for stragglers; `landArchiveBackfill` skips a PR already merged/closed.
