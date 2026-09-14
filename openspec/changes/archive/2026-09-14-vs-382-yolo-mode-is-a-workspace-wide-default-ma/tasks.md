## 1. Shared model

- [x] 1.1 Remove `yolo` from `WorkspaceDefaultsSchema` in `packages/shared/src/config.ts` and change `yoloEnabled` to a single `policies` argument returning true only for an explicit project `yolo: true` (unset/malformed = false). Verify `packages/shared/src/config.test.ts` covers: unset project is off, explicit `true`/`false`, malformed value off, and that an old `defaults.yolo: true` no longer grants anything.
- [x] 1.2 Update the `ProjectPoliciesSchema.yolo` doc comment and any `yolo` reference in `packages/shared` to say it is per-project and off unless set.

## 2. Core resolution, prompts and migration

- [x] 2.1 In `packages/core/src/tickets/service.ts`, resolve `yolo(t)` from the ticket's project policies only, and change `autoApprove`'s recorded answer to name the project that granted it. Verify `packages/core/src/tickets/yolo.test.ts` passes with a per-project setup and that `defaults.yolo` has no effect.
- [x] 2.2 In `packages/core/src/prompts/index.ts`, pass only the project policies to `yoloEnabled`; verify the brief reflects the ticket's project and `packages/core/src/prompts/render.test.ts` covers on and off.
- [x] 2.3 Add the one-time migration to `packages/core/src/workspace/loader.ts`, gated by a `vs382_yolo_migrated` `meta` row: when the raw config has `defaults.yolo: true`, set `policies.yolo: true` on every project without an explicit value (declared config and non-archived DB `policies_json`), leave explicit `false` alone, log the count, and drop `defaults.yolo` from the rewritten `workspace.yaml`. Verify in `packages/core/src/workspace/loader.test.ts`: copies true, preserves false, runs once, a project added afterwards is off, and the key is gone from disk.
- [x] 2.4 Verify the migration also updates the project row the daemon reads (`projects.policies_json`), by asserting the migrated value through the same query `yolo(t)` uses.

## 3. Server and CLI

- [x] 3.1 In `packages/server/src/routes/workspace.ts`, refuse a `defaults.yolo` key in `PATCH /config` with a validation error naming the per-project setting. Verify with a route test: the request is rejected and the stored config is unchanged.
- [x] 3.2 In `packages/cli/src/commands/workspace.ts`, remove `yolo` from `set-default`'s help and refuse it early with the same message; verify in `packages/cli/src/program.test.ts`.
- [x] 3.3 In `packages/cli/src/commands/project.ts`, drop the "unset inherits the workspace" note from `set-policy`'s help and surface a project's `yolo` value on `project show`. Verify `program.test.ts` asserts the help text no longer mentions inheritance and the value is printed.

## 4. Web app

- [x] 4.1 In `packages/ui/src/lib/yolo.ts`, delete `workspaceYolo` and resolve `projectYolo`/`isAutoApproving` from the project policies only. Verify the affected UI tests compile and pass.
- [x] 4.2 In `packages/ui/src/routes/Settings.tsx`, remove the workspace `YoloSection` control (replace with a one-line note pointing at Projects) and give `ActiveProjectRow` an off-by-default YOLO toggle that requires confirmation (naming plan+merge granted for the project, action approvals staying with the human), sends no PATCH without confirmation, patches off without confirmation, shows a marker when on, and offers no inherit option. Verify with `packages/ui/src/test/settings.test.tsx`: no workspace-wide switch, confirmation required, dismissal writes nothing, marker shown.
- [x] 4.3 In `packages/ui/src/app/AppShell.tsx`, remove the workspace-wide YOLO banner. Verify `packages/ui/src/test/appshell.test.tsx` no longer expects it.
- [x] 4.4 In `packages/ui/src/v2/settings/sections/Workspace.tsx`, remove the YOLO card from `ApprovalsSection` and add the note that YOLO is set per project in Projects. Verify `packages/ui/src/test/v2settings.test.tsx`.
- [x] 4.5 In `packages/ui/src/v2/V2Onboarding.tsx`, stop writing `defaults.yolo`; map "Let the weaver decide" to patching each project added in the run to `policies.yolo: true` after a successful create, and write nothing when no project was added. Verify `packages/ui/src/test/v2onboarding.test.tsx` covers all three answers and the no-projects case.
- [x] 4.6 In `packages/ui/src/v2/project/ProjectPage.tsx`, show a YOLO marker in the header/identity block when the project has the mode on. Verify `packages/ui/src/test/v2onboarding.test.tsx` or the project-overview test covers on and off.
- [x] 4.7 Update the remaining UI tests that set `defaults.yolo` to configure a project's `policies.yolo` instead (`needsyou.test.tsx`, `v2workBoard.test.ts`, any board/global-needs test), and confirm `pnpm --filter @weave-ai/ui exec vitest run` is green.

## 5. Verification and docs

- [x] 5.1 Run `pnpm lint` and `pnpm typecheck` and confirm both are clean.
- [x] 5.2 Run `pnpm test` and paste **both** suite blocks verbatim (core/server and UI), never summed and never only one.
- [x] 5.3 Rendered check against an isolated scratch daemon (`--config-dir` outside the live config, loopback port other than 7433, PID recorded in a pidfile and stopped only by that PID): V2 Settings → Projects with one project in YOLO, in dark and light, and list what was checked. Never against the live daemon.
- [x] 5.4 Update `docs/PLAN.md` §15 to describe YOLO as a per-project setting with no workspace default, the migration, and the deprecation; update `docs/API.md` if the `PATCH /config` refusal or a project field changes the documented surface. Leave no untracked files in the worktree (`git status --porcelain` empty before review).
