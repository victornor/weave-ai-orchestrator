## Why

Codex worker turns receive the ticket-scoped Weave MCP endpoint, but the adapter maps their
ordinary `auto` permission to a workspace-write sandbox without Codex's auto approval policy.
Codex consequently rejects MCP calls as requiring approval while its policy is `never`; the
weaver works only because its engine-level `bypass` mode takes a separate Codex bypass path.
This prevents workers from working tickets and even from filing the incident that would expose the
failure.

## What Changes

- Map Codex's existing `auto` permission mode to its sandboxed automatic-approval invocation, so
  a configured, ticket-scoped MCP server can be discovered and called without widening filesystem
  access to bypass mode.
- Keep `restricted` and `bypass` mappings distinct, and preserve the engine's existing role and
  workspace permission resolution.
- Add deterministic fake-CLI coverage for new, resumed, and weaver-equivalent invocations that
  asserts the complete configured MCP server is callable and that its structured success and error
  events remain visible in the run stream.
- Surface malformed or unsupported Codex MCP events as explicit runtime evidence rather than
  silently treating the turn as having no MCP capability.
- Record the root cause and the incident-reporting gap on the ticket: the blocked worker could not
  invoke the incident tool, so no incident existed until an approved bypass permitted filing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-permissions/conductor-bypass`: Codex's adapter-level interpretation of a worker's retained
  `auto` mode must permit its daemon-provisioned MCP control-plane server while retaining the
  workspace-write sandbox; it must not require every worker role to use bypass.

## Impact

- `packages/runtimes/codex/src/args.ts`, its adapter/event handling, and Codex adapter fixtures
  and tests.
- The runtime SDK test boundary receives additional Codex invocation/event regression coverage.
- No shared MCP server, model-provider, worker-tier, or other runtime adapter contract changes.
