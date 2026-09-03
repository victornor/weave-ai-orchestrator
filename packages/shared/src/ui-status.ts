import type { AgentStatus, TicketStatus, UiStatus, DecisionStatus } from './enums.js';

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
