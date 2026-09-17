## Why

`weave_ticket_create` takes `workerModelId` as optional and silently resolves the effective
`models.workers` default when it is absent, so the cheapest tier is what an agent gets by *not
thinking*. The catalog's descriptions exist precisely to make the choice well, and nothing ever
puts them in front of the agent making it: five tickets filed in one minute all took the default,
two of them diagnosis-heavy work whose correct tier is `deep`.

## What Changes

- **BREAKING (agent-tool behavior):** `weave_ticket_create` SHALL refuse a call that omits
  `workerModelId` when the effective catalog holds at least one configured option. The refusal is a
  `validation` error that names every configured option with its description, so the next call is an
  informed one rather than a retry with a guess.
- The same choice SHALL be required where an agent routes existing work the same way:
  `weave_ticket_assign`, and a persistent session's ticket-taking tool, when they attach a role to a
  ticket that names no worker option and the effective catalog has a configured option.
- An unknown `workerModelId` SHALL be rejected naming the valid option ids.
- The default SHALL be kept on the paths where no agent is choosing: a ticket filed by the system
  (the project-description scout, knowledge curation, a workspace import) and the human HTTP/CLI
  create and assign paths. A workspace whose effective catalog is empty, or in which every option is
  still unconfigured, SHALL also keep the default — a required field that cannot be satisfied would
  block all filing, which is worse than the silent default it replaces.
- The tool descriptions, the `weave-ai-weaver` skill and the weaver's `AGENTS.md` template SHALL
  state the requirement, so it is known before the first rejection rather than learned from it.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `model-selection/worker-options`: filing or routing a ticket on the agent-facing tools now
  requires a chosen worker option when the effective catalog has a configured option; the omission
  is refused with the catalog in the message; the default survives only on the non-agent paths and
  on an empty or fully-unconfigured catalog.

## Impact

- `packages/server/src/tools.ts` — one shared guard plus the `weave_ticket_create`,
  `weave_ticket_assign` and `weave_session_take_ticket` handlers, and their descriptions.
- `packages/core/src/tickets/service.ts` — the unknown-id message names the valid ids; the service
  otherwise keeps its current permissive default so system callers are unaffected.
- `skills/weave-ai-weaver/SKILL.md`, `templates/weaver.AGENTS.md.tmpl`, `docs/PLAN.md` §9.2,
  `docs/API.md` (only the note that the HTTP path keeps the optional default).
- Tests in `packages/server/test/` and `packages/core/src/tickets/`.

Out of scope: what the tiers are, their runtimes/models, how a run resolves one, and any attempt to
auto-select a tier from the ticket text.
