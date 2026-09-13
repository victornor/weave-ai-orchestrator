# Replace the lowercase "conductor" role word with "weaver"

Tracker change for VS-326. A `task` ticket, so this change carries tasks only — `skip_specs: true`.

## Why

VS-325 renamed the capitalised display name — UI labels, server-written messages and the stored
weaver agent's name. It deliberately left the lowercase role noun ("the conductor", "conductor-only")
for a separate pass; this is that pass. Agents still read "the conductor" in 16 tool descriptions and
error messages, 44 skill lines and 8 template lines, and user docs still say it throughout — the last
place the old role name is visible to a person or an agent.

## What Changes

- Tool descriptions and error/validation messages in `packages/server/src/tools.ts` say "weaver"
  (e.g. the `conductor-only` knowledge error becomes `weaver-only`).
- Skill and template prose says "weaver"; no skill or tool description tells an agent about both
  "the conductor" and "the weaver" as if they were different roles.
- `README.md` and the current user/operator docs (`docs/PLAN.md` where it describes current
  behaviour, `docs/OPERATIONS.md`, `docs/SCENARIOS.md`, `docs/DOCKER.md`, the reproducible
  `docs/demos/*` scripts) say "weaver". `docs/API.md` needs no change: its occurrences are legacy
  key names and a capability id.
- Wire and stored values, code identifiers, the `agent-conductor` repository/path names, dated ADRs
  and the superseded `docs/prompts/` drafts are left alone.

## Capabilities

None. This is a naming pass over prose, not a behavior change: the tool set, the error codes, the
transitions and the wire formats are untouched. `skip_specs: true` is set in `.openspec.yaml`.

## Impact

- `packages/server/src/tools.ts` — prose in descriptions and two `OcError` messages.
- `skills/**` and `templates/**` — prose only.
- `README.md` and `docs/` — prose only.
- `packages/server/src/**/*.test.ts` — one test asserting the knowledge error's new wording.
- No schema, migration, route, CLI or UI change.
