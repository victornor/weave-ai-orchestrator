import type { WorkspaceEvent } from '@weave-ai/shared';
import type { AgentView, SurfaceHandle } from '@weave-ai/surface-sdk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFn = (level: LogLevel, msg: string, data?: Record<string, unknown>) => void;

export interface PresentationBlockView {
  surface?: string;
  workspace?: string | number;
  layout?: 'grid' | 'per-project';
  terminal?: string;
  session?: string;
  tabPerProject?: boolean;
  [key: string]: unknown;
}

export interface PresentationConfigView {
  default?: string;
  weaver?: PresentationBlockView;
  workers?: PresentationBlockView;
  [key: string]: unknown;
}

/** `GET /api/w/:ws/presenter/desired` */
export interface DesiredPresentation {
  weaver: AgentView | null;
  workers: AgentView[];
  config: PresentationConfigView;
}

export interface StoredHandle {
  agentId: string;
  surfaceKind: string;
  handle: SurfaceHandle;
  /** Kept so a handle that failed verification can be recreated on presenter start. */
  view?: AgentView;
  kindOfAgent?: 'weaver' | 'worker';
}

export interface EventSubscription { close(): void }

export interface PresenterApi {
  getDesired(): Promise<DesiredPresentation>;
  putHandles(presenterId: string, handles: StoredHandle[]): Promise<void>;
  subscribe(handlers: { onEvent(ev: WorkspaceEvent): void; onError?(err: unknown): void }): EventSubscription;
}

export interface HandleStore {
  load(): Promise<StoredHandle[]>;
  save(handles: StoredHandle[]): Promise<void>;
}
