## Why

Slices 1–3 gave the built-in agent a streamed loop, the six core tools with confinement and permission modes, and provider profiles. Three capabilities the design names are still missing, so a worker cannot use any MCP server other than the run-scoped Weave one, cannot read a page from the web safely, and cannot look at an image. Slice 8 of 9 ("MCP completeness, web fetch, images" in `builtin-agent-slices`) closes exactly that: a stdio MCP transport beside S1's streamable-HTTP one, stable tool naming with collisions handled, a 50 KB result cap, an SSRF-safe `web_fetch`, and image reading through the three `image.input` modes. It depends on S2 (VS-608, merge `0a52f98f`), which landed the confinement and permission machinery this slice's `web_fetch` denial rides.

## What Changes

- `packages/agent/src/mcp/stdio.ts`: a stdio MCP transport (spawn a command, newline-delimited JSON-RPC on its stdio, initialize/list/call, kill on cancel, per-call timeouts) that speaks the same client interface as the existing streamable-HTTP client.
- `packages/agent/src/mcp/index.ts` (or `client.ts`): one `McpClient` interface both transports implement, a factory that builds the right one from a server config's `type`, a shared `close()`, and the 50 KB result cap moved out of `http.ts` so both transports share it.
- `packages/agent/src/mcp/naming.ts`: `mcp__<server>__<tool>` sanitised to `[A-Za-z0-9_-]{1,64}` with collisions suffixed, and the run-scoped Weave server's tools left unprefixed.
- `packages/agent/src/net/ssrf.ts`: IPv4/IPv6 address classification (loopback, private, link-local, CGNAT, metadata, unique-local, IPv4-mapped), a resolve-once helper and a redirect-following fetch that connects to the address it resolved rather than re-resolving, so DNS rebinding cannot slip through.
- `packages/agent/src/tools/webFetch.ts`: the `web_fetch` tool (http(s), 5 MB read cap, 30 s timeout, 50 KB result cap, html→text), off unless the `webFetch` option enables it, removed from the request in `restricted`.
- `packages/agent/src/tools/image.ts` plus changes in `read.ts`, `tools/index.ts`, `types.ts`, `codec/params.ts`, `codec/chatCompletions.ts` and `loop.ts`: image detection by magic bytes, images carried from a tool result into the request as a user message (`image.input:user`, the default) or inside the tool message (`user_and_tool`), and an error text for `image.input:none`.
- `packages/agent/src/protocol.ts` and `packages/runtimes/weave/src/child.ts`: the child's `mcpServers` gains the stdio fields (`command`, `args`, `env`) and the child stops dropping non-HTTP servers.
- `packages/shared/src/config.ts`: `image.input` added to `ProviderCompatSchema`; `packages/runtimes/weave/src/adapter.ts`: the `webFetch` boolean option added to `configSchema`.
- Project knowledge documents updated where this slice changes them.

Non-goals: subagents and tool-output streaming (S9); sourcing user-configured MCP servers from workspace or role config (the engine still supplies only the run-scoped Weave server — this slice makes the client able to run other servers and proves it with fakes); MCP OAuth, elicitation and tool-search deferral; web search; OS sandbox; user-attached images (only `read` produces images in v1).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `builtin-agent`: adds the stdio MCP transport, the naming rule for non-Weave servers, the shared 50 KB result cap, the SSRF-safe `web_fetch` and its restriction/opt-in, and image reading through the three `image.input` modes. Existing requirements for the loop, the HTTP MCP client, sessions, the core tools and the permission modes are unchanged.

## Impact

- `packages/agent/src/mcp/*` (new `stdio.ts`, `naming.ts`, a shared client interface; `http.ts` implements it), `packages/agent/src/net/ssrf.ts` (new), `packages/agent/src/tools/{webFetch,image}.ts` (new), `tools/{read,index}.ts`, `types.ts`, `codec/{params,chatCompletions}.ts`, `loop.ts` (multi-transport registry, naming, `web_fetch` registration, image lifting).
- `packages/agent/src/protocol.ts` and `packages/runtimes/weave/src/child.ts`: stdio fields on the child's `mcpServers` record (additive to `v:1`, no protocol bump — the child ships in the daemon's own release).
- `packages/shared/src/config.ts`: `image.input` on `ProviderCompatSchema`; `packages/runtimes/weave/src/adapter.ts`: `webFetch` in `configSchema`.
- No database migration, no API route, no UI component change, no new dependency (the SSRF fetch uses `node:http`/`node:https` and `node:dns`; no `undici` import). `bash` remains unconfined at the OS level, unchanged by this slice.
