## Context

See `proposal.md` for motivation. Evidence is [VS-159](conductor://tickets/VS-159) and [[token-spend]].

Today:

- `ac_ticket_list` returns `tickets.list()` which is `SELECT *` (`packages/core/src/tickets/service.ts:527`), so every MCP list includes `description`. HTTP `GET /tickets` uses the same service method. CLI-as-agent (`client.isAgent`) also calls the MCP tool; human CLI uses HTTP.
- MCP encodes `JSON.stringify(entire ToolResult)` with no cap (`packages/server/src/mcp.ts:32`). `boundPayload` 8 KiB is log-only.
- `templates/worker.AGENTS.md.tmpl:2` contains `{{charter}}` and `{{brief}}` inside an HTML comment. `renderTemplate` (`packages/core/src/prompts/template.ts:13-34`) does not treat comments as inert. Line 16 pastes `{{charter}}` again. Line 34 pastes `{{brief}}`, which is the `{ definitionOfDone, relaunchNote }` object and JSON.stringifies (`template.ts:69`), not `brief.md`.
- `buildTurnPrompt` pastes `knowledge.bootstrapDigest` into `## Notes` on `isFirstTurn || sessionStale` for every agent (`prompts/index.ts:316-326`). Worker AGENTS.md already inlines `{{knowledge.shared}}` and `{{knowledge.project}}`. VS-110 recording happens in the same block.
- OpenCode `buildArgs` sets `XDG_CONFIG_HOME` / `XDG_DATA_HOME` to `configHome` (`packages/runtimes/opencode/src/args.ts:54`) then the adapter spreads `process.env` (`adapter.ts:116`), leaving `HOME` as the host user. VS-159's OpenCode worker listed 18 host skills from `~/.agents` and `~/.claude`.

## Goals / Non-Goals

**Goals:**

- Slim MCP list payloads at the tool boundary, not by changing `tickets.list()` (UI stays fat).
- Stop the two prompt-side duplicates (charter comment, bootstrap paste) without shrinking what AGENTS.md is supposed to carry.
- Isolate OpenCode skill discovery via `HOME=configHome`. Audit other adapters; only patch those that actually load host HOME skills.

**Non-Goals:**

- Persistent per-role sessions, concise-output skills, filesystem ls caps, skills-by-ticket-kind (VS-159 #5), changing spawn.
- Making comments inert in the template engine (would affect every template).
- Capping get-by-id MCP results (a worker that asked for one body must receive it).
- Changing `knowledge/context-accounting`: still build and record the digest.

## Decisions

### Lean projection lives in the MCP handler, not `tickets.list()`

`ac_ticket_list` maps `tickets.list()` items to a lean row before returning. Service and HTTP stay `SELECT *`. Alternative considered: add `columns` to `TicketFilter` — rejected; the UI and tests depend on full rows, and MCP is the spend path.

Lean fields: `id`, `identifier`, `number`, `status`, `kind`, `title`, `summary`, `priority`, `projectId`, `assigneeRoleId`, `workerId`, `parentId`, `openspecChangeName`, `updatedAt`. Omit `description` (the 60% measured on VS-159). Keep `summary` (max 200, VS-146).

`includeDescription: z.boolean().optional()` on the tool input; default false. When true, pass the full row through.

`ac_ticket_comments`, `ac_inbox`, `ac_knowledge_get`, `ac_knowledge_doc_get`, `ac_spec_get`, `ac_ticket_document_get` stay full — they are get-or-content tools, not collection lists. Other list tools (`ac_knowledge_docs`, `ac_spec_list`, `ac_role_list`, `ac_worker_list`, `ac_run_list`, `ac_project_list`) are already catalogues or conductor-only and small; do not invent include flags for them unless a test shows a body field. If `ac_role_list` returns charter text, strip it the same way.

CLI `conductor ticket list` as an agent will see lean rows; its table only prints identifier/title/kind/status/priority, so it still works. `--json` as an agent will lose descriptions — that is the intended break; use `ticket get`.

### 64 KiB cap on list-tool MCP JSON only

Apply in `mcp.ts` (or a helper next to it) after `JSON.stringify`, keyed by tool name being a list tool (`ac_ticket_list` and any other list we slim). Truncate the JSON string to 64 KiB and parse-safe-rewrite as `{ ok: true, data: { truncated: true, items: <as many complete items as fit>, total }, error: null }` — never cut mid-object. Get-by-id tools skip the cap.

Alternative considered: cap every MCP result. Rejected — a long scout `report` via `ac_ticket_document_get` must arrive intact. Alternative: no cap, lean lists only. Rejected as a backstop; VS-159 proved 552 KiB fits today, and `includeDescription` plus `limit: 200` could still blow the window.

64 KiB is the top of VS-159's 32–64 KiB range so a lean page of 50 tickets (a few KB) is never truncated.

### Template: rename the comment, drop body `{{brief}}`

Change `templates/worker.AGENTS.md.tmpl` line 2 to prose without mustache (`charter` / `brief` as words, not `{{charter}}`). Keep the single body `{{charter}}` slot. Delete the body `{{brief}}` JSON dump (line 34); `brief.md` is the brief, and the Each-turn section already has the phase table. Do not inline `{{briefText}}` — that would *add* tokens.

Do not teach `renderTemplate` to skip HTML comments: other templates may one day want a slot in a comment, and the bug is the shipped source.

Tests: render the shipped template (`SHIPPED_TEMPLATES` already used in `render.test.ts`); assert charter heading count === 1; assert the template source has no `{{` inside `<!-- ... -->`.

### Skip worker digest paste, keep recording

In `buildTurnPrompt`, when `agent.kind === 'worker'` and `(isFirstTurn || sessionStale)`, still call `bootstrapDigest` + `recordBootstrap` (VS-110 / `knowledge/context-accounting`), but do not push the digest into `notes`. Conductor unchanged.

`sessionStale` without `isFirstTurn` is rare (`systemPrompt.mode` is `inject` only on `isFirstTurn`). If a stale session skipped AGENTS.md inject *and* we skip the digest, the worker would lose hubs for that turn. Mitigation: skip the paste only when `agent.kind === 'worker'` (AGENTS.md is on disk in the home and OpenCode/Claude re-read instruction files from cwd; first turn already injects). If a later bug shows stale sessions without AGENTS.md in context, re-paste then — do not pre-emptively keep the duplicate.

Existing test `builds a turn prompt with wakes...` expects `'SHARED.md + PROJECT.md digest'` on a worker first turn (`render.test.ts:139`) — invert that assertion for workers; add a conductor case that still contains it.

### OpenCode `HOME=configHome`

In `buildArgs`, when `input.configHome` is set:

```
env.HOME = input.configHome
env.XDG_CONFIG_HOME = input.configHome
env.XDG_DATA_HOME = input.configHome
```

`adapter.ts` already overlays `built.env` on `process.env`, so this overrides host HOME.

Provider keys in the process environment (`ANTHROPIC_API_KEY`, …) still pass through. OpenCode config/auth that honour XDG already land in `configHome`. If OpenCode also reads `$HOME/.config/opencode` ignoring XDG, pointing HOME at configHome is the isolation we want.

Unverified against a live OpenCode (charter rule): exact skill-discovery order. Fake-CLI / `buildArgs` tests prove `HOME` is set. PR notes the live skill list as unverified.

Audit Claude (`CLAUDE_CONFIG_DIR`), Codex (`CODEX_HOME`), Gemini (`GEMINI_CLI_HOME`), Cursor (`CURSOR_CONFIG_DIR`). If any spreads `process.env` without overriding HOME *and* their CLI loads `~/.agents` or `~/.claude/skills` via HOME, apply the same `HOME=configHome`. If they already isolate, leave them.

Do not launch a real CLI to check this. `strings` on the binary / existing adapter tests only.

## Risks / Trade-offs

- [A worker lists tickets and then has no descriptions] → Mitigation: `ac_ticket_get` is one extra call; tool description and `skills/agent-conductor-worker/references/tools.md` say so.
- [Truncation drops the last tickets on a huge includeDescription list] → Mitigation: `truncated: true` plus `total`; agent narrows the filter or gets by id. Default lean list of 50 will not hit 64 KiB.
- [OpenCode auth breaks because HOME moved] → Mitigation: XDG already pointed at configHome; credentials for isolated daemons live under config dir (VS-143). Host-shared OpenCode keys in env still work. If a live deploy shows login failure, `HOME` can fall back and we disable host skill dirs another way (OpenCode config `skillPaths`) — do not guess a flag we have not `strings`'d.
- [Stale worker session loses knowledge hubs] → Mitigation: skip paste only for workers; AGENTS.md remains the instruction file on disk. Revisit if a stale-session bug appears.
- [CLI `--json` as agent loses description] → Accepted break; human CLI still uses HTTP.

## Migration Plan

Ship in one PR. No DB migration. No config flag. After merge the running daemon is unchanged until `conductor daemon upgrade`. Rollback is revert; lean-list callers that already used `get` keep working.

## Open Questions

None that change the specs. Live OpenCode skill-discovery paths stay unverified per the credential rule; the `HOME` override is the VS-159 recommended fix.
