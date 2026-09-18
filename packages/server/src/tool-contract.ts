/**
 * VS-542: a runtime session holds the tool definitions it was started with, so an upgrade that
 * changes a tool's parameters cannot reach the agent by resuming. The daemon fingerprints the MCP
 * tool list each agent kind exposes; the engine records that fingerprint on the session and retires
 * the session when it changes. The hash is over names, descriptions and input schemas so a
 * parameter change always moves it, and is order-insensitive so registration order never does.
 */
import { createHash } from 'node:crypto';
import type { AgentKind } from '@weave-ai/shared';
import { toolListFor, type ToolListEntry } from './tools.js';
import type { WorkspaceRuntime } from './types.js';

/** A stable fingerprint of one tool surface. Pure: the same definitions in any order hash equally. */
export function contractHash(defs: readonly ToolListEntry[]): string {
  const canonical = defs
    .map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** The fingerprint of the tool list this workspace serves an agent kind. */
export function toolContractHash(kind: AgentKind, ws: WorkspaceRuntime): string {
  return contractHash(toolListFor(kind, ws));
}

/**
 * A per-workspace provider, memoized per kind. The surface is fixed once the workspace's plugins
 * have loaded, so it is computed once per daemon lifetime and only moves across an upgrade.
 */
export function toolContractProvider(ws: WorkspaceRuntime): (kind: AgentKind) => string {
  const cache = new Map<AgentKind, string>();
  return (kind) => {
    let hash = cache.get(kind);
    if (hash === undefined) {
      hash = toolContractHash(kind, ws);
      cache.set(kind, hash);
    }
    return hash;
  };
}
