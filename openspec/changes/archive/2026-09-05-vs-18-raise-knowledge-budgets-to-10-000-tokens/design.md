## Context

See proposal.md — Why. Three facts shape the approach:

- **Tokens are estimated as `bytes / 3.5`** (`packages/shared/src/tokens.ts:2`). A 10000-token budget is ~35 KB of markdown; the numbers below are in those units throughout.
- **The budget is read from the database row, not the config.** `knowledge_files.budget_tokens` is set once at row creation (`service.ts:76`, `:492`) and read by every check (`:93`, `:194`, `:286`, `:295`, `:308`, `:338`, `:549`). One resolution point replaces all of them.
- **A worker already carries its knowledge twice on the first turn.** `templates/worker.AGENTS.md.tmpl:66-73` embeds `SHARED.md` and the project KB in the worker's `AGENTS.md`, rendered at spawn; `prompts/index.ts:271-273` injects the same two files again as the bootstrap digest when the turn is the first one or the session is stale.

**Per-worker context cost after this change** (worst case, every file at its budget):

| | today | after |
|---|---|---|
| `AGENTS.md` — shared + project KB, read by the coding CLI on **every turn** | ≤ 2300 tok | ≤ 12000 tok |
| bootstrap digest — the same two files again, **first turn only** | ≤ 2300 tok | ≤ 12000 tok |
| worst-case first turn | ≤ 4600 tok | ≤ 24000 tok |
| worst-case later turn | ≤ 2300 tok | ≤ 12000 tok |

These are ceilings, not typical values: the cost is whatever the files actually hold, and curation still fires at 80 %. The `agent-conductor` project KB is ~1500 tokens today, so nothing moves on day one. The duplication is the largest single cost and is out of scope here (proposal.md — Out of scope); this design only makes sure the digest does not truncate, by raising its budget to 16000, above the 12000 ceiling.

The conductor's digest is bounded differently: `WORKSPACE.md` (10000) + `SHARED.md` (2000) + the last 30 decision lines + Overview and Current focus of each project KB. With several projects it can pass 16000, and it truncates Learnings and then hard-caps exactly as it does today — the conductor holds a persistent session, so this is once per restart.

## Goals / Non-Goals

**Goals:**

- One resolution point for "what is this file's budget", reading the workspace config.
- No database migration, no new column, no new route, no new event.
- A budget the owner can change from the web app or the CLI and see take effect on the next write.
- Existing workspaces move to the new defaults, including the number their hub files quote to agents in their own text.

**Non-Goals:**

- Enforcing a workspace-wide total. Each file is budgeted on its own, as today.
- Making the 80 % curation ratio, the 60-word entry cap or the 14-day curation interval configurable. Only the budgets and the digest budget become settings.
- Shrinking files that are over a lowered budget. Nothing is truncated or archived because a number changed.

## Decisions

### The config is the source of truth; the row is a mirror

`budgetFor(scope, isDoc)` reads `ctx.config.defaults.knowledgeBudgetTokens`, and every check in the service goes through it. `knowledge_files.budget_tokens` keeps being written — at row creation and whenever a write finds it out of step — so the column, the `knowledge.updated` event payload, `GET /knowledge` and the UI meters stay exactly as they are, and an operator reading the database sees the truth.

*Alternatives:* a migration that backfills the column (rejected — it fixes the value at migration time, so a later settings change would not take effect, which is the acceptance criterion); dropping the column (rejected — it is in the schema, the API responses and the event payload for no gain over mirroring it).

### `defaults.knowledgeBudgetTokens`, one block keyed by scope

```yaml
defaults:
  knowledgeBudgetTokens:
    workspace: 10000
    shared: 2000
    decisions: 4000
    project: 10000
    document: 10000
```

Every key is `z.number().int().min(500)` with its default, so the block is optional and a partial block is filled in per key. `min(500)` keeps a typo from making the KB unwritable; there is no upper bound — the digest budget is the thing that actually protects the prompt, and the owner is the one paying.

*Why these numbers:* `project` and `document` are what the ticket asks for. `workspace` matches `project` — it is the conductor's own memory and was already the largest at 3000. `shared` stays deliberately the smallest at 2000 (from 800): it is injected into *every* agent, so a token there costs the most. `decisions` goes to 4000 (from 1500): the daemon appends to it unattended and only its last 30 lines ever reach a digest, so it is the file that hits its cap first and the cheapest one to let grow.

*Alternatives:* five flat keys on `defaults` (rejected — noisy, and it reads worse in `workspace.yaml`); one budget for everything (rejected — `SHARED.md` must stay small for a different reason than `PROJECT.md` must be big).

