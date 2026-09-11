## Why

On 2026-09-11 a standard-tier OpenCode worker on [VS-234](conductor://tickets/VS-234) failed with `provider_quota`. The provider already named the reset — `Usage limit reached for 5 hour. Your limit will reset at 2026-09-12 01:54:35`. Read as UTC that clock is nine hours out, which is impossible for a five-hour window; the real instant is `2026-09-11T17:54:35Z` (about five hours from the first exhausted-window request). The retry card recommended `retry_1h` anyway, and there was no way to send the last few seconds of bookkeeping to a working tier. The work was committed, pushed, and green.

## What Changes

- **Keep the provider's own words.** `classifyError` currently replaces every quota match with the generic `'provider rate limited, usage limit or quota exceeded'`, so `parseResetTime` never sees the timestamp. The stored failure message (pause detail and card) SHALL be the runtime's text, truncated with the existing marker, not a family label.
- **Parse the reset time from captured provider text.** When that text carries a timestamp, the card states it and recommends retrying after that moment (`retry_at_reset`). `now` is the failure instant, not the window start. A naive clock is not assumed to be UTC: when the same text names a window length, keep whole-hour-offset readings that fall after now and within one window (plus slack), and take the earliest. Unparseable, past, beyond-window, or absurdly far-future values fall back to today's `retry_1h`. Relative and clock forms that already work stay. The parser is written from captured strings (quoted in design.md), not invented fixtures.
- **Offer a human-owned tier switch on this card only.** A `provider_quota` parking decision offers each *other* configured worker-model catalog option as an answer, alongside retry / retry-at-reset-or-hour / cancel. Taking one writes that option onto the ticket and resumes the same worker on the same worktree, branch and commits. Nothing switches without that answer. Create, assign, and HTTP still refuse a model change after spawn.
- **Not changed:** the automatic retry ladder, any other pause reason, automatic provider failover, a general "change the model whenever" API, or YOLO auto-answering this card.

**BREAKING:** none. Existing `retry` / `retry_1h` / `retry_at_reset` / `cancel` keys stay. Switch keys are additive and only appear when the catalog has another option.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `run-recovery/stuck-worker-parking`: a usage-limit card keeps the runtime's own message so a reset timestamp can be parsed from it; when a trustworthy reset is known the recommendation is after that time; the card offers other catalog worker-model options on quota failures only; answering one of those keeps the worktree; no switch happens without a human answer. Non-quota parking still offers no runtime or tier switch.
- `model-selection/worker-options`: create and assign still cannot change `workerModelId` after spawn. The one new writer is answering a `provider_quota` `retry_approval` with a catalog option that was on that card.

## Impact

- `packages/runtime-sdk/src/process.ts` — `classifyError` keeps the original stderr/error text on the quota arm only.
- `packages/core/src/runs/engine.ts` — `parseResetTime` driven by captured strings; window-relative bound plus 14-day backstop; `parkForHuman` adds switch options from the effective catalog, never recommends a switch.
- `packages/core/src/decisions/service.ts` — `applyRetryApproval` handles `switch:<id>`: set the ticket's `workerModelId`, resume the parked worker (dispatcher already stale-sessions a runtime change).
- `packages/core/src/tickets/service.ts` — a narrow internal writer for that answer; `assign` / create still reject after spawn.
- Tests: `reset.test.ts` (captured strings, including VS-234 at the failure instant `now = 2026-09-11T17:00:12Z` → `2026-09-11T17:54:35.000Z`, not the UTC misread), `process.test.ts` (original text survives classification), `engine.test.ts` (card options and recommendation), `decisions` / `tickets` (switch keeps worktree; assign still refuses; no switch without an answer).
- UI: `retry_approval` already renders as a generic option list; new keys appear as buttons. `NAMED_CARD_OPTION_KEYS` stays unused for this kind (options are already dynamic: `retry_1h` vs `retry_at_reset`).
