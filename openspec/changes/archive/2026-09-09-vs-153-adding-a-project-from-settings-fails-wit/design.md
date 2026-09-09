## Context

See proposal.md - Why. The mismatch is three lines of client vs one strict Zod object:

- `packages/ui/src/routes/Settings.tsx:467` always posts `{ url, maxWorkers, setupCommand?, autoMerge }`.
- `packages/ui/src/api/hooks.ts:283` types that body with `autoMerge?: boolean`.
- `packages/server/src/routes/projects.ts:7-12` `AddSchema` is `.strict()` and lists `url, id, name, defaultBranch, landingBranch, maxWorkers, setupCommand` — no `autoMerge`, no `policies`.

The route then `ProjectConfigSchema.parse({ ...input, id })`. That schema already has `policies: ProjectPoliciesSchema.default({})`, and `createRow` (`packages/core/src/projects/index.ts:160`) already writes `policiesJson: cfg.policies`. So once `AddSchema` lets a `policies` object through, persistence is already there. Ticket-level `autoMerge` (`POST /tickets`, `ac_ticket_create`) is a different flag and stays untouched.

`autoMergeDefault` is currently stored and settable via `conductor project set-policy` but not read when creating a ticket (`tickets.create` uses `input.autoMerge ?? false`). That inheritance gap is pre-existing and out of scope.

## Goals / Non-Goals

**Goals:**

- One accepted add body for both control values, with Auto-merge default landing on `policies.autoMergeDefault`.
- Keep `AddSchema` strict, so a caller that still sends top-level `autoMerge` (or a runtime/model, VS-77) still gets a named validation error rather than a silent drop.

**Non-Goals:**

- Making new tickets inherit `policies.autoMergeDefault` or workspace `defaults.autoMerge`.
- CLI `project add --auto-merge-default`, `ac_project_add` growing a policies field, or YOLO.
- Relaxing `.strict()` on `AddSchema`.

## Decisions

**Map in the client; accept `policies` on the route.** Settings sends `{ url, maxWorkers, setupCommand?, policies: { autoMergeDefault } }` with the boolean matching the control (true when on, false when off). `AddSchema` gains `policies: ProjectPoliciesSchema.optional()` and stays `.strict()`. Reusing `ProjectPoliciesSchema` rather than a one-key `{ autoMergeDefault }` object means a future add-time policy (yolo, deliveryMode) does not need another schema edit, and PATCH already accepts the same shape via `ProjectConfigSchema.partial().strict()`.

Alternative considered: a top-level `autoMergeDefault` on `AddSchema`, mapped to `policies` in the route. Rejected — it invents a third name next to ticket `autoMerge` and project `policies.autoMergeDefault`, and the ticket already names the policy as the destination.

Alternative considered: omit `policies` entirely when the control is off. Allowed by the spec ("false or unset") but always sending the boolean makes the GET-back assertion one equality, not an "absent or false" branch.

**Do not export `AddSchema` just for the test.** Cover the schema through `POST /projects` in `packages/server/test/jobs.test.ts` (already the add-route test): a body with `policies.autoMergeDefault: true` reaches `startAdd` with that config; a body with top-level `autoMerge` is 400 `unrecognized_keys`. The Settings test captures `useAddProject().mutate`'s argument for both control values and asserts it has no `autoMerge` key.

**No core service change unless the HTTP test proves `startAdd` drops `policies`.** `createRow` already persists `cfg.policies`. A `projects.test.ts` case that `add(..., { policies: { autoMergeDefault: true } })` yields `project.policies.autoMergeDefault === true` is cheap insurance and should be added if the HTTP test has to stub `startAdd` (today it does — `jobs.test.ts` replaces `startAdd`). In that case the persistence assertion belongs in `packages/core/src/projects/projects.test.ts`, not in the stubbed route test.

## Risks / Trade-offs

- [Accepting the whole `ProjectPoliciesSchema` on add lets a caller set yolo/deliveryMode at create time, which the UI does not offer] → same surface PATCH already has; not a new privilege. The add form still only sends `autoMergeDefault`.
- [`autoMergeDefault: false` written explicitly vs omitted] → explicit false is stored on the project row; `set-policy` later can still change it. No migration needed.
- [Nothing reads `autoMergeDefault` when creating tickets, so turning the control on will not auto-merge the project's first tickets] → pre-existing; the ticket stores the policy the form already claimed to set. Call it out in the PR so it is not mistaken for a regression.

## Migration Plan

No data migration. Deploy is a daemon upgrade: old clients that still post `autoMerge` keep getting 400 until they run this UI; the CLI never sent the key. Rollback is the reverse — Settings add with the control off would 400 again.

## Open Questions

(none)
