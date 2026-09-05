## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **Credentials are per runtime, per workspace.** `seedRuntimeCredentials` copies the host's
  credential file into `<workspace>/.agent-conductor/runtimes/<runtimeId>/`
  (`packages/core/src/workspace/loader.ts:270`), and the claude adapter points the CLI at it with
  `CLAUDE_CONFIG_DIR` (`packages/runtimes/claude/src/args.ts`). So an "account" is keyed by
  `(workspaceId, runtimeId)` — not by project and not by role, even though projects and roles each
  name a runtime.
- **`core` may not import a runtime package.** Adapters are reached through
  `ctx.registries.runtimes` (`packages/core/src/context.ts:12`). The account probe therefore has to
  be a method on `RuntimeAdapter`, not a helper in `core`.
- **The usage view already treats tokens as the headline and cost as secondary**
  (`packages/ui/src/routes/Usage.tsx`, `packages/render/src/usage.ts`). This change removes the
  secondary figure when it is meaningless, rather than restructuring the page.
- **`usage_events.billing_type` already exists**, in the schema
  (`packages/db/src/migrations/0001_init.sql:131`), in `UsageEvent`
  (`packages/shared/src/types.ts:13`) and in `docs/PLAN.md` §16.2. Nothing writes anything but
  `unknown` (`packages/core/src/usage/service.ts:277`) and nothing reads it.

### The Claude control response, verified

Probed on 2026-09-05 against `claude 2.1.258` — one line of stdin, process exits, no model turn,
`total_cost_usd: 0`, under a second:

```
echo '{"type":"control_request","request_id":"req_1","request":{"subtype":"get_usage"}}' \
  | claude -p --output-format stream-json --input-format stream-json --verbose
```

The reply is a single `control_response` line. The fields this change uses:

| Field | Example | Used for |
|---|---|---|
| `response.subscription_type` | `"max"` | billing mode + plan label |
| `response.rate_limits_available` | `true` | `limitsAvailable` |
| `response.rate_limits.limits[]` | `{kind:"session", percent:42, resets_at:"…", scope:null, is_active:true}` | the windows |
| `limits[].kind` | `session` \| `weekly_all` \| `weekly_scoped` | window kind |
| `limits[].scope.model.display_name` | `"Fable"` | the per-model window's scope label |

`rate_limits` also carries `five_hour` / `seven_day` objects and a long tail of unstable,
codename-shaped keys (`nimbus_quill`, `iguana_necktie`, …). The normalised `limits[]` array is the
only part this change reads; everything else is ignored, including `spend`, `extra_usage` and
`behaviors`.

## Goals / Non-Goals

**Goals**

- One honest answer per runtime about how the account is billed, refreshed without user action.
- Plan windows in front of the user when the dollars are meaningless, dollars when they are not.
- Additive: a workspace with no snapshot behaves byte-for-byte as it does today.

**Non-Goals**

- Snapshot history or a limit-over-time chart. One current row per runtime.
- Per-project or per-role accounts. Credentials are per runtime per workspace; pretending otherwise
  would be a lie in the UI.
- Anything that spends tokens to find out about limits.
- Budgets, alerts and throttles — PLAN §16 keeps those out of v1 and this change does not open that
  door.

## Decisions

### `describeAccount()` is optional on `RuntimeAdapter`

```ts
describeAccount?(input: AccountProbeInput): Promise<AccountDescription>;

interface AccountProbeInput { configHome?: string; env: Record<string, string>; timeoutMs: number }
interface AccountDescription {
  billingType: BillingType;                 // shared BILLING_TYPES, reused verbatim
  planLabel: string | null;
  limitsAvailable: boolean;
  limits: AccountLimitWindow[];
  note: string | null;
}
interface AccountLimitWindow {
  kind: AccountLimitKind;                   // new closed enum in shared
  label: string;
  utilization: number;                      // 0..100
  resetsAt: string | null;
  scopeLabel: string | null;                // e.g. the model a weekly_scoped window applies to
}
```

Optional rather than required with a default, because "this adapter has nothing to say" and "this
adapter says it does not know" are the same outcome and a missing method states it without four
lines of boilerplate in every adapter. `AccountLimitKind` is a closed enum in
`packages/shared/src/enums.ts` (`session`, `weekly_all`, `weekly_scoped`) per the repo's rule that
nothing branches on a raw string.

*Alternative considered:* a `capabilities.accountReporting` flag plus a required method. Rejected —
two things to keep in sync for no gain.

### The claude probe spawns a second, short-lived process

The turn path uses `--input-format text` and cannot carry a control request. Rather than switch the
turn path to `stream-json` input (a change to every turn, to buy one read), the probe is its own
one-line process, reusing `spawnLines` from `runtime-sdk`, with `CLAUDE_CONFIG_DIR` set to the
workspace runtime home so it reads the same credentials the turns do. Timeout 20 s, non-zero exit or
unparseable output → `unknown` with the reason in `note`.

*Alternative considered:* asking the running turn for its usage. Rejected — snapshots must refresh
when nothing is running, which is exactly when the user is looking at the page.

### Codex and Gemini report billing mode from credential presence only

`describeAccount()` for codex checks for an `OPENAI_API_KEY` in the probe env (→ `metered_api`) and
otherwise for `auth.json` in the runtime home (→ `subscription_included`); gemini checks
`GEMINI_API_KEY`/`GOOGLE_API_KEY` (→ `metered_api`) and otherwise `oauth_creds.json` (→
`subscription_included`). Neither reads a credential file's *contents*, so no secret is ever parsed,
logged or stored, and both are testable against a temp directory. Both report `limitsAvailable:
false` with a note naming what the CLI does not expose. Reading Codex's `chatgpt_plan_type` claim or
its rollout file is out of scope per the ticket.

