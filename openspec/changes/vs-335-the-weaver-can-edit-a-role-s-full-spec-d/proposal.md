## Why

In captain's `fern-ofm` workspace the weaver corrected the Deployment Engineer role's charter (Mac mini
→ Ubuntu server) but could not fix the role's short description, which still said it ships to the
live Mac mini. The weaver has `weave_role_update_charter` and nothing else: no weaver tool edits a
role's spec fields, although `roles.update` already validates, persists and revisions them. Captain:
"it should be able to update roles completely." Two gaps in the existing core write make a naive
tool insufficient: `roles.update` ignores `applyToRunning`, and a spec change never refreshes a
charter that was rendered from the spec, so the worker keeps reading the stale prose.

## What Changes

- A new weaver-only MCP tool, `weave_role_update`, takes `{ id, patch, reason, applyToRunning? }` and
  edits any mutable `RoleSpec` field — `name`, `title`, `icon`, `charterSummary`, `scope`,
  `responsibilities`, `capabilities`, `exclusions`, `rules`, `sessionPolicy`, `permission`, `notes`.
  It calls `roles.update` and returns the updated role, the revision's `changedKeys`, whether a
  spec-rendered charter was refreshed, and whether live workers were re-briefed.
- `id` and `project` in a patch are rejected with a message that names them immutable; an unknown key
  is rejected; `secrets` and `maxWorkers` are rejected with a message naming
  `weave_role_set_secrets` / `weave_role_set_max_workers`, which keep their own validation.
- A patch that changes `permission` (mode, allowed or denied) is security-sensitive and follows the
  hire policy: with `defaults.hireApproval` not `none` it is raised as an approval decision and
  applied only when answered `approve`; with `hireApproval: none` it applies directly. Every other
  field applies immediately with a revision.
- `roles.update` honours `applyToRunning`: when set, each live worker of the role is re-briefed from
  the new spec, and the result says how many were.
- A charter that was rendered from the spec template is re-rendered when the spec changes; a charter
  written by hand with `weave_role_update_charter` is left untouched, and the tool result says so, so
  the caller knows to update it separately.
- The weaver skills (`weave-ai-hire`, `weave-ai-weaver`) name the tool: fix a stale description with
  `weave_role_update`, the charter prose with `weave_role_update_charter`.
- `docs/API.md` and the tool list carry the new tool.

**BREAKING**: none. A new weaver-only tool and a new decision path are additive; existing roles,
role revisions and worker briefs are unaffected until the tool is called.

## Capabilities

### New Capabilities
- `role-management/weaver-role-editing`: the weaver-only tool that edits a role's spec fields; the
  immutable and routed fields it refuses; the permission change that follows the hire policy and
  waits for approval; `applyToRunning` re-briefing live workers; keeping a spec-rendered charter in
  sync while leaving a hand-written one alone; and the weaver instructions naming the tool.

### Modified Capabilities
<!-- none: no existing requirement changes; the approval reuses the existing `hire_approval` card
     and its approve/reject keys, so `human-decisions/option-cards` is unchanged. -->

## Impact

- `packages/shared/src/tools.ts` — `weave_role_update` in `WEAVER_TOOLS`.
- `packages/server/src/tools.ts` — the tool definition, its strict patch schema and handler.
- `packages/core/src/roles/index.ts` — `roles.update` re-renders a spec-derived charter and honours
  `applyToRunning`; a service method that enforces the immutable/routed fields and the permission
  gate.
- `packages/core/src/api.ts` — the roles-service method signature.
- `packages/core/src/decisions/service.ts` — `applyHireApproval` applies a stored patch for a
  role-permission change instead of activating the role.
- `skills/weave-ai-hire/SKILL.md`, `skills/weave-ai-weaver/SKILL.md` (or its role-maintenance
  section) — the tool and when to use each of the two update tools.
- `docs/API.md` — the new tool and the role PATCH/`update` semantics.
- Tests: `packages/core/src/roles/roles.test.ts`, `packages/core/src/decisions/decisions.test.ts`,
  `packages/server/src/tools.test.ts` (or its existing tool suite), `packages/shared/src/tools.test.ts`.
