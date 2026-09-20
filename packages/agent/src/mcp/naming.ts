/**
 * Wire names for MCP tools. The run-scoped Weave server's tools keep their own names (the skills
 * and every prompt call them `weave_*`); every other server's tools are namespaced
 * `mcp__<server>__<tool>`. All names are drawn from one set, so a collision — with a Weave name or
 * between two servers — is suffixed rather than silently overwriting.
 */
export const MAX_TOOL_NAME = 64;

/** A name segment reduced to the characters a tool name may carry. */
export function sanitizeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '_') || 'x';
}

export interface McpToolNameInput { server: string; tool: string }

/**
 * Assign every `(server, tool)` its wire name, mutating `taken`. `weaveServer` names are returned
 * verbatim and inserted first by the caller, so nothing can shadow them.
 */
export function assignMcpToolNames(servers: Array<{ server: string; tools: string[] }>, taken: Set<string>, weaveServer: string): Map<string, McpToolNameInput> {
  const out = new Map<string, McpToolNameInput>();
  for (const { server, tools } of servers) {
    for (const tool of tools) {
      const wire = server === weaveServer ? tool : uniqueName(`mcp__${sanitizeSegment(server)}__${sanitizeSegment(tool)}`, taken);
      taken.add(wire);
      out.set(wire, { server, tool });
    }
  }
  return out;
}

function uniqueName(base: string, taken: Set<string>): string {
  const cut = base.length > MAX_TOOL_NAME ? base.slice(0, MAX_TOOL_NAME) : base;
  if (!taken.has(cut)) return cut;
  for (let n = 2; ; n++) {
    const tail = `_${n}`;
    const name = `${cut.slice(0, MAX_TOOL_NAME - tail.length)}${tail}`;
    if (!taken.has(name)) return name;
  }
}
