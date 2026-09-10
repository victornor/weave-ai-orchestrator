import type { CoreServices, WorkspaceContext, AuthService, Actor, Registries, IncidentsService } from '@agent-conductor/core';
import type { DaemonConfig } from '@agent-conductor/shared';
import type { RunTokenClaims } from './runtoken.js';
import type { UpdateChecker } from './release-info.js';
import type { UpgradeService } from './upgrade.js';
import type { ChannelManager } from './channels.js';
import type { WebhookDispatcher } from './webhooks.js';
import type { VoxtypeProbe } from './voxtype.js';

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
  /** Is the configured release source ahead of the release this process runs from (PLAN §20)? */
  updates: UpdateChecker;
  /** The deferred upgrade: request one, watch it, cancel it (PLAN §20). */
  upgrades: UpgradeService;
  /** Daemon-level system incidents agents file through `ac_incident` (VS-174). */
  incidents: IncidentsService;
  /** Directory holding daemon.yaml; PUT /api/daemon/transcription writes here. */
  daemonConfigDir?: string;
  /** Voxtype probe/transcribe. Tests inject a fake; production uses PATH `voxtype`. */
  voxtype?: VoxtypeProbe;
  /** Directory holding the built web UI (packages/ui/dist). */
  uiDir?: string | null;
  /** Called on daemon shutdown / used by tests to freeze time. */
  now?: () => Date;
  /** Set by the daemon when the public listener is held for lack of an operator; `POST /api/auth/setup` calls it. */
  onOperatorConfigured?: () => void;
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
