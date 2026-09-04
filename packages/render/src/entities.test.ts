import { describe, expect, it } from 'vitest';
import type { Agent, Ticket } from '@agent-conductor/shared';
import { ticketToSummary, workerToCard } from './entities.js';

const now = new Date('2026-09-04T12:00:00.000Z');

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 'tkt_1', workspaceId: 'ws', projectId: 'web', number: 42, identifier: 'ACME-42', kind: 'change',
    title: 'Theme tokens', description: '', status: 'in_progress', priority: 'high', autoMerge: false,
    assigneeRoleId: 'role_1', workerId: 'ag_1', assigneeHuman: false, parentId: null, createdByKind: 'human',
    createdById: null, originKind: null, originFingerprint: null, checkoutRunId: null, executionRunId: null,
    openspecChangeName: null, openspecState: null, delivery: null, unblock: null, monitorNextCheckAt: null,
    blockedTransitionAt: null, startedAt: null, completedAt: null, cancelledAt: null,
    createdAt: '2026-09-04T11:56:00.000Z', updatedAt: '2026-09-04T11:56:00.000Z', ...over,
  };
}

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'ag_1', workspaceId: 'ws', kind: 'worker', projectId: 'web', roleId: 'role_1', roleRevision: 1,
    ticketId: 'tkt_1', name: 'Backend Engineer #7', runtimeId: 'claude', model: 'claude-fable-5-1', effort: null,
    status: 'running', pauseReason: null, errorText: null, homePath: '/ws/workers/ag_1', worktreePath: '/ws/workers/ag_1/work',
    branch: 'ac/acme-42', turnEpoch: 1, turnCount: 7, spawnedBy: 'conductor', spawnReason: null, briefRevision: 1,
    lastRunAt: null, retiredAt: null, createdAt: '2026-09-04T11:00:00.000Z', updatedAt: '2026-09-04T11:00:00.000Z', ...over,
  };
}

describe('ticketToSummary', () => {
  it('builds the ticket card meta line', () => {
    const s = ticketToSummary(ticket(), { projectName: 'web', workerName: 'Backend Engineer #7', usage: { tokens: 18_400, costCents: 41, costStatus: 'estimated' }, now });
    expect(s.uiStatus).toBe('working');
    expect(s.glyph).toBe('▲');
    expect(s.meta).toBe('ACME-42 · 18.4k tok · $0.41 est');
    expect(s.age).toBe('4m');
    expect(s.line).toBe('▲ ACME-42 · Theme tokens · CHANGE · Backend Engineer #7 · 4m');
  });

  it('overrides status with needs-you when a human decision is open', () => {
    const s = ticketToSummary(ticket(), { hasOpenHumanDecision: true, now });
    expect(s.uiStatus).toBe('needs-you');
    expect(s.glyph).toBe('◆');
  });

  it('maps stalled workers and blocked tickets', () => {
    expect(ticketToSummary(ticket(), { workerStalled: true, now }).uiStatus).toBe('stalled');
    expect(ticketToSummary(ticket({ status: 'blocked' }), { now }).uiStatus).toBe('blocked');
    expect(ticketToSummary(ticket({ status: 'merging' }), { now }).uiStatus).toBe('merging');
    expect(ticketToSummary(ticket({ status: 'in_review' }), { now }).uiStatus).toBe('needs-you');
  });

  it('omits usage when it is unknown and redacts the title', () => {
    const s = ticketToSummary(ticket({ title: 'rotate rt_abcdefghijklmnop' }), { now });
    expect(s.tokens).toBeNull();
    expect(s.cost).toBeNull();
    expect(s.meta).toBe('ACME-42');
    expect(s.title).toBe('rotate rt_[redacted]');
  });
});

describe('workerToCard', () => {
  it('builds the worker card and its window title', () => {
    const c = workerToCard(agent(), {
      roleName: 'Backend Engineer', projectName: 'api',
      ticket: { id: 'tkt_1', identifier: 'ACME-42', title: 'Theme tokens' },
      lastLine: 'running vitest — 38/41 passed',
      worktree: { status: 'dirty', dirty: true, ahead: 3, behind: 0 },
      usage: { tokens: 18_400, costCents: 41, costStatus: 'reported' }, now,
    });
    expect(c.initials).toBe('BE');
    expect(c.uiStatus).toBe('working');
    expect(c.statusLabel).toBe('working');
    expect(c.worktree!.label).toBe('● dirty ↑3 ↓0');
    expect(c.lastLine).toBe('running vitest — 38/41 passed');
    expect(c.windowTitle).toBe('Backend Engineer #7 · ACME-42 · working');
    expect(c.meta).toContain('18.4k tok');
  });

  it('honours needs-you and paused states', () => {
    expect(workerToCard(agent(), { needsYou: true }).uiStatus).toBe('needs-you');
    expect(workerToCard(agent({ status: 'paused' }), {}).uiStatus).toBe('paused');
    expect(workerToCard(agent({ status: 'error' }), {}).uiStatus).toBe('failed');
    expect(workerToCard(agent({ status: 'running' }), { stalled: true }).uiStatus).toBe('stalled');
  });

  it('falls back to the ticket id when no ticket is joined', () => {
    const c = workerToCard(agent(), {});
    expect(c.ticket).toEqual({ id: 'tkt_1', identifier: 'tkt_1', title: '' });
  });

  it('degrades without a ticket, worktree or usage', () => {
    const c = workerToCard(agent({ kind: 'conductor', name: 'Conductor', ticketId: null, worktreePath: null }), {});
    expect(c.kind).toBe('conductor');
    expect(c.ticket).toBeNull();
    expect(c.worktree).toBeNull();
    expect(c.tokens).toBeNull();
    expect(c.windowTitle).toBe('Conductor · working');
  });

  it('never crashes on an empty agent', () => {
    const c = workerToCard({} as Agent, {});
    expect(c.name).toBe('Worker');
    expect(c.runtime).toBe('unknown');
    expect(c.turn).toBe(0);
  });
});