OpenCode returns a static `metered_api` description: VS-24 established it has no plan concept.

### Storage: one current row per `(workspace_id, runtime_id)`

```sql
CREATE TABLE IF NOT EXISTS runtime_accounts (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  runtime_id TEXT NOT NULL,
  billing_type TEXT NOT NULL DEFAULT 'unknown',
  plan_label TEXT,
  limits_available INTEGER NOT NULL DEFAULT 0,
  limits_json TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, runtime_id)
);
```

Upsert on the primary key. The windows go in as JSON because they are a display payload with a
per-runtime shape, never a query predicate; the only query is "give me the row for this runtime".
Reversible: dropping the table restores today's behaviour exactly, since every reader falls back to
`unknown`.

*Alternative considered:* an append-only snapshot table with a `captured_at` index. Rejected for
this change — nothing in the specs reads history, and it can be added later without touching the
read path.

### Polling: every 5 minutes, from the supervisor, for runtimes in use

A new `due('supervisor:accounts_at', ACCOUNTS_EVERY_MS)` branch in the supervisor tick
(`packages/core/src/supervisor/index.ts:450`), alongside the existing curation, reconcile and
retention passes, refreshing every distinct `runtime_id` across the workspace's non-retired agents,
projects and roles.

**Cost: zero LLM tokens.** One child process per runtime per poll — measured at ~0.85 s wall for
claude — so at 5 minutes and a single runtime that is 288 spawns and ~4 minutes of CPU a day. Five
minutes is chosen against the shortest window that moves: the session limit is a rolling 5-hour
window, so 5 minutes is ≤ 2 % of it stale — fine for a number displayed as a percentage — while a
1-minute poll would be five times the process churn to move the same bar by a percent.

The capture time is stored and rendered, so a stale snapshot is visibly stale rather than silently
wrong.

### `billing_type` is read from the snapshot at record time

`recordUsage` takes the caller's `billingType` if given, else looks up the snapshot for
`row.runtimeId`, else `unknown`. Doing the lookup inside `recordUsage` rather than at the engine's
call site means the ticket-usage path and any future caller get it for free, and the existing
`recordUsage` tests keep passing unchanged (no snapshot → `unknown`).

Rows written before this change keep `unknown` and are never backfilled: we do not know what was
true then, and a window containing them therefore still shows cost — the conservative direction.

### The view switches on the window's billing mix, not on a global flag

`usage.series()` gains `billingMix: { subscription: number; metered: number; unknown: number }` —
tokens per billing type within the queried scope and window, from the same rows it already scans.
The view hides cost only when `metered === 0 && unknown === 0 && subscription > 0`.

This makes the rule scope-aware for free: filtering the page to a project whose runtime is a
subscription hides cost, a workspace that mixes an API key and a subscription keeps it, and a
workspace with only pre-change rows (all `unknown`) is untouched. It also means the switch is driven
by what was actually billed, not by what the account looks like right now.

*Alternative considered:* deriving it from the account snapshots alone. Rejected — the snapshot
describes the account *today*; a window that predates a plan change would be labelled wrongly.

### The limits block is a `packages/render` view model

`accountLimits(accounts, now)` returns rows (`label`, `percent`, `resets in …`, `scope`, `age`) that
both `packages/ui/src/routes/Usage.tsx` and `conductor usage` render. That is how the repo already
keeps the web and the CLI honest with each other (`usageTotals`, `usageRows`), and it makes the "CLI
shows the same information" requirement a golden test rather than a promise.

Per the project KB's note on `packages/ui` tests, the new data reaches the Usage route's limit panel
as a prop-shaped component so the route tests do not all have to grow a new `../api/hooks` mock.

## Risks / Trade-offs

- **The `get_usage` control-request shape is not a published contract** → only the normalised
  `limits[]` array and two scalars are read, each behind a narrow parse; anything missing or
  mistyped degrades to `limitsAvailable: false` with a note, never to a wrong number. The parse is
  tested against a recorded fixture of the real response.
- **A probe process per runtime every 5 minutes on a busy host** → the pass is guarded by the same
  `due()` meta-key as the other periodic passes, so a daemon restart does not re-run it immediately;
  failures are logged and leave the previous row alone.
- **Hiding cost could hide a real spend** → the rule only fires when *every* token in the window was
  recorded as `subscription_included`; `unknown` counts against hiding, so the failure mode is
  showing cost that does not matter, not hiding cost that does.
- **Claude subscription accounts can also incur extra-usage credits** (`spend` / `extra_usage` in
  the response) → out of scope here and deliberately not read; the note in the limits block names
  the plan, so a user on extra usage is not told their spend is zero, they are simply shown their
  plan windows.

## Migration Plan

1. Migration `0008_runtime_accounts.sql` creates the table. No data migration: an empty table is the
   pre-change behaviour.
2. Ship the adapter methods, the service and the poll. Snapshots appear within one poll interval.
3. Ship the API field, the route and the two views. Before the first snapshot they render exactly
   today's page.

Rollback is dropping the table and reverting; no other table is written and no column changes type.

## Open Questions

None. The one question that would have changed the specs — whether Claude can report the windows
without spending tokens — is answered above with a verified probe.
