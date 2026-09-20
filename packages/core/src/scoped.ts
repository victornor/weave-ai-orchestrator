/**
 * VS-633: what a workspace sees of the daemon-level providers and MCP servers, and the secret
 * lookup that goes with them. `ctx.daemon` is the live daemon config object, so an edit made in the
 * daemon settings is seen by the next run with no reload.
 */
import { mergedValues, mergeScoped, type McpServer, type ProviderProfile, type ScopedEntry } from '@weave-ai/shared';
import type { WorkspaceContext } from './context.js';
import { daemonSecretStore, resolveScopedSecret } from './secrets/daemon.js';

type ScopeCtx = Pick<WorkspaceContext, 'config' | 'daemon' | 'daemonConfigDir'>;

export function scopedProviders(ctx: ScopeCtx): Record<string, ScopedEntry<ProviderProfile>> {
  return mergeScoped({ daemon: ctx.daemon?.providers, workspace: ctx.config.providers, disabled: ctx.config.disabledProviders });
}

export function scopedMcpServers(ctx: ScopeCtx): Record<string, ScopedEntry<McpServer>> {
  return mergeScoped({ daemon: ctx.daemon?.mcpServers, workspace: ctx.config.mcpServers, disabled: ctx.config.disabledMcpServers });
}

export function effectiveProviders(ctx: ScopeCtx): Record<string, ProviderProfile> {
  return mergedValues({ daemon: ctx.daemon?.providers, workspace: ctx.config.providers, disabled: ctx.config.disabledProviders });
}

export function effectiveMcpServers(ctx: ScopeCtx): Record<string, McpServer> {
  return mergedValues({ daemon: ctx.daemon?.mcpServers, workspace: ctx.config.mcpServers, disabled: ctx.config.disabledMcpServers });
}

/** A secret by name: this workspace's store, then the daemon's. `workspaceValue` is the workspace store's reader. */
export function scopedSecretValue(ctx: Pick<WorkspaceContext, 'daemonConfigDir'>, workspaceValue: (name: string) => string | null, name: string): string | null {
  return resolveScopedSecret(workspaceValue, daemonSecretStore(ctx.daemonConfigDir), name);
}
