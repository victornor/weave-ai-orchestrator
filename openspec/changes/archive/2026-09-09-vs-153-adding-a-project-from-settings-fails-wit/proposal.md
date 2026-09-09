## Why

Captain tried to add a project from Settings and got HTTP 400 `Unrecognized key(s) in object: 'autoMerge'`. The Add-project form always posts a top-level `autoMerge` flag (even when the control is off). `POST /projects` uses a strict `AddSchema` that does not accept that key. The control is labelled "Auto-merge default" and is meant to set the project's `policies.autoMergeDefault`, not the ticket-level `autoMerge` flag.

## What Changes

- The Settings add-project form maps "Auto-merge default" onto `policies.autoMergeDefault` in the `POST /projects` body. When the control is on, the body includes `{ policies: { autoMergeDefault: true } }`. When it is off, that policy is omitted (unset, inheriting the schema default of false). The body never includes a top-level `autoMerge` key.
- `AddSchema` accepts an optional `policies` object (at least `autoMergeDefault`) so the mapped field is not rejected as unrecognized. The schema stays `.strict()` — a top-level `autoMerge` continues to 400.
- `useAddProject`'s body type drops `autoMerge` and carries `policies` instead, matching what the route actually accepts.
- A test covers both control values: the Settings/add body (or the equivalent `AddSchema` parse) is accepted when auto-merge default is off and when it is on, and is rejected if `autoMerge` is sent at the top level.

## Capabilities

### New Capabilities

- `web-settings/add-project`: how the Settings add-project form talks to `POST /projects` — that Auto-merge default maps to the project's `autoMergeDefault` policy, that both on and off succeed, and that the request never sends the unrecognized ticket-level `autoMerge` key.

### Modified Capabilities

(none — `web-settings/settings-scopes` is area/section layout, `web-settings/field-commit` is how existing fields save, and `workspace-setup/setup-surfaces` is onboarding/job progress. None of them specify the add-project request body.)

## Impact

- `packages/ui/src/routes/Settings.tsx` (`ProjectsSection`) — the Add-project mutate body.
- `packages/ui/src/api/hooks.ts` (`useAddProject` body type).
- `packages/server/src/routes/projects.ts` (`AddSchema`) — optional `policies`.
- `packages/core/src/projects/index.ts` — no logic change expected: `startAdd` already persists `cfg.policies` via `createRow`. Verify a true `autoMergeDefault` survives onto the new project's `policies`.
- `docs/API.md` — `POST /projects` body gains optional `policies.autoMergeDefault`.
- Tests: `packages/ui/src/test/settings.test.tsx` (mutate body for both control values); `packages/server/test/jobs.test.ts` (or a colocated schema test) that `AddSchema` accepts `{ url, policies: { autoMergeDefault: true } }` / a body with no policies, and still rejects `{ url, autoMerge: false }`.
- Out of scope, per the ticket: ticket-level `autoMerge` behaviour, YOLO mode, CLI `project add` (already works; `--auto-merge-default` is not required). Nothing currently reads `autoMergeDefault` when creating a ticket (`tickets.create` uses `input.autoMerge ?? false`); this change stores the policy the form already offered, it does not start inheriting it onto new tickets.
