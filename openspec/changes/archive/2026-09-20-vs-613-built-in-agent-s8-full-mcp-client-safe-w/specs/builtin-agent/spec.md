## ADDED Requirements

### Requirement: MCP clients share one interface and a stdio transport exists

The child SHALL speak MCP through one client interface with `initialize`, `listTools`, `callTool` and `close`, implemented by the existing streamable-HTTP client and by a new stdio client. The stdio client SHALL spawn the configured server's `command` and `args` with its `env`, exchange newline-delimited JSON-RPC over its stdio, forward its stderr as child `log` lines, apply a 30 s timeout to `initialize`/`tools/list` and a 60 s timeout to `tools/call`, send `notifications/cancelled` and kill the child on abort, and reap the child when the turn ends or the client closes. A server config SHALL be routed to the stdio client by `type: 'stdio'` and to the HTTP client otherwise.

#### Scenario: A stdio server works against a fake server script
- **WHEN** a fake stdio server script advertises one tool and answers a call with text
- **THEN** `listTools` returns that tool and `callTool` returns its text, and no HTTP request is made

#### Scenario: A stdio server that ignores SIGTERM is reaped
- **WHEN** `close()` is called on a stdio client whose child traps SIGTERM
- **THEN** the child is killed and no longer running after the grace period

#### Scenario: The child init carries a stdio server
- **WHEN** a turn's `mcpServers` contains a `type: 'stdio'` entry with `command` and `args`
- **THEN** the child's `init` line carries that entry's command, args and env, and the HTTP entry shape is unchanged

### Requirement: Non-Weave MCP tools are named with collisions suffixed

A tool from a server other than the run-scoped Weave server SHALL be exposed as `mcp__<server>__<tool>`, with each segment reduced to `[A-Za-z0-9_-]` and the whole name kept within 64 characters. The run-scoped Weave server's tools SHALL keep their own names, unprefixed. Names SHALL be assigned from one namespace across all servers, so a collision with a Weave tool name or with another server's tool is given a suffix (`_2`, `_3`, …) rather than overwriting it, and the model's wire name SHALL map back to the original `(server, tool)` for the call.

#### Scenario: Two servers produce the same wire name
- **WHEN** two different servers yield the same sanitised `mcp__a__b` name
- **THEN** one keeps `mcp__a__b` and the other is exposed with a numeric suffix, and each call reaches its own server

#### Scenario: Weave tools stay unprefixed
- **WHEN** the Weave server and another server both load
- **THEN** the Weave server's tools are offered under their own names (e.g. `weave_ticket_get`) and the other server's tools are prefixed

#### Scenario: A long or unsanitised name
- **WHEN** a server or tool name contains characters outside `[A-Za-z0-9_-]` or the assembled name exceeds 64 characters
- **THEN** the exposed name is sanitised and truncated to 64 characters and still maps to its server and tool

### Requirement: MCP results are capped and their image parts are lifted

A tool result's text parts SHALL be concatenated and, when the combined text exceeds 50 KB, truncated to 50 KB with a marker stating the cap. An image content part SHALL be returned as an image part and lifted into the request like an image read from a file; a part that is neither text nor image SHALL be recorded as omitted.

#### Scenario: Result over the cap
- **WHEN** an MCP tool returns more than 50 KB of text
- **THEN** the result is the first 50 KB followed by a marker naming the cap

#### Scenario: Image part in a result
- **WHEN** an MCP tool returns an image content part
- **THEN** the turn carries it as an image part in the request rather than as text

### Requirement: `web_fetch` fetches public http(s) and returns text

The `web_fetch` tool SHALL accept `url` and an optional `max_bytes`, allow only `http` and `https`, follow at most 5 redirects, read at most 5 MB, time out after 30 s, and return a status line followed by the body reduced to text (HTML reduced by stripping tags and decoding entities, other textual media types returned as they are), capped at 50 KB with a marker. A binary media type SHALL be refused. A refusal SHALL be an ordinary error result beginning `Error:`.

