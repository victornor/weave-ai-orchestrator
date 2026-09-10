## 1. Engine spawn permission

- [x] 1.1 In `packages/core/src/runs/engine.ts`, when building `TurnInput.permission.mode`, set `bypass` if `agent.kind === 'conductor'`; otherwise keep `role.permission.mode ?? workspace.defaults.permissionMode ?? 'auto'`. Do not drop `allowedTools` / `deniedTools`. Verify by reading the spawn site.
- [x] 1.2 In `packages/core/src/runs/engine.test.ts`, add cases: conductor turn with workspace default `auto` gets `permission.mode === 'bypass'`; worker turn with default `auto` and no role mode gets `'auto'`; worker role `bypass` and `restricted` still apply. Verify `pnpm vitest run packages/core/src/runs/engine.test.ts` passes.

## 2. Claude mapping and PLAN

- [x] 2.1 Confirm `packages/runtimes/claude/test/args.test.ts` still asserts bypass maps to `--permission-mode bypassPermissions --allow-dangerously-skip-permissions`. Change `args.ts` only if that test is missing or wrong. Verify `pnpm vitest run packages/runtimes/claude/test/args.test.ts` passes.
- [x] 2.2 Update `docs/PLAN.md` §10.2 so a conductor turn always spawns with permission bypass, and §19 so worker `bypass` still needs explicit opt-in while the conductor kind always bypasses. Verify those two paragraphs name the exception.

## 3. Checks and delivery

- [x] 3.1 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all are green.
- [x] 3.2 Open the PR, record it on the ticket, and state that worker defaults and MCP-on-auto allowlisting were left unchanged on purpose.
