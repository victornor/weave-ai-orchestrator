import { afterEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@openconductor/db';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createBriefingService } from './index.js';

let h: TestHarness;
afterEach(() => h?.cleanup());

const ago = (days: number, hours = 0): string => new Date(Date.now() - days * 86400e3 - hours * 3600e3).toISOString();

function briefing(): ReturnType<typeof createBriefingService> {
  return createBriefingService(h.ctx, h.deps);
}

let n = 0;
function mkTicket(over: Record<string, unknown> = {}): { id: string; identifier: string } {
  const id = newId();
  const num = ++n;
  const ts = nowIso();
  h.db.insert('tickets', {
    id, workspaceId: h.workspaceId, projectId: h.projectId, number: num, identifier: `TST-${num}`, kind: 'change',
    title: `Ticket ${num}`, description: '', status: 'todo', priority: 'medium', createdByKind: 'human',
    createdAt: ts, updatedAt: ts, ...over,
  });
  return { id, identifier: `TST-${num}` };
}

function mkDecision(over: Record<string, unknown> = {}): string {
  const id = newId();
  h.db.insert('decisions', {
    id, workspaceId: h.workspaceId, kind: 'approval', owner: 'human', title: 'Decide something', context: '',
    status: 'open', createdAt: nowIso(), ...over,
  });
  return id;
}

describe('briefing needsYou', () => {
  it('lists open human decisions newest first and ignores the rest', () => {
    h = makeHarness();
    const t = mkTicket();
    mkDecision({ title: 'older', createdAt: ago(2) });
    mkDecision({ title: 'newer', createdAt: ago(1), ticketId: t.id, recommendation: 'ship it', kind: 'merge_approval' });
    mkDecision({ title: 'conductor owns this', owner: 'conductor' });
    mkDecision({ title: 'already answered', status: 'answered' });

    const snap = briefing().snapshot();
    expect(snap.needsYou.map((d) => d.title)).toEqual(['newer', 'older']);
    expect(snap.needsYou[0]).toMatchObject({ ticketId: t.id, kind: 'merge_approval', recommendation: 'ship it' });
    expect(snap.needsYou[1]).toMatchObject({ ticketId: null, recommendation: null });
    expect(snap.generatedAt).toBeTypeOf('string');
  });
});

describe('briefing landed', () => {
  it('lists tickets completed in the last 7 days with their newest pull request', () => {
    h = makeHarness();
    const recent = mkTicket({ status: 'done', completedAt: ago(1) });
    const older = mkTicket({ status: 'done', completedAt: ago(3) });
    mkTicket({ status: 'done', completedAt: ago(30) });
    mkTicket({ status: 'in_progress' });

    for (const [wpAge, url] of [[2, 'https://example.com/pr/1'], [0, 'https://example.com/pr/2']] as const) {
      h.db.insert('ticket_work_products', {
        id: newId(), ticketId: recent.id, type: 'pull_request', url, createdAt: ago(wpAge), updatedAt: ago(wpAge),
      });
    }

    const snap = briefing().snapshot();
    expect(snap.landed.map((l) => l.identifier)).toEqual([recent.identifier, older.identifier]);
    expect(snap.landed[0]!.prUrl).toBe('https://example.com/pr/2');
    expect(snap.landed[1]!.prUrl).toBeUndefined();
  });
});

describe('briefing underway', () => {
  it('pairs live workers with their ticket and last status comment', () => {
    h = makeHarness();
    const active = mkTicket({ status: 'in_progress' });
    const doneTicket = mkTicket({ status: 'done', completedAt: ago(1) });
    const worker = h.addWorker(active.id, { name: 'Backend Engineer #7' });
    h.addWorker(doneTicket.id, { name: 'Backend Engineer #8' });
    const retiredTicket = mkTicket({ status: 'in_progress' });
    h.addWorker(retiredTicket.id, { name: 'Retired One', status: 'retired' });

    h.db.insert('ticket_comments', { id: newId(), ticketId: active.id, authorKind: 'agent', body: 'old status', kind: 'status', createdAt: ago(2) });
    h.db.insert('ticket_comments', { id: newId(), ticketId: active.id, authorKind: 'agent', body: 'running the tests', kind: 'status', createdAt: ago(0, 1) });
    h.db.insert('ticket_comments', { id: newId(), ticketId: active.id, authorKind: 'human', body: 'just a comment', kind: 'comment', createdAt: nowIso() });

    const snap = briefing().snapshot();
    expect(snap.underway).toHaveLength(1);
    expect(snap.underway[0]).toMatchObject({
      workerId: worker, workerName: 'Backend Engineer #7', ticketId: active.id,
      identifier: active.identifier, status: 'in_progress', lastStatus: 'running the tests',
    });

    const noComment = mkTicket({ status: 'in_progress' });
    h.addWorker(noComment.id, { name: 'Backend Engineer #9' });
    expect(briefing().snapshot().underway.find((u) => u.ticketId === noComment.id)?.lastStatus).toBeNull();
  });
});

describe('briefing queued', () => {
  it('explains why each waiting ticket has not started', () => {
    h = makeHarness();
    const unassigned = mkTicket({ status: 'todo', assigneeRoleId: null, createdAt: ago(3) });
    const pickup = mkTicket({ status: 'backlog', assigneeRoleId: h.roleId, createdAt: ago(2) });
    const started = mkTicket({ status: 'in_progress' });
    h.addWorker(started.id);

    let snap = briefing().snapshot();
    expect(snap.queued.map((q) => q.ticketId)).toEqual([pickup.id, unassigned.id]); // newest first
    expect(snap.queued.find((q) => q.ticketId === unassigned.id)!.reason).toBe('unassigned');
    expect(snap.queued.find((q) => q.ticketId === pickup.id)!.reason).toBe('waiting to be picked up');

    // Fill the role's two slots: the assigned ticket is now waiting on capacity.
    h.addWorker(null);
    h.addWorker(null);
    snap = briefing().snapshot();
    expect(snap.queued.find((q) => q.ticketId === pickup.id)!.reason).toBe('waiting for a worker slot');
  });

  it('skips tickets that already have a live worker', () => {
    h = makeHarness();
    const t = mkTicket({ status: 'todo' });
    h.addWorker(t.id);
    expect(briefing().snapshot().queued).toEqual([]);
  });
});

describe('briefing warnings', () => {
  it('surfaces failed workers, blocked tickets and expired decisions', () => {
    h = makeHarness();
    h.addWorker(null, { name: 'Backend Engineer #3', status: 'error', errorText: 'runtime unreachable' });
    h.addWorker(null, { name: 'Backend Engineer #4', status: 'error', errorText: null });
    const withPath = mkTicket({ status: 'blocked', unblockJson: { owner: 'conductor', action: 'ask the API team for a token' } });
    const noPath = mkTicket({ status: 'blocked' });
    mkDecision({ title: 'stale approval', status: 'expired', expiresAt: ago(1) });
    mkDecision({ title: 'ancient approval', status: 'expired', expiresAt: ago(30) });

    const w = briefing().snapshot().warnings;
    expect(w).toContain('Backend Engineer #3 failed: runtime unreachable');
    expect(w).toContain('Backend Engineer #4 failed: unknown error');
    expect(w).toContain(`${withPath.identifier} blocked: ask the API team for a token`);
    expect(w).toContain(`${noPath.identifier} blocked with no action path`);
    expect(w).toContain('decision expired: stale approval');
    expect(w).not.toContain('decision expired: ancient approval');
  });

  it('is quiet and read-only on a healthy workspace', () => {
    h = makeHarness();
    const before = h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM activity')!.n;
    const snap = briefing().snapshot();
    expect(snap).toMatchObject({ needsYou: [], landed: [], underway: [], queued: [], warnings: [] });
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM activity')!.n).toBe(before);
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')!.n).toBe(0);
  });
});
