## Why

Captain, 2026-09-19: make OpenSpec optional per project, defaulted on. On internal projects the propose/plan/spec/tasks/validate/archive ceremony is overkill and expensive; on production and customer-facing projects it is the point. The cost is measured, not theoretical: ACME-109 spent about 9.5 of its first 27 minutes writing a proposal, a design, three spec deltas and a task list before any code existed.

A `Project.openspecEnabled` flag already exists (`openspec.enabled`, default `true`) and already gates project bootstrap and ticket↔change binding, but it does not make OpenSpec optional in practice. An audit of the code at `5f313099` (below) shows the flag-off path is dead-ended at the `proposed` gate and every OpenSpec-shaped surface still assumes a change.

## Audit: what runs today when `openspecEnabled` is false

Verified in the worktree on 2026-09-19.

- **The `proposed` gate dead-ends a `change` ticket.** `transition()` (`packages/core/src/tickets/service.ts:712`) calls `openspec.validateForProposed` for *every* `change` ticket. `bindOpenspec` (`service.ts:263`) never assigns `openspecChangeName` when the flag is off, so `validateForProposed` (`packages/core/src/openspec/index.ts:152`) returns `{ ok: false, issues: [{ message: 'the ticket has no OpenSpec change to validate' }] }`. A flag-off `change` ticket can therefore never reach `proposed`, and `change` is the default kind for real work. This is the one hard blocker.
- **The worker prompt and skills are not mode-aware.** The brief's "OpenSpec change" line is gated on the ticket's change name and so is already hidden, but `skills/weave-ai-worker/SKILL.md` and `skills/weave-ai-openspec/SKILL.md` tell every `change` ticket to run the propose/apply workflow, and `templates/worker.AGENTS.md.tmpl:12,48` and `templates/brief.md.tmpl:97` do the same. `packages/core/src/prompts/index.ts:165` already puts `project.openspec` into the render data; no template reads it.
- **Archive and merge already degrade.** `mergeDone` calls `openspec.archiveAfterMerge` unconditionally, but it returns early for a null change name, and `attemptArchiveThenMerge` skips archiving when `changeName` is null. The merge queue never references OpenSpec. No gate error, no archive step — the merge path is already safe once `proposed` is fixed.
- **`weave_openspec_status` returns a zeroed record, silently.** `statusFor` resolves on the change name and the on-disk `openspec/` directory, never on the flag. A flag-off ticket gets `{ changeName: '', planningComplete: false, artifacts: [], tasks: null, ... }` with no signal that the mode is off.
- **The `weave_spec_*` tools and the specs service never read the flag.** `specs.index` keys on the `openspec/` directory and binary only, so a flag-off project whose repo still contains `openspec/` keeps being indexed, and the read tools keep serving stale rows. `weave_spec_get`/`weave_spec_change_get` raise `not_found`; `list`/`search` return `[]` or stale rows. The HTTP `/specs/:project/*` routes and the UI Specs view are equally flag-blind.
- **The ticket UI shows an empty OpenSpec panel on a flag-off ticket.** `packages/server/src/routes/tickets.ts` returns `zeroStatus(...)`, which is non-null, so `Ticket.tsx`'s `{spec ? … : null}` renders "OpenSpec · change · 0/0 tasks".
- **The weaver briefing warns about a missing `openspec` binary even when no project needs it.** `hostToolWarnings()` (`packages/core/src/tools/host.ts`) is global; `openspec` is a `recommended` host tool.
- **The setting cannot be changed after creation from any first-class surface.** The generic `PATCH /projects/:id` already accepts `openspec.enabled` via `ProjectConfigSchema.partial()`, but there is no CLI command, no UI control, and `POST /projects`'s strict `AddSchema` and the agent tool `weave_project_add` (`packages/server/src/tools.ts:1082`) both hardcode OpenSpec on. `knowledgeRepo` is the precedent for a per-project toggle (a settings control plus a reviewed switch PR).
- **The one pre-existing wart kept in scope only where it blocks the mode:** `policies.taskTicketsUseOpenspec` is read by `bindOpenspec` but is absent from `ProjectPoliciesSchema`, so it cannot be persisted through `PATCH`. Left as a noted follow-up; it does not affect the flag-off path.

## What Changes

