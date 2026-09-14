/**
 * The pull-request join, its window and its cache (VS-97).
 *
 * The forge is a counting double: no `gh`, no subprocess, no GitHub. What is under test is what the
 * daemon does with what a forge returns — which ticket a pull request belongs to, which change that
 * ticket implements, where it stands in the merge queue, how long an answer is held, and what is
 * said when there is nothing to ask.
 */
import { mkdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@weave-ai/db';
import type { ForgeAdapter, ForgePullRequest, ForgePullRequestDetail } from '@weave-ai/plugin-sdk';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createPullRequestsService, PR_CACHE_TTL_MS } from './index.js';
import type { CoreServices, MergeQueueView, PullRequestsService } from '../api.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-07T12:00:00.000Z');
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

function pr(over: Partial<ForgePullRequest> & { number: number }): ForgePullRequest {
  return {
    title: `PR ${over.number}`, url: `https://github.com/acme/api/pull/${over.number}`, author: 'victornor',
    state: 'open', isDraft: false, headRefName: 'topic', baseRefName: 'main',
    createdAt: iso(2 * DAY), updatedAt: iso(DAY), mergedAt: null, closedAt: null,
    additions: 10, deletions: 2, changedFiles: 1, checks: 'success', reviewDecision: null, mergeCommit: null,
    ...over,
  };
}

/** A forge that answers from a script and counts what it was asked. */
function fakeForge(list: ForgePullRequest[], opts: { detect?: boolean; throwOnList?: boolean } = {}): ForgeAdapter & { listCalls: number; detectCalls: number; list: ForgePullRequest[]; throwOnList: boolean } {
  const f = {
    id: 'github',
    listCalls: 0,
    detectCalls: 0,
    list,
    throwOnList: opts.throwOnList ?? false,
    detect: async () => { f.detectCalls += 1; return opts.detect ?? true; },
    prState: async () => ({ state: 'open' as const }),
    mergePr: async () => ({}),
    listPullRequests: async () => {
      f.listCalls += 1;
      if (f.throwOnList) throw new Error('gh pr list failed: HTTP 502');
      return f.list;
    },
    pullRequest: async (_cwd: string, number: number): Promise<ForgePullRequestDetail | null> => {
      const found = f.list.find((p) => p.number === number);
      return found ? { ...found, body: `body of ${number}`, files: [{ path: 'a.ts', additions: 3, deletions: 1 }], checkRuns: [{ name: 'ci', state: 'success', url: null }] } : null;
    },
  };
  return f;
}

