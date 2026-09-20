## Why

Slice 1 (VS-607) proved the built-in agent's loop end to end but gave the model only `read` and `bash`, so it cannot change code through file tools and nothing keeps it out of the daemon's own state. Slice 2 of 9 makes a worker turn able to change code safely: the four remaining core tools (`write`, `edit`, `grep`, `glob`), path confinement, the read ledger with stale-file detection, and the three permission modes with bash deny patterns. This is the slice the captain's decision "a worker can change code safely with the built-in agent" names as S2 in `builtin-agent-slices`.

## What Changes

- `packages/agent/src/tools/{write,edit,grep,glob}.ts`: the remaining core tools, schemas and output shapes exactly as in `builtin-agent-runtime-details` section 5.
- `packages/agent/src/tools/confine.ts`: roots (worktree + agent home), `realpath` resolution before the check, protected paths refused in every mode, system-path reads only in `auto`/`bypass`.
- `packages/agent/src/tools/ledger.ts`: the per-turn read ledger (`path`, `mtimeMs`, `size`, `sha1`) and stale-file detection; `write` to an existing file and every `edit` require a prior `read`.
- `packages/agent/src/permission.ts`: the mode → tool-set table, bash deny patterns for `auto`, and `allowedTools`/`deniedTools` matching with the Claude aliases. `restricted` removes the write-capable tools from the request body itself.
- `edit` safety: the ordered match chain (exact, line-trimmed, whitespace-normalised, indentation-flexible, smart-quote normalised), ambiguity as an error, `replace_all`, CRLF/BOM preservation, the atomic write (temp file, fsync, rename, mode preserved, temp unlinked on failure), 10 MB refusal.
- `grep`/`glob` on `rg` when it is on `PATH`, with a built-in `.gitignore`-aware walker and JS `RegExp` fallback, logging which one is in use.
- `loop.ts` emits `file.changed` (with the unified diff for `edit`), `command.executed` and `tool.denied`, and the adapter keeps forwarding all three.
- A render golden in `packages/render` pinning that a weave `edit` renders as a diff file block and a weave `bash` renders as a command row, plus screenshots (dark and light, desktop and phone) attached to the ticket.
- Project knowledge documents updated where this slice changes them.

Non-goals: providers, presets, discovery and the Settings UI (S3/S4); the full error table, repair and doom-loop guard (S5); compaction, pruning and skills (S6); live input, structured output and `todo_write` (S7); MCP stdio, `web_fetch` and images (S8); subagents (S9), which S2 unblocks. Also out of scope: any OS sandbox, an approval round-trip UI, and cost display.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `builtin-agent`: adds the write-capable core tools with their confinement, edit-safety and search behavior, the three permission modes with deny patterns and Claude-alias tool filtering, and the `file.changed` / `command.executed` / `tool.denied` events the run transcript renders. The existing requirements for the loop, protocol, sessions and the `read`/`bash` caps are unchanged.

## Impact

- `packages/agent/src/tools/*` (four new tool modules, `confine.ts`, `ledger.ts`), `packages/agent/src/permission.ts` (new), `packages/agent/src/loop.ts` (tool registry, permission filter, event emission), `packages/agent/src/protocol.ts` (the child's `toolEnv`/`configHome`-derived confinement inputs).
- `packages/runtimes/weave/src/events.ts` and `adapter.ts`: no new event types, but a test pinning that `file.changed`, `command.executed` and `tool.denied` survive translation.
- `packages/render/src/transcript.test.ts`: a golden for the weave `edit`/`bash` payloads. No render code change is expected; if the payload pins a gap, the fix is in the renderer.
- No database migration, no new API route, no UI component change; existing runtimes are untouched. `bash` remains unconfined at the OS level (as for the three CLIs and pi) — this slice adds deny patterns and the file-tool protected-path list, not a sandbox.
- Dependency added: none. `rg` is looked up on `PATH` at runtime, never bundled.
