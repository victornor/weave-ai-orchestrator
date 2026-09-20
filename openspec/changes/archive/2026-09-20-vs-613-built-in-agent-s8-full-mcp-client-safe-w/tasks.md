## 1. MCP client interface and stdio transport

- [x] 1.1 Add `packages/agent/src/mcp/client.ts` with the `McpClient` interface (`initialize`, `listTools`, `callTool`, `close`) and `McpToolResult`; add `packages/agent/src/mcp/result.ts` with `capMcpResult` moved out of `http.ts`; make `McpHttpClient` implement the interface (with a no-op `close`) and call the shared cap. Verify: `pnpm --filter @weave-ai/agent test` green, including the existing `mcp/http.test.ts` updated for the interface.
- [x] 1.2 Add `packages/agent/src/mcp/stdio.ts`: spawn `command`/`args` with `env`, newline-delimited JSON-RPC on stdio, `initialize`/`tools/list` (30 s) and `tools/call` (60 s) with an abort that sends `notifications/cancelled`, stderr forwarded as a log callback, and `close()` sending SIGTERM then SIGKILL after a grace. Verify: a fake stdio server script in the tests exercises a list and a call, a server that ignores SIGTERM is reaped by `close()`, and an abort mid-call kills the child.
- [x] 1.3 Route the loop's MCP setup through a factory: `createMcpClient` picks stdio for `type: 'stdio'` and HTTP otherwise, the loop keeps a client list and closes every entry in a `finally`. Verify: a loop test with a fake stdio server records `tool.call`/`tool.result` through the stdio client and the child is gone after the turn.
- [x] 1.4 Carry stdio fields on the child init: `InitMessage.mcpServers` gains `type`, `command`, `args`, `env`; `packages/runtimes/weave/src/child.ts` maps both `McpServerConfig` shapes and logs an entry with neither `url` nor `command`. Verify: `pnpm --filter @weave-ai/runtime-weave test` green with a new adapter test asserting a stdio entry reaches the child init.

## 2. MCP tool naming

- [x] 2.1 Add `packages/agent/src/mcp/naming.ts` (`sanitizeSegment`, `assignMcpToolNames`) assigning `mcp__<server>__<tool>` within 64 characters from one namespace seeded with the Weave server's unprefixed names, suffixing collisions. Use it in the loop's MCP registry so the wire name maps back to `(server, tool)`. Verify: tests cover two servers colliding, a Weave tool name untouched, and a long/unsanitised name sanitised and truncated to 64 characters.

## 3. MCP result cap and images

- [x] 3.1 Apply the 50 KB cap to both transports and lift an image content part from an MCP result into the turn's image handling; a non-text, non-image part is recorded as omitted. Verify: a loop test with an MCP tool returning > 50 KB yields the capped text and its marker, and one with an image part carries the image rather than text.

## 4. SSRF policy and fetch

- [x] 4.1 Add `packages/agent/src/net/ssrf.ts` with `isBlockedAddress(ip, family)` covering IPv4 loopback/private/link-local/CGNAT/unspecified/broadcast/metadata and IPv6 loopback/unique-local/link-local/unspecified/IPv4-mapped, and `resolveHost(host, resolve)` refusing a blocked or empty answer. Verify: a table test classifies each address by range, including `::ffff:127.0.0.1`.
- [x] 4.2 Add `fetchWithPolicy(url, { resolve, request, signal })` to `net/ssrf.ts`: http(s) only, resolve once and connect to the resolved address (`lookup` pinned, Host preserved), a 5 MB read cap, at most 5 redirects each re-resolved and re-checked, and refusals naming the reason. Verify: fake-request tests cover the happy path, a redirect to a private target, a resolver that answers public then private (only the checked address is connected), and an unsupported scheme.

## 5. `web_fetch`

- [x] 5.1 Add `packages/agent/src/tools/webFetch.ts` with the `url`/`max_bytes` schema, the status line and text reduction (HTML tag-strip and entity decode), the 5 MB/30 s/50 KB bounds and the binary refusal. Verify: temp/fake-server tests return a public page's text, cap an over-long body and refuse a binary type.
- [x] 5.2 Register `web_fetch` as a core tool: added to the core-name registry so `restricted` removes it (forced call returns the permission denial with `tool.denied`), present in `auto`/`bypass` only when `run.options.webFetch === true`, and a call while disabled returns an error naming the option with no request sent. Add `webFetch` to the adapter's `configSchema`. Verify: a loop test asserts the `restricted` request body has no `web_fetch`, the `auto`+enabled body has it, and the disabled call makes no network request; an adapter test asserts `configSchema` carries `webFetch`.

## 6. Images

- [x] 6.1 Add `image.input` to `ProviderCompatSchema` in `packages/shared/src/config.ts` and to `Compat`/`DEFAULT_COMPAT` in `packages/agent/src/codec/params.ts` (default `user`); encode `image` content blocks in `toWireMessages` (user content as an array, tool content as an array only for `user_and_tool`). Verify: codec tests assert the recorded body carries an `image_url` data part in a user message for `user`, inside the `tool` message for `user_and_tool`, and no part for `none`.
- [x] 6.2 Add the `image` content block to `packages/agent/src/types.ts`, add `images` to `ToolOutput`, add `packages/agent/src/tools/image.ts` (magic-byte detection for png/jpg/gif/webp, ≤ 5 MB, data-part builder), detect images in `read.ts` before the binary check, and make the loop lift images per the mode (synthetic user message for `user`, tool-message content for `user_and_tool`, `Error: this model cannot read images` for `none`). Verify: tests cover a png and a jpeg under each of the three modes, asserting the image part is present or absent and in the right message, and that a > 5 MB image keeps its refusal.
- [x] 6.3 Confirm the session round-trips an image block (append, reload, resend) and that `packages/agent/src/index.ts` exports anything new a caller needs. Verify: a session test loads a persisted image message and the loop's next request re-encodes it.

## 7. Docs and final verification

- [x] 7.1 Update `builtin-agent-runtime-details` (section 8 MCP naming/transports and section 5 web policy/images) and `builtin-agent-slices` (S8 section and its Decisions) where this slice's implementation differs, including that non-Weave MCP server config sourcing is still absent. Verify: the knowledge documents read accurately against the merged code.
- [x] 7.2 Run `pnpm lint` and `pnpm typecheck`, then one full `pnpm test --maxWorkers=4` at the end and paste both suite blocks verbatim on the ticket and in the PR. Verify: both suites green and no untracked files in `work/` (`git status --porcelain` empty).
