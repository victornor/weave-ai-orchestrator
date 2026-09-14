# Tasks — VS-423

## 1. Compare and drop the duplicate web-pages delta

- [x] 1.1 Confirm VS-334's `plugins/web-pages` delta carries nothing that `main`'s VS-385 spec lacks.
- [x] 1.2 Remove `specs/plugins/web-pages/` from the VS-334 change.

## 2. Archive VS-334's change

- [x] 2.1 Move `openspec/changes/vs-334-plugins-can-add-agent-tools-their-own-st/` under
      `openspec/changes/archive/2026-09-13-vs-334-plugins-can-add-agent-tools-their-own-st/`.
- [x] 2.2 Create `openspec/specs/plugins/{agent-tools,events,http-routes,lifecycle,storage}/spec.md`
      with VS-334's requirements.
- [x] 2.3 Leave `openspec/specs/plugins/web-pages/spec.md` (VS-385's) untouched.

## 3. Validate

- [x] 3.1 `openspec validate --strict` clean.
- [x] 3.2 `pnpm lint` and `pnpm typecheck` pass.

## 4. Deliver

- [x] 4.1 Open this ticket's PR.
- [x] 4.2 Close #313 as superseded, linking the PR.
