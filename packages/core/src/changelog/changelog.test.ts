import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@weave-ai/db';
import { CHANGELOG_KINDS } from '@weave-ai/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createChangelogService } from './index.js';
import type { ChangelogService } from '../api.js';

describe('changelog', () => {
  let h: TestHarness;
  let changelog: ChangelogService;
  let otherProject: string;
  let seq = 0;

  beforeEach(() => {
    h = makeHarness();
    seq = 0;
    changelog = createChangelogService(h.ctx, h.deps);
    otherProject = newId();
    h.db.insert('projects', {
      id: otherProject, workspaceId: h.workspaceId, slug: 'web', name: 'Web', gitUrl: 'git@example.com:acme/web.git',
      defaultBranch: 'main', clonePath: '/tmp/web', maxWorkers: 4, worktreeProvider: 'git',
      openspecEnabled: 1, policiesJson: {}, status: 'ready', createdAt: 't0', updatedAt: 't0',
    });
  });
  afterEach(() => h.cleanup());

  const ticket = (over: Record<string, unknown> = {}): string => {
    const id = newId();
    seq += 1;
    h.db.insert('tickets', {
      id, workspaceId: h.workspaceId, projectId: h.projectId, number: seq, identifier: `TST-${seq}`, kind: 'change',
      title: `Ticket ${seq}`, createdByKind: 'human', createdAt: 't0', updatedAt: 't0', ...over,
    });
    return id;
  };

  /** Activity as the services write it, with the timestamp under the test's control. */
  const act = (over: Record<string, unknown> & { action: string; createdAt: string }): string => {
    const id = newId();
    h.db.insert('activity', {
      id, workspaceId: h.workspaceId, actorKind: 'human', actorId: 'victor', entityType: 'ticket', entityId: 't',
      ticketId: null, projectId: null, detailsJson: {}, ...over,
    });
    return id;
  };

  const kinds = () => changelog.list().entries.map((e) => e.kind);

  describe('list', () => {
    it('projects each of the seven kinds and nothing else', () => {
      const t = ticket();
      act({ action: 'ticket.create', createdAt: '2026-09-05T01:00:00.000Z', ticketId: t, projectId: h.projectId, detailsJson: { kind: 'change' } });
      act({ action: 'ticket.transition', createdAt: '2026-09-05T02:00:00.000Z', ticketId: t, projectId: h.projectId, detailsJson: { from: 'proposed', to: 'approved' } });
      act({ action: 'ticket.work_product', createdAt: '2026-09-05T03:00:00.000Z', ticketId: t, projectId: h.projectId, detailsJson: { type: 'pull_request', url: 'https://example.invalid/pr/1' } });
      act({ action: 'ticket.delivery_landed', createdAt: '2026-09-05T04:00:00.000Z', ticketId: t, projectId: h.projectId, detailsJson: { mode: 'ff' } });
      act({ action: 'ticket.cancel', createdAt: '2026-09-05T05:00:00.000Z', ticketId: t, projectId: h.projectId, detailsJson: { reason: 'superseded' } });
      act({ action: 'role.hire', createdAt: '2026-09-05T06:00:00.000Z', entityType: 'role', entityId: h.roleId, projectId: h.projectId, detailsJson: { project: 'api' } });
      act({ action: 'daemon.upgraded', createdAt: '2026-09-05T07:00:00.000Z', actorKind: 'system', actorId: null, entityType: 'daemon', entityId: 'u1', detailsJson: { toRelease: 'r2' } });

      expect(kinds()).toEqual(['upgraded', 'hired', 'cancelled', 'landed', 'pr_opened', 'plan_approved', 'filed']);
      expect(new Set(kinds())).toEqual(new Set(CHANGELOG_KINDS));
    });

    it('leaves operational activity out of the record', () => {
      const t = ticket();
      for (const action of ['ticket.checkout', 'ticket.release', 'ticket.update', 'knowledge.write', 'wake.enqueue', 'worker.spawn', 'decision.answer']) {
        act({ action, createdAt: '2026-09-05T01:00:00.000Z', ticketId: t, projectId: h.projectId });
      }
      expect(changelog.list().entries).toEqual([]);
    });

    // Both of these actions fire for things that are not changelog entries at all.
    it('takes only the transition into approved and only a pull request work product', () => {
      const t = ticket();
      act({ action: 'ticket.transition', createdAt: '2026-09-05T01:00:00.000Z', ticketId: t, projectId: h.projectId, detailsJson: { to: 'in_progress' } });
      act({ action: 'ticket.transition', createdAt: '2026-09-05T02:00:00.000Z', ticketId: t, projectId: h.projectId, detailsJson: { to: 'done' } });
      act({ action: 'ticket.work_product', createdAt: '2026-09-05T03:00:00.000Z', ticketId: t, projectId: h.projectId, detailsJson: { type: 'branch' } });
      expect(changelog.list().entries).toEqual([]);

      act({ action: 'ticket.transition', createdAt: '2026-09-05T04:00:00.000Z', ticketId: t, projectId: h.projectId, detailsJson: { to: 'approved' } });
      expect(kinds()).toEqual(['plan_approved']);
    });

    it('carries the ticket identifier, the summary and the link', () => {
      const t = ticket({ title: 'Add dark mode' });
      act({ action: 'ticket.create', createdAt: '2026-09-05T01:00:00.000Z', ticketId: t, projectId: h.projectId, detailsJson: { kind: 'change' } });
      const [entry] = changelog.list().entries;
      expect(entry).toMatchObject({
        kind: 'filed', ticketIdentifier: 'TST-1', projectId: h.projectId,
        summary: 'Filed change: Add dark mode', link: { kind: 'ticket', target: t },
      });
      expect(entry!.actor).toMatchObject({ kind: 'human', id: 'victor' });
    });

    it('names a project by its display label, falling back to the slug (VS-330)', () => {
      act({ action: 'role.hire', createdAt: '2026-09-05T06:00:00.000Z', entityType: 'role', entityId: h.roleId, projectId: h.projectId, detailsJson: { project: 'api' } });
      expect(changelog.list().entries[0]!.summary).toBe('Hired Backend Engineer for API');

      h.db.update('projects', h.projectId, { name: '' });
      expect(changelog.list().entries[0]!.summary).toBe('Hired Backend Engineer for api');
    });

    it('scopes a project to its own entries', () => {
      const mine = ticket();
      const theirs = ticket({ projectId: otherProject });
      act({ action: 'ticket.create', createdAt: '2026-09-05T01:00:00.000Z', ticketId: mine, projectId: h.projectId });
      act({ action: 'ticket.create', createdAt: '2026-09-05T02:00:00.000Z', ticketId: theirs, projectId: otherProject });
      act({ action: 'daemon.upgraded', createdAt: '2026-09-05T03:00:00.000Z', entityType: 'daemon', entityId: 'u1' });

      expect(changelog.list({ projectId: h.projectId }).entries.map((e) => e.ticketId)).toEqual([mine]);
      expect(changelog.list({ projectId: otherProject }).entries.map((e) => e.ticketId)).toEqual([theirs]);
      // The workspace scope is everything, including what belongs to no project.
      expect(changelog.list().entries).toHaveLength(3);
    });

    it('pages newest first and stops when nothing older remains', () => {
      const t = ticket();
      for (let i = 1; i <= 5; i += 1) {
        act({ action: 'ticket.create', createdAt: `2026-09-05T0${i}:00:00.000Z`, ticketId: t, projectId: h.projectId });
      }
      const first = changelog.list({ limit: 2 });
      expect(first.entries.map((e) => e.at)).toEqual(['2026-09-05T05:00:00.000Z', '2026-09-05T04:00:00.000Z']);
      expect(first.nextCursor).not.toBeNull();

      const second = changelog.list({ limit: 2, before: first.nextCursor });
      expect(second.entries.map((e) => e.at)).toEqual(['2026-09-05T03:00:00.000Z', '2026-09-05T02:00:00.000Z']);

      const third = changelog.list({ limit: 2, before: second.nextCursor });
      expect(third.entries.map((e) => e.at)).toEqual(['2026-09-05T01:00:00.000Z']);
      expect(third.nextCursor).toBeNull();
    });

    it('breaks a tie inside one timestamp so a page never repeats or skips', () => {
      const t = ticket();
      const ids = [1, 2, 3, 4].map(() => act({ action: 'ticket.create', createdAt: '2026-09-05T01:00:00.000Z', ticketId: t, projectId: h.projectId }));
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 4; page += 1) {
        const r: ReturnType<ChangelogService['list']> = changelog.list({ limit: 2, before: cursor });
        seen.push(...r.entries.map((e) => e.id));
        cursor = r.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual([...ids].reverse());
    });

    it('does not repeat or skip when an entry is recorded between two pages', () => {
      const t = ticket();
      for (let i = 1; i <= 4; i += 1) {
        act({ action: 'ticket.create', createdAt: `2026-09-05T0${i}:00:00.000Z`, ticketId: t, projectId: h.projectId });
      }
      const first = changelog.list({ limit: 2 });
      const firstIds = first.entries.map((e) => e.id);

      // Newer than everything already returned: it sorts above the cursor.
      const fresh = act({ action: 'ticket.create', createdAt: '2026-09-05T09:00:00.000Z', ticketId: t, projectId: h.projectId });

      const second = changelog.list({ limit: 2, before: first.nextCursor });
      expect(second.entries.map((e) => e.id)).not.toContain(fresh);
      for (const id of firstIds) expect(second.entries.map((e) => e.id)).not.toContain(id);
      expect(second.entries.map((e) => e.at)).toEqual(['2026-09-05T02:00:00.000Z', '2026-09-05T01:00:00.000Z']);
    });

    it('reads history recorded before the changelog existed, at its original time', () => {
      // Exactly what an upgraded workspace has: rows already in activity, nothing else done.
      const t = ticket();
      act({ action: 'ticket.delivery_landed', createdAt: '2025-11-02T08:30:00.000Z', ticketId: t, projectId: h.projectId, detailsJson: { mode: 'ff' } });
      const [entry] = changelog.list().entries;
      expect(entry).toMatchObject({ kind: 'landed', at: '2025-11-02T08:30:00.000Z' });
    });

    // An empty record and a mistyped id look identical to the reader; only one is worth acting on.
    it('fails naming the project when it does not exist', () => {
      expect(() => changelog.list({ projectId: 'nope' })).toThrow(/project nope not found/);
      expect(() => changelog.heatmap({ projectId: 'nope', timezone: 'UTC' })).toThrow(/project nope not found/);
    });

    it('accepts a project by slug as well as by id', () => {
      const t = ticket();
      act({ action: 'ticket.create', createdAt: '2026-09-05T01:00:00.000Z', ticketId: t, projectId: h.projectId });
      expect(changelog.list({ projectId: h.projectSlug }).entries).toHaveLength(1);
    });

    it('exposes no way to write, edit or delete an entry', () => {
      expect(Object.keys(changelog).sort()).toEqual(['heatmap', 'list']);
    });
  });

  describe('heatmap', () => {
    const landed = (at: string, projectId: string = h.projectId, ticketId?: string) =>
      act({ action: 'ticket.delivery_landed', createdAt: at, ticketId: ticketId ?? ticket({ projectId }), projectId, detailsJson: { mode: 'ff' } });

    it('returns every day of the range, zero-filled', () => {
      const r = changelog.heatmap({ from: '2026-09-01', to: '2026-09-05', timezone: 'UTC' });
      expect(r.days.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
      expect(r.days.every((d) => d.total === 0 && d.landed === 0)).toBe(true);
    });

    it('covers at least a year by default', () => {
      const r = changelog.heatmap({ timezone: 'UTC' });
      expect(r.days.length).toBeGreaterThanOrEqual(365);
    });

    it('counts tickets landed per day', () => {
      landed('2026-09-04T09:00:00.000Z');
      landed('2026-09-04T12:00:00.000Z');
      landed('2026-09-04T18:00:00.000Z');
      landed('2026-09-05T09:00:00.000Z');
      const days = changelog.heatmap({ from: '2026-09-03', to: '2026-09-05', timezone: 'UTC' }).days;
      expect(days.map((d) => [d.date, d.landed])).toEqual([['2026-09-03', 0], ['2026-09-04', 3], ['2026-09-05', 1]]);
    });

    it('buckets an entry near midnight by the named timezone, not by UTC', () => {
      // 22:30 UTC on the 5th is already 00:30 on the 6th in Copenhagen.
      landed('2026-09-05T22:30:00.000Z');
      const utc = changelog.heatmap({ from: '2026-09-05', to: '2026-09-06', timezone: 'UTC' }).days;
      expect(utc.map((d) => [d.date, d.landed])).toEqual([['2026-09-05', 1], ['2026-09-06', 0]]);

      const cph = changelog.heatmap({ from: '2026-09-05', to: '2026-09-06', timezone: 'Europe/Copenhagen' }).days;
      expect(cph.map((d) => [d.date, d.landed])).toEqual([['2026-09-05', 0], ['2026-09-06', 1]]);
    });

    it('breaks a day down by kind and totals it', () => {
      const t = ticket();
      act({ action: 'ticket.create', createdAt: '2026-09-04T09:00:00.000Z', ticketId: t, projectId: h.projectId });
      landed('2026-09-04T10:00:00.000Z');
      const day = changelog.heatmap({ from: '2026-09-04', to: '2026-09-04', timezone: 'UTC' }).days[0]!;
      expect(day).toMatchObject({ total: 2, landed: 1 });
      expect(day.byKind.filed).toBe(1);
      expect(day.byKind.landed).toBe(1);
      expect(day.byKind.hired).toBe(0);
    });

    it('counts only the project asked for', () => {
      landed('2026-09-04T09:00:00.000Z', h.projectId);
      landed('2026-09-04T10:00:00.000Z', otherProject);
      const mine = changelog.heatmap({ projectId: h.projectId, from: '2026-09-04', to: '2026-09-04', timezone: 'UTC' }).days[0]!;
      const all = changelog.heatmap({ from: '2026-09-04', to: '2026-09-04', timezone: 'UTC' }).days[0]!;
      expect(mine.landed).toBe(1);
      expect(all.landed).toBe(2);
    });

    it('states the measure it shades and what it means', () => {
      const r = changelog.heatmap({ from: '2026-09-04', to: '2026-09-04', timezone: 'UTC' });
      expect(r.measure.kind).toBe('landed');
      expect(r.measure.label).toBe('Tickets landed');
      expect(r.measure.definition.length).toBeGreaterThan(10);
      expect(r.timezone).toBe('UTC');
    });

    it('rejects a range that starts after it ends, and an unknown timezone', () => {
      expect(() => changelog.heatmap({ from: '2026-09-05', to: '2026-09-01', timezone: 'UTC' })).toThrow(/starts after/);
      expect(() => changelog.heatmap({ timezone: 'Mars/Olympus' })).toThrow(/timezone/);
    });
  });
});
