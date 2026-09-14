/**
 * The per-workspace plugin registry (VS-334, PLAN §17). Unlike `Registries` (runtimes, channels,
 * surfaces, forges, worktree providers — process-wide, opt-in by reference from a workspace's own
 * config), an agent tool, an HTTP route, and a hook a plugin registers are *directly* reachable once
 * registered, with no such opt-in step. Each workspace therefore gets its own `PluginRegistry`,
 * built fresh by `loadPlugins` before that workspace's plugins load, so a tool/route/hook a plugin
 * registers while loading for one workspace can never reach another.
 */
import type { EventType, WorkspaceEvent } from '@weave-ai/shared';
import type { AgentToolDefinition, PluginHttpMethod, PluginRouteHandler } from '@weave-ai/plugin-sdk';

export interface PluginRouteDef {
  pluginId: string;
  method: PluginHttpMethod;
  path: string;
  handler: PluginRouteHandler;
}
export interface PluginHookDef {
  pluginId: string;
  events: EventType[] | '*';
  handler(ev: WorkspaceEvent): Promise<void>;
}
/** One plugin's load outcome for this workspace, for Settings (VS-334). Set once, at load; never mutated after. */
export interface PluginRuntime {
  id: string;
  version: string | null;
  /** The plugin's own declared display name (VS-385), used as a page title/rail label ahead of `id`. */
  name: string | null;
  source: 'workspace' | 'daemon';
  loaded: boolean;
  error: string | null;
  hasPage: boolean;
}
export function createPluginRegistry(): PluginRegistry {
  return { tools: [], routes: [], hooks: [], loaded: [] };
}
export interface PluginRegistry {
  tools: AgentToolDefinition[];
  routes: PluginRouteDef[];
  hooks: PluginHookDef[];
  loaded: PluginRuntime[];
}

export const PLUGIN_TOOL_NAME_RE = /^[a-z][a-z0-9-]*_[a-z0-9_]+$/;
export const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*$/;

/** Whether `name` is namespaced to `pluginId` (`<pluginId>_<rest>`) and is otherwise a valid tool name. */
export function isNamespacedToolName(name: string, pluginId: string): boolean {
  return name.startsWith(`${pluginId}_`) && PLUGIN_TOOL_NAME_RE.test(name);
}
