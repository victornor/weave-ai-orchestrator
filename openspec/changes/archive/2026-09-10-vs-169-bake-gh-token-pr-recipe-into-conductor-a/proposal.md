## Why

Captain, 2026-09-10: a conductor in another workspace treated `gh auth status`
saying logged-out as a GitHub authorization blocker and asked the human to
log in. On this host `gh auth token` still works; the working recipe is
`GH_TOKEN="$(gh auth token)" gh pr create|merge …`. Never `gh auth login`.
The recipe already lives in one role charter here; other workspaces' conductors
and workers do not inherit that. SHARED.md does not travel. Put it in the
always-loaded templates the daemon renders so every workspace sees it.

## What Changes

- The shipped conductor AGENTS template states: if `gh auth status` looks
  logged-out, that is not a reason to ask the human to authorize GitHub;
  forge commands use `GH_TOKEN="$(gh auth token)"`; do not run `gh auth login`.
- The shipped worker AGENTS template states the same recipe for `gh` forge
  commands (`pr create`, `pr merge`, …) and forbids `gh auth login` and asking
  the human (or the conductor) to authorize GitHub for that reason.
- The worker delivery skill (`skills/agent-conductor-worker/references/delivery.md`)
  uses the `GH_TOKEN="$(gh auth token)"` prefix on its `gh pr create` and
  `gh pr merge` commands, so the procedure agents copy matches the prompt.
- A render test asserts both shipped templates carry the recipe.

## Capabilities

### New Capabilities

- `agent-prompts/gh-forge-auth`: Always-loaded conductor and worker instruction
  templates tell agents how to invoke `gh` when `gh auth status` looks
  logged-out, and that this is not a GitHub-authorization ask.

### Modified Capabilities

(none)

## Impact

- `templates/conductor.AGENTS.md.tmpl` — one short rule so the conductor does
  not escalate a logged-out `gh auth status` to the human.
- `templates/worker.AGENTS.md.tmpl` — one short rule in the Git section so
  workers prefix forge commands with `GH_TOKEN="$(gh auth token)"`.
- `skills/agent-conductor-worker/references/delivery.md` — the copied `gh`
  commands use the same prefix.
- `packages/core/src/prompts/render.test.ts` — shipped-template assertions
  for the recipe strings.
- No daemon schema, no API, no new secret, no change to `gh` itself.
- Out of scope: per-workspace SHARED.md; running a real coding CLI against
  host credentials to "test login"; host `gh auth login` docs for operators.
