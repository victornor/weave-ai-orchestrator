import type { AgentStatus, TicketStatus, UiStatus, DecisionStatus } from './enums.js';

/**
 * VS-656: the human sentence for why a persistent session was retired, shown where a new session
 * begins. A known reason names its cause; an unknown or absent one still says the conversation
 * restarted, because the boundary matters even when its cause is not on record.
 */
export function sessionRetirementLabel(reason: string | null | undefined): string {
  switch (reason) {
    case 'tool_contract': return "the agent's tools changed at an upgrade";
    case 'idle': return 'the conversation had been idle for a long time';
    case 'runtime': return "the session's runtime changed";
    case 'reset': return 'the session was reset';
    default: return 'the conversation restarted here';
  }
}

/** Map domain states onto the nine UI status tokens (design contract §2). */
export function ticketUiStatus(status: TicketStatus, opts: { hasOpenHumanDecision?: boolean; workerStalled?: boolean } = {}): UiStatus {
  if (opts.hasOpenHumanDecision) return 'needs-you';
  if (opts.workerStalled) return 'stalled';
  switch (status) {
    case 'backlog': case 'todo': return 'idle';
    case 'proposing': case 'in_progress': return 'working';
    case 'proposed': case 'in_review': return 'needs-you';
    case 'approved': return 'idle';
    case 'merging': return 'merging';
    case 'blocked': return 'blocked';
    case 'done': return 'done';
    case 'cancelled': return 'failed';
  }
}
export function agentUiStatus(status: AgentStatus, opts: { stalled?: boolean; needsYou?: boolean } = {}): UiStatus {
  if (opts.needsYou) return 'needs-you';
  if (opts.stalled) return 'stalled';
  switch (status) {
    case 'provisioning': case 'active': return 'idle';
    case 'running': return 'working';
    case 'paused': return 'paused';
    case 'error': return 'failed';
    case 'done': case 'retired': return 'done';
  }
}
export function decisionUiStatus(status: DecisionStatus): UiStatus {
  return status === 'open' ? 'needs-you' : status === 'answered' ? 'done' : 'idle';
}
