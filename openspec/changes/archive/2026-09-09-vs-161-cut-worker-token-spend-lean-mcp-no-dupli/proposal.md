## Why

Workers burn billed input tokens on three product bugs, measured on this workspace 2026-09-09 ([VS-159](conductor://tickets/VS-159)): `ac_ticket_list` returned ~158k tokens of full ticket rows (descriptions 60%); `templates/worker.AGENTS.md.tmpl` expands `{{charter}}` inside an HTML comment *and* in the body (~2.2k tok duplicate); first-turn `bootstrapDigest` re-pastes PROJECT.md already inlined in AGENTS.md (~5k tok); OpenCode spreads host `HOME`, so ~18 host skills (bailian, omarchy, …) appear on every request. Output is negligible vs input. Captain, 2026-09-09: fix these in the product, not as a local patch.

## What Changes

- MCP list tools default to a lean projection (identifiers, status, kind, title — not `description` or document bodies). `ac_ticket_get` (and other get-by-id tools) stay full. Optional `includeDescription` on `ac_ticket_list` for the rare case a list really needs bodies. HTTP `GET /tickets` is unchanged (UI).
- A hard cap on MCP *list* result JSON (64 KiB) with a `truncated` marker; get-by-id results are not capped.
- Worker AGENTS.md renders the role charter exactly once. Template comments MUST NOT contain mustache slots (`{{charter}}` / `{{brief}}`). The accidental `{{brief}}` JSON dump in the body is removed (the real brief is `brief.md`).
- Worker first-turn / stale-session prompt does not paste `bootstrapDigest` when AGENTS.md already inlined SHARED + PROJECT. Conductor digest is unchanged. Knowledge-usage recording (VS-110) still runs.
- OpenCode spawn sets `HOME` to the workspace runtime `configHome` (already used for `XDG_*`), so host `~/.agents` / `~/.claude` skills are not discovered. Other adapters that inherit host HOME skill dirs get the same isolation if they currently leak.

**Not breaking** for the web UI (HTTP list stays fat). **BREAKING** for MCP/`conductor` CLI-as-agent callers of `ac_ticket_list` that read `description` off the list payload — they use `ac_ticket_get` or `includeDescription: true`.

## Capabilities

### New Capabilities

- `agent-tools/lean-lists`: MCP list tools return a lean projection by default; detail is a follow-up get or an explicit include; list results are size-capped.
- `worker-prompt/dedup`: Worker AGENTS.md contains the charter once; first-turn prompt does not re-paste knowledge hubs already inlined in AGENTS.md.
- `opencode-runtime/skill-isolation`: An OpenCode turn (and any adapter that inherits host HOME skill dirs) sees only AgentConductor-installed skills, not host skill directories.

### Modified Capabilities

(none — `knowledge/context-accounting` still records bootstrap tokens; this change stops *pasting* the digest into the worker user prompt, it does not stop measuring it.)

## Impact

- `packages/server/src/tools.ts` (`ac_ticket_list` projection + `includeDescription`); `packages/server/src/mcp.ts` (list-result cap).
- `templates/worker.AGENTS.md.tmpl`; `packages/core/src/prompts/index.ts` (`buildTurnPrompt` skip worker digest paste); `packages/core/src/prompts/render.test.ts`.
- `packages/runtimes/opencode/src/args.ts` (`HOME=configHome`); audit other adapters' spawn env.
- Docs: `docs/PLAN.md` §9.2, `docs/API.md` MCP, `skills/agent-conductor-worker/references/tools.md`.
- Tests: lean list shape, single charter in rendered AGENTS.md, no worker bootstrap paste, OpenCode `HOME` isolation. HTTP ticket list and `ac_ticket_get` stay full.
- Out of scope: persistent per-role sessions; concise-output skills; filesystem ls caps; installing skills by ticket kind; changing how tickets spawn.
