## Why

captain is renaming this project; part of that is that the `conductor` agent kind becomes `weaver`.
"Conductor" is stored today — a SQLite CHECK constraint and unique-index predicate, a decision-owner
CHECK, a column-default, four decision columns literally named `conductor_review_*`, and a
per-workspace directory every existing workspace (including this one) already has on disk. A
half-done rename — rows still saying `'conductor'` while code checks for `'weaver'` — is a silent
data-integrity failure, not a cosmetic one, so the rebuild has to move in lockstep with the code that
reads it. VS-258 already taught the path resolvers to find the per-workspace runtime-home directory
under either name, which is what makes doing this now, on a live installation, survivable.

## What Changes

- **BREAKING (internal, migrated in place)**: `AGENT_KINDS`/`INCIDENT_REPORTER_KINDS` gain `weaver` in
  place of `conductor` (`packages/shared/src/enums.ts`). Every scattered raw `'conductor'` literal
  across `packages/` that means this agent kind moves with it — the constant was never the only
  source of truth, so this is a sweep, not an edit to one file.
- A migration rebuilds, in one file, under this repo's `-- ac:foreign_keys_off` convention (precedent:
  migration 0023): `agents.kind`'s CHECK and the `agents_one_conductor` partial unique index predicate,
  `decisions.owner`'s CHECK, and `roles.created_by`'s default — updating every existing row of all
  three tables in the same pass. The four `decisions.conductor_review_*` columns are renamed to
  `weaver_review_*` in the same rebuild (`decisions` is already being rebuilt for its `owner` CHECK).
  Two further columns carry the value with no constraint on them at all — `role_revisions.author` and
  `incidents.reporter_kind` — updated with a plain `UPDATE` in the same migration file (found by
  scanning the live database's columns for the value, not by reasoning from constraints; see
  design.md Decision 1 and Decision 6).
- Every code read/write site for those renamed columns, and every TypeScript field name derived from
  them (`packages/shared/src/conductor-review.ts` and its test, `packages/core/src/decisions/service.ts`,
  `packages/render/src/decision.ts`, `packages/ui/src/components/DecisionCard.tsx`, and the rest listed
  in Impact) moves to `weaver_review_*`/`weaverReview*`.
- The per-workspace `conductor/` agent-home directory: no new resolution logic is needed — VS-258's
  `resolveWorkspaceStateDir` / `workspacePaths()` (`packages/core/src/context.ts`) already picks the
  directory name from the same old/new install signal this migration uses. This change updates the
  *value* that decides which literal directory name is created for a **new** workspace going forward
  (`weaver` once this lands) and confirms an **existing** workspace's `conductor/` directory keeps
  resolving — it does not touch VS-258's resolver itself.
- `skills/agent-conductor-conductor/` moves to `skills/agent-conductor-weaver/`, with its
  `skills/manifest.json` entry updated. This is the one skill whose suffix names the agent kind
  itself, not a topic — every sibling skill keeps its current name (`agent-conductor-worker`, etc.);
  this ticket does not touch the `agent-conductor-` product prefix on any skill.
- A prose pass, restricted to mentions of the *agent kind*, across `docs/`, `skills/`, and
  `templates/` (explicitly **not** `openspec/specs/`, whose existing requirement text is out of this
  change's scope — behavior there is unchanged, only the underlying storage is renamed).
- **Out of scope, explicitly**: `@agent-conductor/*` package names, the `conductor` CLI binary, the
  systemd unit, the repo/org name (all VS-260); the `ac_*` MCP tool prefix (pending with captain);
  and the `workspace.yaml`/`daemon.yaml` `conductor:` config-key surface (VS-263, blocked on this
  ticket landing first in `packages/shared` to avoid a collision).

## Capabilities

### New Capabilities

- `agent-kind-rename`: the guarantees this migration makes about an existing installation's stored
  `conductor` identity — every constraint rebuilt in lockstep with its rows, the one-weaver-per-
  workspace invariant still enforced afterwards, and the per-workspace runtime-home directory not
  orphaned.

### Modified Capabilities

(none — `human-decisions/conductor-review`'s requirements are unchanged by this ticket; only the
storage column names and TypeScript field names those requirements are implemented against move.
Renaming `decisions.conductor_review_status` to `decisions.weaver_review_status` is an implementation
detail the spec's behavior does not depend on.)

## Impact

- **Schema**: new migration `packages/db/src/migrations/0027_agent_kind_weaver.sql`, rebuilding
  `agents`, `decisions`, and `roles` (all three are FK-referenced tables).
- **Shared**: `packages/shared/src/enums.ts` (`AGENT_KINDS`, `INCIDENT_REPORTER_KINDS`),
  `packages/shared/src/conductor-review.ts` → `weaver-review.ts` and its test,
  `packages/shared/src/types.ts` (the renamed decision fields).
- **Core**: `packages/core/src/api.ts`, `packages/core/src/roles/index.ts`,
  `packages/core/src/context.ts`, `packages/core/src/workers/index.ts`,
  `packages/core/src/decisions/service.ts`, and their tests.
- **Server**: `packages/server/src/tools.ts` (5+ literal sites plus `CONDUCTOR_TOOLS` →
  `WEAVER_TOOLS`), `packages/server/src/openapi.ts`, `packages/server/src/channels.ts`, and tests.
- **Render/UI/TUI**: `packages/render/src/entities.ts`, `packages/render/src/decision.ts`,
  `packages/ui/src/components/DecisionCard.tsx`, 3+ UI route files, `packages/tui/src/apps/Top.tsx`,
  `packages/tui/src/apps/Chat.tsx`, and their tests/fixtures.
- **Skills/templates/docs**: `skills/agent-conductor-conductor/` → `skills/agent-conductor-weaver/`,
  `skills/manifest.json`, `templates/conductor.AGENTS.md.tmpl` and its renderer key,
  `templates/worker.AGENTS.md.tmpl`, `templates/brief.md.tmpl`, `templates/charter.md.tmpl`,
  `docs/PLAN.md`, `docs/API.md` where they describe the agent kind.
- **Not touched**: `openspec/specs/**`, `packages/shared/src/config.ts` and every `workspace.yaml`/
  `daemon.yaml` schema field (VS-263), any `@agent-conductor/*` package name or the `conductor` CLI
  binary (VS-260).