### `PATCH /config` merges nested objects

`{ ...config, ...patch }` is replaced by a small `deepMerge` for plain objects, with arrays replaced wholesale. Without it, a settings screen that patches `defaults.knowledgeBudgetTokens` resets `turnTimeoutSec`, `maxConcurrentRuns` and every other default to its schema default — silently, because the schema fills them in and the result validates. This is a pre-existing defect that the settings group would otherwise walk straight into; it is in scope because the acceptance criterion is that the budgets are editable from the settings screen.

*Alternative:* have the UI send the whole `defaults` block it read (rejected — it makes every client responsible for not losing a key it does not know about, and the CLI would have to do the same).

### `conductor workspace set-default <key=value...>`

The workspace-level twin of `conductor project set-policy` (`packages/cli/src/commands/project.ts:125-150`), with the same `key=value` parsing and the same coercion, plus dotted keys for one level of nesting (`knowledgeBudgetTokens.project=10000`). It reads the current config from `GET /w/:ws`, merges, and patches.

*Alternative:* a `conductor knowledge budget <scope> <tokens>` command (rejected — it covers this ticket and nothing else, and the CLI has no way at all to set a workspace default today, which is the real gap).

### The stated budget in a hub file's own text is corrected on the next write

The seeded hub files carry their budget in their first line — `<!-- The project knowledge base. Budget 1500 tokens. ... -->` (`workspace/loader.ts:132`). That line is *inside* the knowledge base, so it goes into every worker's `AGENTS.md` and every digest: leaving it stale means agents keep being told 1500 while the daemon enforces 10000. The seeds render the configured number, and the write path rewrites the number in that marker when it disagrees — only the digits, only inside the leading HTML comment, only when it is wrong, and like every write it becomes a revision that `conductor knowledge revert` can undo.

*Alternatives:* rewriting every hub file at upgrade (rejected — a migration that edits human-owned markdown outside a revision); dropping the number from the seeds and leaving existing files stale (rejected — the stale line is exactly what agents read).

### The digest keeps carrying the whole KB

`bootstrapBudgetTokens` goes to 16000 rather than teaching the digest to skip what `AGENTS.md` already holds. De-duplicating is the bigger win (12000 tokens on a worker's first turn) but it changes what an agent is told, and the ticket asks only that the digest still work. It is called out in proposal.md — Out of scope so the owner can decide separately.

## Risks / Trade-offs

- **Every worker turn can carry up to 12000 tokens of knowledge instead of 2300.** → The ceiling only binds if the KB is actually that full; curation still fires at 80 % of the budget; the owner can lower any budget from settings, and the cost table above is the number to judge it by.
- **A 10000-token KB is only useful if it stays curated.** Curation now fires at 8000 tokens instead of 1200, so curation turns become rarer and much larger. → Out of scope to change, but worth watching: `conductor knowledge lint` shows the sizes, and the budget can be lowered if curation stops keeping up.
- **Deep-merging `PATCH /config` changes an API contract.** → Only this repo's UI and CLI call it; the change is flagged **BREAKING** in the proposal, and clearing a nested key by omission was never something a caller could rely on (the schema refilled it with a default).
- **Rewriting the budget marker touches text a human may have edited.** → Only the digits inside the leading `<!-- ... Budget N tokens ... -->` marker are replaced, and only when they disagree with the configured value; anything else in the file, including a marker the human removed, is left alone.
- **Lowering a budget below a file's current size leaves that file unwritable until it is curated.** → Specified behavior, not an error: the file is intact, the rejection says the size and the budget, and it schedules the curation run that fixes it.
- **A workspace that pinned `bootstrapBudgetTokens` keeps 8000 and will truncate a full KB.** → It is an explicit setting and is honored; `bootstrapDigest` already reports `truncated`, and the settings group puts the digest budget next to the knowledge budgets so the two are set together.

## Migration Plan

1. No database migration. `knowledge_files.budget_tokens` is refreshed in place as files are written; a row that is never written again keeps a stale number in a column nothing reads for enforcement.
2. No configuration migration. `workspace.yaml` files with no `knowledgeBudgetTokens` block pick up the defaults; a workspace that sets one keeps it.
3. Deploy is the human's `conductor daemon upgrade` after the merge.
4. **Rollback:** reverting the release restores the constants, and knowledge files that grew past 1500 tokens meanwhile stay on disk intact — their next `ac_knowledge_note` is rejected as over budget and schedules a curation run, which is the pre-existing behavior for an over-budget file. No data is lost either way.