describe('project pull requests', () => {
  let h: TestHarness;
  let service: PullRequestsService;
  let forge: ReturnType<typeof fakeForge>;
  let queue: MergeQueueView;
  let seq = 0;

  /** A ticket of the harness's project, with whatever the test needs on it. */
  const ticket = (over: Record<string, unknown> = {}): { id: string; identifier: string } => {
    const id = newId();
    seq += 1;
    const identifier = (over['identifier'] as string) ?? `TST-${seq}`;
    h.db.insert('tickets', {
      id, workspaceId: h.workspaceId, projectId: h.projectId, number: seq, identifier, kind: 'change',
      title: `Ticket ${seq}`, status: 'in_review', createdByKind: 'agent', createdAt: 't0', updatedAt: 't0', ...over,
    });
    return { id, identifier };
  };

  const workProduct = (ticketId: string, url: string): void => {
    h.db.insert('ticket_work_products', {
      id: newId(), ticketId, type: 'pull_request', url, title: null, state: 'open', isPrimary: 1, createdAt: 't0', updatedAt: 't0',
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    h = makeHarness();
    seq = 0;
    // The clone has to exist on disk: a project whose clone is missing is one of the unavailable reasons.
    mkdirSync(h.db.get<{ clonePath: string }>('SELECT clone_path FROM projects WHERE id = ?', [h.projectId])!.clonePath, { recursive: true });
    queue = { projectId: h.projectId, concurrency: 1, active: [], waiting: [], recent: [] };
    h.services.projects = { get: (id: string) => h.db.get('SELECT * FROM projects WHERE id = ? OR slug = ?', [id, id]) } as unknown as CoreServices['projects'];
    h.services.tickets = { mergeQueue: { forProject: () => queue } } as unknown as CoreServices['tickets'];
    forge = fakeForge([]);
    h.ctx.registries.forges.set('github', forge);
    service = createPullRequestsService(h.ctx, h.deps);
  });
  afterEach(() => { vi.useRealTimers(); h.cleanup(); });

  describe('the join', () => {
    it('finds the ticket by the pull request its work product records', async () => {
      const t = ticket({ openspecChangeName: 'tst-1-dark-mode' });
      workProduct(t.id, 'https://github.com/acme/api/pull/7');
      forge.list = [pr({ number: 7, headRefName: 'anything-at-all' })];

      const out = await service.list(h.projectId);
      expect(out.open[0]?.ticket).toMatchObject({ id: t.id, identifier: t.identifier, hasPlan: false });
      expect(out.open[0]?.changeName).toBe('tst-1-dark-mode');
    });

    it('matches a trailing slash the forge and the work product spell differently', async () => {
      const t = ticket();
      workProduct(t.id, 'https://github.com/acme/api/pull/7/');
      forge.list = [pr({ number: 7 })];
      expect((await service.list(h.projectId)).open[0]?.ticket?.id).toBe(t.id);
    });

    it('falls back to the ticket its branch names', async () => {
      const t = ticket({ identifier: 'TST-42', openspecChangeName: 'tst-42-a-change' });
      forge.list = [pr({ number: 9, headRefName: 'ac/tst-42-a-title-that-has-since-been-edited' })];

      const out = await service.list(h.projectId);
      expect(out.open[0]?.ticket?.id).toBe(t.id);
      expect(out.open[0]?.changeName).toBe('tst-42-a-change');
    });

    it('lists a pull request that matches no ticket, with nothing joined to it', async () => {
      forge.list = [pr({ number: 11, headRefName: 'dependabot/npm/left-pad' })];
      const out = await service.list(h.projectId);
      expect(out.open[0]).toMatchObject({ number: 11, ticket: null, changeName: null, queue: null });
    });

    it('does not match a ticket of another project', async () => {
      const other = newId();
      h.db.insert('projects', {
        id: other, workspaceId: h.workspaceId, slug: 'web', name: 'Web', gitUrl: 'git@example.com:acme/web.git',
        defaultBranch: 'main', clonePath: '/tmp/web', maxWorkers: 4, worktreeProvider: 'git',
        openspecEnabled: 1, policiesJson: {}, status: 'ready', createdAt: 't0', updatedAt: 't0',
      });
      const t = ticket({ identifier: 'TST-50', projectId: other });
      workProduct(t.id, 'https://github.com/acme/api/pull/12');
      forge.list = [pr({ number: 12, headRefName: 'ac/tst-50-elsewhere' })];
      expect((await service.list(h.projectId)).open[0]?.ticket).toBeNull();
    });

    it('says the ticket has a plan only when one exists', async () => {
      const t = ticket();
      workProduct(t.id, 'https://github.com/acme/api/pull/7');
      h.db.insert('ticket_documents', { id: newId(), ticketId: t.id, key: 'plan', currentRevision: 1 });
      forge.list = [pr({ number: 7 })];
      expect((await service.list(h.projectId)).open[0]?.ticket?.hasPlan).toBe(true);
    });

    it('reports where a ticket stands in the merge queue', async () => {
      const landing = ticket();
      const waiting = ticket();
      workProduct(landing.id, 'https://github.com/acme/api/pull/1');
      workProduct(waiting.id, 'https://github.com/acme/api/pull/2');
      queue = {
        projectId: h.projectId, concurrency: 1,
        active: [{ ticketId: landing.id, identifier: landing.identifier, title: '', projectId: h.projectId, position: null, queuedAt: null, startedAt: null, workerId: null, ciState: null, ciStateAt: null }],
        waiting: [{ ticketId: waiting.id, identifier: waiting.identifier, title: '', projectId: h.projectId, position: 2, queuedAt: null, startedAt: null, workerId: null, ciState: null, ciStateAt: null }],
        recent: [],
      };
      forge.list = [pr({ number: 1 }), pr({ number: 2 })];

      const out = await service.list(h.projectId);
      expect(out.open.find((p) => p.number === 1)?.queue).toEqual({ state: 'landing', position: null });
      expect(out.open.find((p) => p.number === 2)?.queue).toEqual({ state: 'waiting', position: 2 });
    });
  });

  describe('the window and the order', () => {
    it('lists open first, then what closed inside the window, each most recent first', async () => {
      forge.list = [
        pr({ number: 1, updatedAt: iso(5 * DAY) }),
        pr({ number: 2, state: 'merged', mergedAt: iso(3 * DAY), updatedAt: iso(3 * DAY) }),
        pr({ number: 3, updatedAt: iso(1 * DAY) }),
        pr({ number: 4, state: 'closed', closedAt: iso(10 * DAY), updatedAt: iso(10 * DAY) }),
      ];
      const out = await service.list(h.projectId);
      expect(out.open.map((p) => p.number)).toEqual([3, 1]);
      expect(out.recent.map((p) => p.number)).toEqual([2, 4]);
      expect(out.windowDays).toBe(30);
    });

    it('leaves out what closed before the window', async () => {
      forge.list = [pr({ number: 5, state: 'merged', mergedAt: iso(40 * DAY), updatedAt: iso(40 * DAY) })];
      const out = await service.list(h.projectId);
      expect(out.open).toEqual([]);
      expect(out.recent).toEqual([]);
      expect(out.available).toBe(true);
    });
  });

  describe('the cache', () => {
    it('asks the forge once inside the window', async () => {
      forge.list = [pr({ number: 1 })];
      await service.list(h.projectId);
      await service.list(h.projectId);
      expect(forge.listCalls).toBe(1);
    });

    it('asks again once the window has passed', async () => {
      await service.list(h.projectId);
      vi.setSystemTime(NOW + PR_CACHE_TTL_MS + 1);
      await service.list(h.projectId);
      expect(forge.listCalls).toBe(2);
    });

    it('keeps a good answer when the next read fails, and says it is stale', async () => {
      forge.list = [pr({ number: 1 })];
      expect((await service.list(h.projectId)).open).toHaveLength(1);

      forge.throwOnList = true;
      vi.setSystemTime(NOW + PR_CACHE_TTL_MS + 1);
      const out = await service.list(h.projectId);
      expect(out.available).toBe(true);
      expect(out.open.map((p) => p.number)).toEqual([1]);
      expect(out.stale).toBe(true);
    });

    it('reads one pull request once and answers the second time from the cache', async () => {
      forge.list = [pr({ number: 3 })];
      const spy = vi.spyOn(forge, 'pullRequest');
      await service.get(h.projectId, 3);
      const again = await service.get(h.projectId, 3);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(again.pullRequest).toMatchObject({ number: 3, body: 'body of 3' });
    });
  });

  describe('freshness', () => {
    const emitFor = (ticketId: string, type: 'ticket.work_product' | 'ticket.merged' | 'ticket.status'): void => {
      h.ctx.events.emit(type, 'ticket', ticketId, { ticketId });
    };

    it.each(['ticket.work_product', 'ticket.merged', 'ticket.status'] as const)('re-reads the forge after %s', async (type) => {
      const t = ticket();
      await service.list(h.projectId);
      expect(forge.listCalls).toBe(1);

      emitFor(t.id, type);
      await vi.advanceTimersByTimeAsync(0); // the bus delivers on a microtask
      await service.list(h.projectId);
      expect(forge.listCalls).toBe(2);
    });

    it('leaves the cache alone for an unrelated event', async () => {
      const t = ticket();
      await service.list(h.projectId);
      h.ctx.events.emit('ticket.updated', 'ticket', t.id, { ticketId: t.id });
      await vi.advanceTimersByTimeAsync(0);
      await service.list(h.projectId);
      expect(forge.listCalls).toBe(1);
    });

    it('leaves this project alone when another project\'s ticket changes', async () => {
      const other = newId();
      h.db.insert('projects', {
        id: other, workspaceId: h.workspaceId, slug: 'web', name: 'Web', gitUrl: 'git@example.com:acme/web.git',
        defaultBranch: 'main', clonePath: '/tmp/web', maxWorkers: 4, worktreeProvider: 'git',
        openspecEnabled: 1, policiesJson: {}, status: 'ready', createdAt: 't0', updatedAt: 't0',
      });
      const t = ticket({ projectId: other });
      await service.list(h.projectId);
      emitFor(t.id, 'ticket.merged');
      await vi.advanceTimersByTimeAsync(0);
      await service.list(h.projectId);
      expect(forge.listCalls).toBe(1);
    });
  });

  describe('when there is nothing to ask', () => {
    it('says so when no forge is registered', async () => {
      h.ctx.registries.forges.delete('github');
      const out = await service.list(h.projectId);
      expect(out).toMatchObject({ available: false, reason: 'no_forge', open: [], recent: [] });
    });

    it('says so when the forge cannot list', async () => {
      const { listPullRequests: _drop, ...cannot } = forge;
      h.ctx.registries.forges.set('github', cannot as unknown as ForgeAdapter);
      expect((await service.list(h.projectId)).reason).toBe('unsupported');
    });

    it('says so when the clone is not on disk', async () => {
      h.db.update('projects', h.projectId, { clonePath: '/tmp/nowhere-at-all-vs97' });
      expect((await service.list(h.projectId)).reason).toBe('no_clone');
    });

    it('says so when the forge tool is not authenticated', async () => {
      h.ctx.registries.forges.set('github', fakeForge([], { detect: false }));
      expect((await service.list(h.projectId)).reason).toBe('not_authenticated');
    });

    it('says the forge could not be reached, and carries what it said', async () => {
      forge.throwOnList = true;
      const out = await service.list(h.projectId);
      expect(out).toMatchObject({ available: false, reason: 'unreachable' });
      expect(out.message).toContain('502');
    });

    it('never throws for any of them', async () => {
      h.ctx.registries.forges.delete('github');
      await expect(service.list(h.projectId)).resolves.toMatchObject({ available: false });
      await expect(service.get(h.projectId, 1)).resolves.toMatchObject({ available: false, pullRequest: null });
    });
  });

  describe('one pull request', () => {
    it('carries the description, the files and the checks alongside the join', async () => {
      const t = ticket({ openspecChangeName: 'tst-1-change' });
      workProduct(t.id, 'https://github.com/acme/api/pull/3');
      forge.list = [pr({ number: 3 })];

      const out = await service.get(h.projectId, 3);
      expect(out.pullRequest).toMatchObject({
        number: 3, body: 'body of 3', changeName: 'tst-1-change',
        files: [{ path: 'a.ts', additions: 3, deletions: 1 }],
        checkRuns: [{ name: 'ci', state: 'success', url: null }],
      });
      expect(out.pullRequest?.ticket?.id).toBe(t.id);
    });

    it('answers with no pull request for a number the forge does not have', async () => {
      const out = await service.get(h.projectId, 404);
      expect(out).toMatchObject({ available: true, pullRequest: null });
    });
  });
});
