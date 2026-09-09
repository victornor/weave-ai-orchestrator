## 1. Lean MCP lists

- [x] 1.1 Add `includeDescription` (default false) to `ac_ticket_list` and map items to the lean projection in `packages/server/src/tools.ts`. Verify a handler/MCP test: default list items have `id`/`identifier`/`status`/`kind`/`title` and no `description`; `includeDescription: true` restores it; `ac_ticket_get` still returns `description`.
- [x] 1.2 Leave `tickets.list()` and `GET /tickets` full. Verify an existing HTTP or tickets-service test still sees `description` on listed rows (add one if none asserts that field).
- [x] 1.3 Cap MCP list-tool JSON at 64 KiB with `truncated: true` in `packages/server/src/mcp.ts`. Verify a test that a synthetic oversized list result is truncated and marked; `ac_ticket_get` over 64 KiB is not.

## 2. Worker prompt dedup

- [x] 2.1 Edit `templates/worker.AGENTS.md.tmpl`: HTML comments contain no `{{...}}` slots; keep a single body `{{charter}}`; remove the body `{{brief}}` JSON dump. Verify the template source has no `{{` inside `<!-- -->`.
- [x] 2.2 Render the shipped worker template in `packages/core/src/prompts/render.test.ts` and assert the charter heading appears exactly once. Verify that test fails on current main and passes after 2.1.
- [x] 2.3 Skip pasting `bootstrapDigest` into the worker turn prompt in `buildTurnPrompt`; still call `bootstrapDigest` + `recordBootstrap`. Conductor paste unchanged. Verify worker first-turn prompt does not contain the digest fixture; conductor first-turn prompt still does; a knowledge-usage test still records worker bootstrap.

## 3. OpenCode skill isolation

- [x] 3.1 Set `HOME` to `configHome` in OpenCode `buildArgs` when `configHome` is set. Verify `packages/runtimes/opencode/test/args.test.ts` expects `HOME` (and existing XDG vars) equal to `configHome`.
- [x] 3.2 Audit Claude/Codex/Gemini/Cursor spawn env (source + tests, no live CLI). If an adapter inherits host HOME for skill discovery, set `HOME=configHome` the same way and add the same assertion. If none leak, record that in the PR; do not change them.

## 4. Docs and suite

- [x] 4.1 Update PLAN §9.2, `docs/API.md` MCP, and `skills/agent-conductor-worker/references/tools.md` so `ac_ticket_list` is documented as lean-by-default with `includeDescription` / `ac_ticket_get` for bodies.
- [x] 4.2 Run `pnpm lint && pnpm typecheck && pnpm test` and fix regressions from the above.
