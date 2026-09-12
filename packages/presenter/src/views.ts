import { agentUiStatus, type AgentStatus } from '@agent-conductor/shared';
import type { AgentView } from '@agent-conductor/surface-sdk';

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * Normalize whatever the daemon put on the wire (an AgentView, an Agent row, or an
 * event payload) into the AgentView surfaces consume. Returns null when there is no id.
 */
export function toAgentView(input: unknown, workspaceId: string): AgentView | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const nested = (raw.worker ?? raw.agent) as Record<string, unknown> | undefined;
  const src = nested && typeof nested === 'object' ? { ...nested, ...raw } : raw;

  const agentId = str(src.agentId) ?? str(src.id) ?? str(src.workerId);
  if (!agentId) return null;

  const status = str(src.status) ?? 'active';
  const ticket = src.ticket as Record<string, unknown> | undefined;
  const role = src.role as Record<string, unknown> | undefined;

  return {
    agentId,
    workspaceId: str(src.workspaceId) ?? workspaceId,
    name: str(src.name) ?? agentId,
    kind: (str(src.kind) === 'weaver' ? 'weaver' : 'worker') as AgentView['kind'],
    projectId: str(src.projectId) ?? str(src.project) ?? null,
    ticketIdentifier: str(src.ticketIdentifier) ?? (ticket ? str(ticket.identifier) : null),
    roleName: str(src.roleName) ?? (role ? str(role.name) : null),
    status,
    uiStatus: str(src.uiStatus) ?? agentUiStatus(status as AgentStatus),
  };
}

/** Agents that should have a live view. */
export const isLiveStatus = (status: string): boolean => status !== 'retired' && status !== 'done';

export function agentIdOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const nested = (raw.worker ?? raw.agent) as Record<string, unknown> | undefined;
  return str(raw.agentId) ?? str(raw.id) ?? str(raw.workerId) ?? (nested ? str(nested.id) ?? str(nested.agentId) : null);
}
