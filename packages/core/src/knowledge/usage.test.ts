import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@agent-conductor/db';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createKnowledgeService } from './service.js';
import { createKnowledgeUsageService } from './usage.js';
import type { Actor, KnowledgeService, KnowledgeUsageService } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };

let h: TestHarness;
let knowledge: KnowledgeService;
let usage: KnowledgeUsageService;
let ticketNumber = 0;

/**
 * Backdates every recorded event so a `window: 'all'` query's `occurred_at < end` (`end` computed
 * fresh at query time) can never race a row whose `occurred_at` was stamped in the same millisecond.
 */
function backdateAll(): void {
  h.db.run("UPDATE knowledge_usage_events SET occurred_at = '2020-01-01T00:00:00.000Z'");
}

function mkTicket(over: Record<string, unknown> = {}): { id: string } {
  const id = newId();
  const ts = nowIso();
  h.db.insert('tickets', {
    id, workspaceId: h.workspaceId, projectId: h.projectId, number: ++ticketNumber, identifier: `TST-${ticketNumber}`, kind: 'task',
    title: `Ticket ${ticketNumber}`, description: '', status: 'todo', priority: 'medium', createdByKind: 'human',
    createdAt: ts, updatedAt: ts, ...over,
  });
  return { id };
}

beforeEach(() => {
  h = makeHarness();
  knowledge = createKnowledgeService(h.ctx, h.deps);
  h.services.knowledge = knowledge;
  usage = createKnowledgeUsageService(h.ctx, h.deps);
  h.services.knowledgeUsage = usage;
});
afterEach(() => h.cleanup());

describe('forRun / forTicket', () => {
  it('reports zero, not null, for a run that touched no knowledge', () => {
    expect(usage.forRun('run-none')).toEqual({ hubTokens: 0, documentTokens: 0, totalTokens: 0, documents: [] });
  });

  it('sums a ticket\'s own runs and its subtree, unioning the documents each touched', () => {
    const parent = mkTicket();
    const child = mkTicket({ parentId: parent.id });
    usage.recordBootstrap('run-a', h.conductorId, parent.id, [{ scope: 'shared', projectId: null, tokens: 40 }]);
    usage.recordRead({ runId: 'run-a', agentId: h.conductorId, ticketId: parent.id, scope: 'project', projectId: h.projectId, slug: 'doc-a', tokens: 10 });
    usage.recordRead({ runId: 'run-b', agentId: h.conductorId, ticketId: child.id, scope: 'project', projectId: h.projectId, slug: 'doc-b', tokens: 25 });

    const res = usage.forTicket(parent.id);
    expect(res.hubTokens).toBe(40);
    expect(res.documentTokens).toBe(35);
    expect(res.totalTokens).toBe(75);
    expect(res.documents.map((d) => d.slug).sort()).toEqual(['doc-a', 'doc-b']);
  });

  it('reads the same knowledge context whether asked by ticket id or identifier', () => {
    const t = mkTicket();
    usage.recordRead({ runId: 'run-a', agentId: h.conductorId, ticketId: t.id, scope: 'project', projectId: h.projectId, slug: 'doc-a', tokens: 5 });
    expect(usage.forTicket(`TST-${ticketNumber}`).totalTokens).toBe(5);
  });
});

describe('summary', () => {
  it('averages total knowledge tokens per run within the queried project and window', () => {
    // A "per project" query filters on the run's own project (the agent's), same convention as
    // usage_events — so the reads must come from a worker in that project, not the conductor.
    const worker = h.addWorker(null);
    usage.recordBootstrap('run-a', worker, null, [{ scope: 'project', projectId: h.projectId, tokens: 30 }]);
    usage.recordRead({ runId: 'run-a', agentId: worker, ticketId: null, scope: 'project', projectId: h.projectId, slug: 'doc-a', tokens: 10 });
    usage.recordRead({ runId: 'run-b', agentId: worker, ticketId: null, scope: 'project', projectId: h.projectId, slug: 'doc-b', tokens: 20 });
    backdateAll();

    const res = usage.summary({ projectId: h.projectId, window: 'all' });
    expect(res.runs).toBe(2);
    expect(res.averageTokensPerRun).toBe(30); // (30 + 10 + 20) / 2 runs
  });

  it('reports zero for a project with no recorded knowledge context', () => {
    expect(usage.summary({ projectId: h.projectId, window: 'all' })).toEqual({ averageTokensPerRun: 0, runs: 0 });
  });
});

describe('topDocuments / neverRead', () => {
  it('ranks a document read by several runs above one read by a single run', () => {
    const worker = h.addWorker(null);
    knowledge.putDoc(HUMAN, 'project', 'popular-doc', '# Popular doc\n\nEveryone reads this.\n', h.projectId);
    knowledge.putDoc(HUMAN, 'project', 'quiet-doc', '# Quiet doc\n\nHardly anyone reads this.\n', h.projectId);
    usage.recordRead({ runId: 'run-a', agentId: worker, ticketId: null, scope: 'project', projectId: h.projectId, slug: 'popular-doc', tokens: 10 });
    usage.recordRead({ runId: 'run-b', agentId: worker, ticketId: null, scope: 'project', projectId: h.projectId, slug: 'popular-doc', tokens: 10 });
    usage.recordRead({ runId: 'run-c', agentId: worker, ticketId: null, scope: 'project', projectId: h.projectId, slug: 'quiet-doc', tokens: 5 });
    backdateAll();

    const top = usage.topDocuments({ projectId: h.projectId, window: 'all' });
    expect(top.map((d) => d.slug)).toEqual(['popular-doc', 'quiet-doc']);
    expect(top[0]).toMatchObject({ slug: 'popular-doc', reads: 2, tokens: 20 });
  });

  it('lists a document that exists in the catalogue but was never read', () => {
    knowledge.putDoc(HUMAN, 'project', 'popular-doc', '# Popular doc\n\nEveryone reads this.\n', h.projectId);
    knowledge.putDoc(HUMAN, 'project', 'unread-doc', '# Unread doc\n\nNobody has opened this.\n', h.projectId);
    usage.recordRead({ runId: 'run-a', agentId: h.conductorId, ticketId: null, scope: 'project', projectId: h.projectId, slug: 'popular-doc', tokens: 10 });
    backdateAll();

    const never = usage.neverRead({ projectId: h.projectId, window: 'all' });
    expect(never.map((d) => d.slug)).toEqual(['unread-doc']);
  });

  it('still counts a document read outside the queried window as never read within it', () => {
    knowledge.putDoc(HUMAN, 'project', 'old-read', '# Old read\n\nRead a long time ago.\n', h.projectId);
    usage.recordRead({ runId: 'run-a', agentId: h.conductorId, ticketId: null, scope: 'project', projectId: h.projectId, slug: 'old-read', tokens: 10 });
    h.db.run('UPDATE knowledge_usage_events SET occurred_at = ? WHERE run_id = ?', ['2000-01-01T00:00:00.000Z', 'run-a']);

    const never = usage.neverRead({ projectId: h.projectId, window: '24h' });
    expect(never.map((d) => d.slug)).toContain('old-read');
  });
});
