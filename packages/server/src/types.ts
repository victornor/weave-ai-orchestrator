import type { CoreServices, WorkspaceContext, AuthService, Actor, Registries } from '@openconductor/core';
import type { DaemonConfig } from '@openconductor/shared';
import type { RunTokenClaims } from './runtoken.js';
import type { ChannelManager } from './channels.js';
import type { WebhookDispatcher } from './webhooks.js';

/** One loaded workspace: its context (db, config, events) plus the assembled core services. */
export interface WorkspaceRuntime {
  id: string;
  ctx: WorkspaceContext;
  services: CoreServices;
  channels: ChannelManager | null;
  webhooks: WebhookDispatcher | null;
}

/** Which listener a request arrived on. Run tokens are only honoured on `loopback`. */
export type ListenerKind = 'public' | 'loopback';

export interface AppDeps {
  auth: AuthService;
  daemon: DaemonConfig;
  workspaces: Map<string, WorkspaceRuntime>;
  registries: Registries;
  /** Which listener this app instance is mounted on. */
  listener: ListenerKind;
  /** Absolute base URL of the public listener; used for CSRF origin checks. */
  publicUrl: string;
  version: string;
  /** Directory holding the built web UI (packages/ui/dist). */
  uiDir?: string | null;
  /** Called on daemon shutdown / used by tests to freeze time. */
  now?: () => Date;
}

export type Principal =
  | { kind: 'operator'; operatorId: string; sessionId: string; sessionKind: string; viaCookie: boolean }
  | { kind: 'loopback' }
  | { kind: 'run'; claims: RunTokenClaims };

export interface Vars {
  principal: Principal;
  actor: Actor;
  ws: WorkspaceRuntime;
}
export type AppEnv = { Variables: Vars };

export function actorFor(p: Principal): Actor {
  if (p.kind === 'run') return { kind: 'agent', id: p.claims.agentId, runId: p.claims.runId };
  if (p.kind === 'operator') return { kind: 'human', id: p.operatorId };
  return { kind: 'human', id: 'local' };
}