#### Scenario: A public page
- **WHEN** `web_fetch` targets a public http(s) URL whose body fits the cap
- **THEN** the result begins with the status line and contains the page's text

#### Scenario: Body over the read cap
- **WHEN** the target sends more than `max_bytes`
- **THEN** the tool returns the text it read and does not read further

### Requirement: `web_fetch` refuses non-public targets, including via redirect and DNS rebinding

`web_fetch` SHALL classify the resolved addresses of the target host and refuse a loopback, private, link-local, CGNAT or cloud-metadata address (IPv4 and IPv6, including IPv4-mapped), and SHALL refuse a host that resolves to an empty answer. It SHALL resolve the host **once** and connect to the address it resolved, so a resolver that answers differently on a second lookup cannot redirect the connection. Every redirect hop SHALL be re-resolved and re-checked under the same rule, and a scheme other than `http`/`https` SHALL be refused. The refusal SHALL name the reason (`loopback`, `private`, `link-local`, `metadata`, `redirect limit`, `unsupported scheme`).

#### Scenario: Direct private target
- **WHEN** `web_fetch` targets `127.0.0.1`, `10.0.0.1`, `192.168.1.1`, `169.254.169.254`, `100.64.0.1`, `[::1]` or `[fd00::1]`
- **THEN** each is refused with the range named and no request is sent

#### Scenario: Redirect to a private target
- **WHEN** a public target answers a redirect whose `Location` is a private address
- **THEN** the redirect hop is refused and its body is not fetched

#### Scenario: DNS rebinding
- **WHEN** the resolver answers with a public address for the check and a private address on any later lookup
- **THEN** the connection uses the address that passed the check and the private address is never connected to

#### Scenario: IPv4-mapped IPv6
- **WHEN** the resolver answers with `::ffff:127.0.0.1`
- **THEN** it is refused as loopback

### Requirement: `web_fetch` is denied in `restricted` and off by default

`web_fetch` SHALL be removed from the request's tool list in `restricted` and a call SHALL return `Denied by permission mode "restricted"` with a `tool.denied` event. In `auto` and `bypass` it SHALL be offered only when the turn's `webFetch` option is true; a call while it is disabled SHALL return an error naming the option, and no request SHALL be sent.

#### Scenario: Restricted request body
- **WHEN** a `restricted` turn runs with `webFetch` true
- **THEN** the recorded request body's tool list contains no `web_fetch`

#### Scenario: Disabled by default
- **WHEN** a turn runs in `auto` without the `webFetch` option and the model calls `web_fetch`
- **THEN** the result is an error naming the option and no network request is made

### Requirement: `read` returns an image part under the profile's `image.input` mode

The `read` tool SHALL detect a PNG, JPEG, GIF or WebP by its magic bytes before the binary-file check, and for a supported image up to 5 MB SHALL return an image content part plus a short text result. The request SHALL carry that image according to the provider compat flag `image.input`: `user` (the default) lifts the image into a synthetic user message after the tool result, `user_and_tool` places the image part inside the tool message's content, and `none` returns `Error: this model cannot read images` with no image part. An image over the size cap or of an unsupported type SHALL keep the existing too-large or binary refusal.

#### Scenario: Default lift to a user message
- **WHEN** `read` targets a png under `image.input:user`
- **THEN** the recorded request carries the image as an `image_url` data part in a user message and the tool result as text

#### Scenario: Image inside the tool message
- **WHEN** `read` targets a png under `image.input:user_and_tool`
- **THEN** the recorded request carries the image part inside the `tool` message's content and no extra user message

#### Scenario: Images unsupported
- **WHEN** `read` targets a png under `image.input:none`
- **THEN** the result is `Error: this model cannot read images` and the request carries no image

#### Scenario: A JPEG is detected as an image
- **WHEN** `read` targets a file beginning `FF D8 FF` under `image.input:user`
- **THEN** it returns an image part rather than the binary-file error