- **A real fast path for `change` tickets when a project has OpenSpec off.** No proposal, design, spec delta, tasks file, validate step, archive step or OpenSpec change gate. The worker writes a short plan (a few sentences of approach) as a single ticket document, requests `proposed`, implements and tests after approval, opens the PR, and the ticket goes to review and merge approval as usual. The plan step is kept because a wrong approach is the expensive failure; plan approval stays governed by the project's existing `proposalApproval` policy and produces the same `plan_approval` card.
- **The mode is resolved per ticket, not re-read from the project.** A `change` ticket is on the OpenSpec path iff it is already bound to a change (`openspecChangeName != null`); an unbound `change` ticket is on the fast path. Binding happens at creation/spawn, so flipping the project switch never changes a ticket already in flight: a ticket bound before the flip keeps its OpenSpec flow, and a ticket created while off is not retroactively asked for spec deltas when the project is turned back on.
- **A first-class way to turn it on and off after the project exists** — in project settings (SV2), the CLI (`weave project set-openspec`), and the project config (`openspec.enabled`) — and to choose at creation (settings add form, onboarding, `POST /projects`, `weave_project_add`). Default stays **on** for every existing and new project.
- **Every OpenSpec-only surface degrades cleanly when off, and says so:** `weave_openspec_status` reports the mode explicitly instead of a zeroed change, the `weave_spec_*` tools and `/specs` routes return a typed "OpenSpec is off for this project" result, the ticket UI shows no empty OpenSpec panel, the knowledge Specs view shows an off state rather than "no capabilities yet", and the weaver is not warned about a missing `openspec` binary when no project needs it.
- **Docs and agent guidance.** `docs/PLAN.md`, `docs/OPERATIONS.md` and the README describe the setting, what each mode does and when to use which. The worker and weaver skills state that the mode is a project property they can read, and the worker skill describes the fast path.
- **A regression proof that OpenSpec-on is unchanged**, plus an end-to-end test of both modes through the ticket state machine, plus a measured comparison of the planning cost on vs off (planning-artifact token cost from fixtures; see tasks for the limitation on live elapsed time).

## Capabilities

### New Capabilities

- `openspec-mode`: the per-project OpenSpec mode — default on, per-ticket resolution, the fast `change`-ticket path when off, how the mode is read and changed after creation, how OpenSpec-only surfaces degrade, and that the OpenSpec-on flow is unchanged.

### Modified Capabilities

- `agent-tools/openspec-status`: `weave_openspec_status` (and the `weave_spec_*` tools it sits beside) must report an OpenSpec-off project explicitly, instead of a zeroed status or a bare `not_found`.
- `agent-prompts/conditional-repo-files`: the rendered brief and worker `AGENTS.md` must not point a worker at the OpenSpec flow or `work/openspec/config.yaml` when the project's mode is off, even if the repo still contains `openspec/`.
- `web-settings/add-project`: the Settings add-project form (and onboarding) must offer the OpenSpec choice and send it on `POST /projects` without breaking the existing strict-body contract.

## Impact

- **Core:** `packages/core/src/tickets/service.ts` (proposed gate, plan context, republish), `packages/core/src/openspec/index.ts` (status off signal), `packages/core/src/specs/index.ts` (flag read), `packages/core/src/projects/index.ts` (toggle + bootstrap on enable), `packages/core/src/prompts/index.ts` (mode-aware brief), `packages/core/src/tools/host.ts` + `packages/core/src/briefing/service.ts` (suppress the warning), `packages/core/src/supervisor/index.ts` (archive sweep reads the mode).
- **Shared:** a new `openspec_disabled` error code; `OpenSpecStatus.enabled`; `agent-prompts` template data already carries the flag.
- **Server:** `routes/projects.ts` (`AddSchema` + `PATCH` path), `routes/tickets.ts` (null `openspecState` when off), `routes/knowledge.ts` (`/specs` off result), `tools.ts` (`weave_openspec_status`, `weave_spec_*`, `weave_project_add`).
- **CLI:** `packages/cli/src/commands/project.ts` (`set-openspec`), PLAN §20 and the README cheat-sheet.
- **UI:** `settings/sections.tsx` (toggle + add form), `v2/V2Onboarding.tsx`, `v2/ticket/Ticket.tsx`, `v2/knowledge/KnowledgeSpecs.tsx` + `KnowledgeFrame.tsx`, `api/types.ts`/`hooks.ts`.
- **Skills/templates/docs:** `skills/weave-ai-worker`, `skills/weave-ai-openspec`, `skills/weave-ai-weaver`, `templates/worker.AGENTS.md.tmpl`, `templates/brief.md.tmpl`, `docs/PLAN.md`, `docs/OPERATIONS.md`, `README.md`.
- **No behaviour change for any project that does not opt out.** OpenSpec support is not removed and the OpenSpec-on flow is not changed.
