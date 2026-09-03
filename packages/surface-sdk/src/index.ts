export type JsonSchema = Record<string, unknown>;
export interface AgentView { agentId: string; workspaceId: string; name: string; kind: 'conductor' | 'worker'; projectId: string | null; ticketIdentifier: string | null; roleName: string | null; status: string; uiStatus: string }
export interface AgentPresence { status: string; uiStatus: string; title: string }
export type SurfaceHandle = Record<string, unknown> & { kind: string };
export interface SurfaceContext { workspaceId: string; daemonUrl: string; attachCommand(agentId: string): string[]; chatCommand(): string[]; terminal(): { cmd: string; classFlag: string; execFlag: string } | null; log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>): void }
export interface SurfaceAdapter {
  readonly kind: string;
  detect(): Promise<{ available: boolean; notes?: string }>;
  configSchema(): JsonSchema;
  ensureAgentView(agent: AgentView, cfg: Record<string, unknown>, ctx: SurfaceContext, existing?: SurfaceHandle): Promise<SurfaceHandle>;
  updateAgentView(handle: SurfaceHandle, state: AgentPresence, ctx: SurfaceContext): Promise<void>;
  focusAgentView(handle: SurfaceHandle, ctx: SurfaceContext): Promise<void>;
  closeAgentView(handle: SurfaceHandle, reason: 'retired' | 'presentation_changed', ctx: SurfaceContext): Promise<void>;
  ensureConductorView?(cfg: Record<string, unknown>, ctx: SurfaceContext): Promise<SurfaceHandle>;
  layout?(handles: SurfaceHandle[], cfg: Record<string, unknown>, ctx: SurfaceContext): Promise<void>;
  verify?(handle: SurfaceHandle, ctx: SurfaceContext): Promise<boolean>;
}
