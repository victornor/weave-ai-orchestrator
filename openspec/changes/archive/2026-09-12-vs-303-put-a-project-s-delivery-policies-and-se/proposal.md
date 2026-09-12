## Why

VS-301's settings audit found the highest-value remaining gap after the landing branch: the eight
`ProjectPoliciesSchema` policies decide **how a project's work lands**, and `setupCommand` runs shell
in its clone, but the Projects row edits only `yolo` — `autoMergeDefault` is settable only in the add
dialog, and the other seven have no UI at all. Changing them today means dropping to
`weave project set-policy`. The write path already exists, applies live and accepts every one of
them, so this is UI-only work.

## What Changes

- Add an inline, collapsible **Delivery & setup** panel to each project row in the Settings Projects
  section.
- The panel edits `setupCommand` and every policy the row does not already expose: the enums
  `proposalApproval`, `taskApproval`, `mergeMethod`, `deliveryMode`, `archiveCommit`, the booleans
  `autoMergeDefault` and `requireCi`, and the number `mergeConcurrency`. `yolo` stays on the row's
  summary line.
- An unset policy reads as **inherited** — never materialised into the project's config — and
  selecting inherit removes the key. Opening the section writes nothing.
- Enum and boolean options come from the shared enums/`ProjectPoliciesSchema`; `mergeConcurrency` is
  validated against the schema's bounds, with the range in the message, **before** any PATCH.
- A PATCH carries only the changed policy (spread over the project's existing policies) or only
  `setupCommand` — never a rebuilt project.
- Non-behavioral refactor: the inline `['push','pr','local']` `archiveCommit` values move to an
  exported `ARCHIVE_COMMITS` constant in `packages/shared/src/enums.ts`, cited by the schema, so a
  dropdown and the schema cannot drift.

## Capabilities

### New Capabilities
- `web-settings/project-policies`: reading and changing a project's delivery policies and setup
  command from the Settings Projects section, with inherited values left unset and nothing else on
  the project disturbed.

### Modified Capabilities
(none)

## Impact

- `packages/ui/src/routes/Settings.tsx` (the project row) and `packages/ui/src/api/hooks.ts`
  (`usePatchProject`, for the successive-change case).
- `packages/shared/src/enums.ts` and `packages/shared/src/config.ts` (constant extraction only).
- Tests: `packages/ui/src/test/settings.test.tsx`, `packages/core/src/projects/projects.test.ts`.
- No route, schema-behavior, migration or API change: `PATCH /projects/:id` already accepts all of
  these fields and applies them live.
