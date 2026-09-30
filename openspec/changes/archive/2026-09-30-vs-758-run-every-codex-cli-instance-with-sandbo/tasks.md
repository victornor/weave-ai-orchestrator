## 1. Sandbox
- [x] 1.1 `buildArgs`: full access in every non-bypass mode (flag on new, `-c sandbox_mode` on resume/fork); drop writable-roots; keep approval/MCP settings
- [x] 1.2 `postureFor`: `danger-full-access` for every mode
- [x] 1.3 Remove `gitdir.ts`, `sandboxWritableRoots` and the adapter wiring

## 2. Tests and docs
- [x] 2.1 Update/add unit tests for `buildArgs` and `postureFor` (all modes, new and resume); delete gitdir tests
- [x] 2.2 Update docs/prompt text that says codex workers have no network
- [x] 2.3 Lint, typecheck, both suites
