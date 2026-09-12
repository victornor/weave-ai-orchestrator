## Context

The Settings Projects section renders one `ActiveProjectRow` per project
(`packages/ui/src/routes/Settings.tsx`). It already edits `maxWorkers` and `landingBranch` with
`useCommittableField` and `CommitStatus`, and `policies.yolo` with a select whose inherit option
drops the key. This change adds the remaining policies and `setupCommand` to that row.

Constraints the current code imposes, which shape the design:

- **A policies patch does not materialise schema defaults.** `ProjectPoliciesSchema` is
  `z.object({...}).partial()` (`packages/shared/src/config.ts`), so parsing `{}` yields `{}` and
  `{ yolo: false }` yields `{ yolo: false }` — the per-field `.default()`s only apply when a field is
  absent *and* not made optional, which here it is. Verified against the installed zod 3.25. This is
  what makes "unset means inherit" representable at the API boundary at all.
- **`PATCH /projects/:id` shallow-merges top-level keys and replaces `policies` wholesale.**
  `projects.update` builds `ProjectConfigSchema.parse({ ...existing, ...patch, id })`
  (`packages/core/src/projects/index.ts`), and the route parses the body with
  `ProjectConfigSchema.partial().strict()`. So a policies change must carry the full intended
  policies object; siblings the client omits are dropped.
- **Approval owners are stored under the legacy spelling.** `toLegacyPolicies` writes `weaver` as
  `conductor` to the DB row, and `GET /projects` returns raw rows, so the UI sees `conductor` while
  core (via the parsed `workspace.yaml`) sees `weaver`. The select must render both as the same
  choice.
- **`useWorkspaceSummary().config.defaults`** carries the workspace values for `proposalApproval`,
  `deliveryMode` and `yolo`; the other policies have no workspace-level counterpart, only a
  built-in default.

## Goals / Non-Goals

**Goals:**

- Read and change every `ProjectPoliciesSchema` policy and `setupCommand` per project from the
  Projects section, against the existing `PATCH`.
- Keep inheritance intact: an unset policy displays as inherited, opening the section writes
  nothing, and clearing a policy removes its key.
- Refuse an invalid value with the limit/allowed values before the PATCH, using the shared schema.
- Touch nothing else on the project when one thing changes.

**Non-Goals:**

- Workspace-level `defaults` and daemon config (explicitly out of scope on the ticket).
- `defaultBranch`, `url`, `warmPaths`, `worktrees`, `openspec.enabled` (set at creation, low value).
- Any redesign of the Settings information architecture.
- Server, route, migration or schema-behavior changes.

## Decisions

### 1. The shape: an inline disclosure inside the row

Each row becomes a small column: the existing summary line, plus a **Delivery & setup** toggle that
reveals a responsive grid of controls beneath it. Toggle state is row-local.

Why not a per-project sheet (the shape Remove and Move already use): those are modal because they
are destructive and need a confirmation flow; changing a policy is routine and non-destructive, and
an inline panel keeps the controls visibly attached to the project they belong to when more than one
row is on screen. Why not render all nine controls inline with no disclosure: that would roughly
triple every row's height even when nobody is editing, and the ticket's premise is that the row is
already crowded. The disclosure leaves the default view exactly as compact as it is today and pays
the height cost only for the project being edited.

### 2. Inheritance is represented by key absence, not by a sentinel value

A generic helper replaces the YOLO-specific pair:

- `policyOverrideOf(policies, key)` returns `'inherit'` when the key is absent, else `String(raw)`.
- `withPolicy(policies, key, value)` spreads the existing policies and sets `key`, or removes it when
  `value === undefined`; the same spread-not-rebuild shape the row already uses for YOLO.

Choosing `inherit` calls `withPolicy(policies, key, undefined)`. No control ever writes a default
because it rendered — `value` props derive from server data and there is no effect that writes on
mount.

### 3. Atomic selections PATCH directly; text and number fields use `useCommittableField`

Enums and booleans are selects that call `patch.mutate` on change, exactly like the existing YOLO
select; `web-settings/field-commit` exempts an atomic selection from the commit machinery. The
`setupCommand` text field and the `mergeConcurrency` number field use `useCommittableField` +
`CommitStatus`, matching `maxWorkers`/`landingBranch`. The number is validated in `onCommit` and the
mutation is only reached when it passes.

### 4. Allowed values come from shared, never retyped

The UI imports `APPROVAL_OWNERS`, `MERGE_METHODS`, `DELIVERY_MODES` (already exported, already cited
by the schema) and a new `ARCHIVE_COMMITS`, added to `packages/shared/src/enums.ts` and referenced by
`ProjectPoliciesSchema` where `['push', 'pr', 'local']` is spelled inline today. That extraction is
behavior-preserving (same values, same parse) and removes the one enum the schema did not already
name, so no dropdown can drift from its schema. `mergeConcurrency`'s bounds come from
`ProjectPoliciesSchema.shape.mergeConcurrency.unwrap().removeDefault()`, the same derive-from-schema
approach `web-settings/add-project` uses for `maxWorkers` bounds.

### 5. The inherit label shows a resolved value only where the workspace supplies one

The YOLO select already reads `inherit (on|off)`. The panel does the same for `proposalApproval` and
`deliveryMode`, reading `config.defaults`; for the remaining policies, whose only fallback is a
built-in default, it says plain `inherit`. Restating those built-in defaults in the UI would be a
second place to keep in sync for no gain, and the acceptance only requires that an unset policy read
as inherited.

### 6. Approval-owner selects normalise the legacy spelling

`proposalApproval` and `taskApproval` display `conductor` as `weaver` (the schema's own
normalisation) and offer `APPROVAL_OWNERS`. Selecting `weaver` sends `weaver`; the server normalises
it back on the way in and `toLegacyPolicies` stores `conductor` again. No value is rewritten unless
the operator changes it.

### 7. `usePatchProject` updates the cached project optimistically

Because `PATCH` replaces `policies` wholesale, two changes made before a refetch lands would both
be computed from the same stale `p.policies`, so the second would drop the first. `usePatchProject`
gains an `onMutate` that merges the patch into the cached project list and an `onError` that rolls
it back, so the row's props advance with each change. The mutation is only used by Settings, and
optimistic display agrees with the "Saved"/"Unsaved" affordance the fields already show.

## Risks / Trade-offs

- **Mobile width** → the panel is a one-column grid below `sm`, controls wrap; the summary line is
  untouched. Verified in the UI suite by DOM assertions; a real-browser check is worth doing before
  merge if the reviewer wants one.
- **A rejected optimistic update briefly shows a value the daemon refused** → `onError` restores the
  snapshot; validation of `mergeConcurrency` happens before the mutation, so the common rejection
  never reaches the optimistic path.
- **The extracted `ARCHIVE_COMMITS` could be seen as a schema edit** → it is a constant reference
  replacing an inline literal with identical values; parsing is unchanged. Covered by the existing
  shared config tests plus `pnpm typecheck`.
- **Collapsing the panel leaves a dirty number draft in the hook** → the hook is declared in the row
  component, which stays mounted, so collapsing flushes nothing and switching sections flushes as
  `web-settings/field-commit` requires.

## Migration Plan

None. This is a released-UI change; the daemon applies project config live and `weave daemon upgrade`
is the owner's deploy step. No data migration, no rollback beyond reverting the release.
