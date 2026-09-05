## Why

Most people run the coding CLIs on a subscription, not on a metered API key. For them the dollar
figure the usage view leads with is meaningless — it is an estimate of what the tokens *would* have
cost, and nothing is actually being spent. What matters is how much of the plan is left: the rolling
session window, the weekly window, and the separate weekly allowance for the most capable model.

The investigation on [VS-24](conductor://tickets/VS-24) established that this is obtainable: Claude
Code answers a `get_usage` control request with the subscription type and every limit window, for
free and in under a second. `usage_events.billing_type` already exists in the schema and in
`docs/PLAN.md` §16.2 ("`billing_type` from the runtime's auth mode … when detectable"), but nothing
ever writes anything but `unknown` and nothing reads it. This change makes that column true and puts
the plan windows in front of the user.

## What Changes

- **New optional `describeAccount()` on `RuntimeAdapter`** returning the account's billing mode, a
  plan label, and whatever limit windows the CLI can honestly report. Optional so a runtime that
  knows nothing stays silent rather than reporting zeros.
  - **claude**: full — spawns `claude -p --output-format stream-json --input-format stream-json` and
    sends one `get_usage` control request. Zero tokens, sub-second, returns `subscription_type` and
    a normalised `rate_limits.limits[]` array (`session`, `weekly_all`, `weekly_scoped` with the
    model scope), each with `percent` and `resets_at`.
  - **opencode**: billing mode only (`metered_api`) — OpenCode bills through provider API keys and
    has no plan limits, so dollar cost stays its metric.
  - **codex** and **gemini**: billing mode only, inferred from which credential the runtime home
    holds; limits reported as unavailable with a reason, never as zeros.
- **New `runtime_accounts` table** holding the latest snapshot per `(workspace_id, runtime_id)`:
  billing type, plan label, the limit windows as JSON, when it was captured, and any note.
- **The supervisor refreshes the snapshots on a poll** (every 5 minutes, only for runtimes an agent
  in this workspace is configured to use). Cost: zero LLM tokens, one short-lived child process per
  runtime per poll.
- **`usage_events.billing_type` is populated** by the run engine from the snapshot for that run's
  runtime, instead of the hardcoded `unknown`.
- **The usage view leads with plan consumption on subscriptions.** A new `GET
  /api/w/<ws>/usage/accounts` returns the snapshots; the usage series response gains a `billingMix`
  so the view knows whether any metered spend happened in the window. When every token in the window
  was subscription-billed, the cost tile and the cost columns are replaced by the plan windows;
  otherwise cost stays exactly as it is today. Snapshot freshness is shown.
- **`conductor usage` prints the same block**, from the same view model in `packages/render`.
- `docs/PLAN.md` §16.2/§16.3 and `docs/API.md` gain the table, the route and the behaviour.

Not in this change: reading Codex's session rollout file or Gemini's in-memory quota; any alert,
budget or throttle when a limit is close (PLAN §16 keeps budgets out of v1).

## Capabilities

### New Capabilities

- `usage-plan-limits`: how the daemon learns a runtime account's billing mode and plan limit
  windows, how it stores and refreshes them, and what the usage view and `conductor usage` show for
  a subscription account versus a metered one.

### Modified Capabilities

<!-- None. There is no existing capability under openspec/specs/ covering usage or telemetry;
     `usage-plan-limits` is the first. -->

## Impact

| Area | Change |
|---|---|
| `packages/shared` | `AccountBillingMode` reuse of `BILLING_TYPES`, new `ACCOUNT_LIMIT_KINDS` enum, `RuntimeAccount` / `AccountLimitWindow` types |
| `packages/runtime-sdk` | optional `describeAccount()` on `RuntimeAdapter` + its input/output types |
| `packages/runtimes/*` | claude (full), opencode (static), codex + gemini (billing mode only) |
| `packages/db` | migration `0008_runtime_accounts.sql` |
| `packages/core` | `accounts` service (read + refresh), supervisor poll, `recordUsage` billing type, `billingMix` on the usage series |
| `packages/server` | `GET /usage/accounts`; `docs/API.md` |
| `packages/render` | `accountLimits()` view model, shared by web and CLI |
| `packages/ui` | Usage route: plan-limit panel, cost hidden on all-subscription windows |
| `packages/cli` | `conductor usage` plan block |
| `docs/` | PLAN §16.2/§16.3, API.md |

No breaking changes: every new field is additive, `describeAccount()` is optional, and a workspace
with no snapshot behaves exactly as it does today (`unknown` billing, cost shown).
