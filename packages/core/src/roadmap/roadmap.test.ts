import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OcError } from '@weave-ai/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createRoadmapService } from './index.js';
import type { Actor, RoadmapService } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };
const OTHER_PROJECT = 'p-other';

describe('roadmap (VS-397)', () => {
  let h: TestHarness;
  let roadmap: RoadmapService;

  beforeEach(() => {
    h = makeHarness();
    h.ctx.db.insert('projects', {
      id: OTHER_PROJECT, workspaceId: h.workspaceId, slug: 'other', name: 'Other', gitUrl: 'git@example.com:acme/other.git',
      defaultBranch: 'main', clonePath: '/tmp/other', maxWorkers: 4, worktreeProvider: 'git', openspecEnabled: 1,
      policiesJson: {}, status: 'ready', createdAt: 't0', updatedAt: 't0',
    });
    // The two tickets the link tests resolve against; `roadmap_items.ticket_id` is a real FK.
    h.ctx.db.insert('tickets', { id: 't-own', workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'change', title: 'Own', createdByKind: 'human', createdAt: 't0', updatedAt: 't0' });
    h.ctx.db.insert('tickets', { id: 't-foreign', workspaceId: h.workspaceId, projectId: OTHER_PROJECT, number: 2, identifier: 'TST-2', kind: 'change', title: 'Foreign', createdByKind: 'human', createdAt: 't0', updatedAt: 't0' });
    h.services.projects = {
      // Accepts a slug or an id, like the real `projects.get`.
      get: (id: string) => {
        if (id === h.projectId || id === h.projectSlug) return { id: h.projectId } as never;
        if (id === OTHER_PROJECT || id === 'other') return { id: OTHER_PROJECT } as never;
        throw new OcError('not_found', `project ${id} not found`);
      },
      list: () => [],
    } as never;
    // A ticket belongs to exactly one project; `t-own` is this project's, `t-foreign` is the other's.
    h.services.tickets = {
      get: (id: string) => {
        if (id === 't-own') return { id, projectId: h.projectId };
        if (id === 't-foreign') return { id, projectId: OTHER_PROJECT };
        throw new OcError('not_found', `ticket ${id} not found`);
      },
    } as never;
    roadmap = createRoadmapService(h.ctx, h.deps);
    h.services.roadmap = roadmap;
  });
  afterEach(() => h.cleanup());

  const add = (over: Partial<Parameters<RoadmapService['create']>[2]> = {}, projectId = h.projectId) =>
    roadmap.create(HUMAN, projectId, { title: 'Dark mode', ...over });

  it('creates an item with defaults and appends it to the project order', () => {
    const a = add({ title: 'A' });
    const b = add({ title: 'B' });
    expect(a.status).toBe('idea');
    expect(a.notes).toBe('');
    expect(a.ticketId).toBeNull();
    expect(a.createdByKind).toBe('human');
    expect(a.createdById).toBe('victor');
    expect(a.position).toBe(0);
    expect(b.position).toBe(1);
    expect(roadmap.list(h.projectId).map((i) => i.title)).toEqual(['A', 'B']);
  });

  it('resolves a project named by slug to its canonical id on create and list', () => {
    const created = add({ title: 'By slug' }, h.projectSlug);
    expect(created.projectId).toBe(h.projectId);
    // The row is stored under the canonical id, so both spellings list it.
    expect(roadmap.list(h.projectSlug).map((i) => i.id)).toEqual([created.id]);
    expect(roadmap.list(h.projectId).map((i) => i.id)).toEqual([created.id]);
    expect(() => roadmap.list('ghost')).toThrow(/not found/);
  });

  it('keeps each project\u2019s roadmap separate', () => {
    const mine = add();
    const theirs = add({ title: 'Their idea' }, OTHER_PROJECT);
    expect(roadmap.list(h.projectId).map((i) => i.id)).toEqual([mine.id]);
    expect(roadmap.list(OTHER_PROJECT).map((i) => i.id)).toEqual([theirs.id]);
    expect(roadmap.get(mine.id).projectId).toBe(h.projectId);
  });

  it('rejects an unknown project, an empty title and an unknown status', () => {
    expect(() => add({}, 'ghost')).toThrow(/not found/);
    expect(() => add({ title: '   ' })).toThrow(/title is required/);
    expect(() => add({ status: 'someday' as never })).toThrow(/status must be/);
    expect(() => roadmap.create(HUMAN, h.projectId, { title: 'x', ticketId: 't-nope' })).toThrow(OcError);
  });

  it('reorders densely when an item is moved, and clamps out-of-range positions', () => {
    const a = add({ title: 'A' });
    const b = add({ title: 'B' });
    const c = add({ title: 'C' });
    roadmap.update(HUMAN, c.id, { position: 0 });
    expect(roadmap.list(h.projectId).map((i) => i.title)).toEqual(['C', 'A', 'B']);
    expect(roadmap.list(h.projectId).map((i) => i.position)).toEqual([0, 1, 2]);

    // A position past the end lands last, still dense.
    roadmap.update(HUMAN, c.id, { position: 99 });
    expect(roadmap.list(h.projectId).map((i) => i.title)).toEqual(['A', 'B', 'C']);
    expect(roadmap.list(h.projectId).map((i) => i.position)).toEqual([0, 1, 2]);

    // `a` and `b` never moved.
    expect(roadmap.get(a.id).position).toBe(0);
    expect(roadmap.get(b.id).position).toBe(1);
  });

  it('drops to retain an item, deletes to remove it and renumbers the rest', () => {
    const a = add({ title: 'A' });
    const b = add({ title: 'B' });
    const dropped = roadmap.update(HUMAN, a.id, { status: 'dropped' });
    expect(dropped.status).toBe('dropped');
    expect(roadmap.list(h.projectId)).toHaveLength(2);

    roadmap.remove(HUMAN, a.id);
    expect(roadmap.list(h.projectId).map((i) => i.id)).toEqual([b.id]);
    expect(roadmap.get(b.id).position).toBe(0);
  });

  it('links a ticket of the item\u2019s project, refuses another project\u2019s, and clears with null', () => {
    const item = add();
    const linked = roadmap.update(HUMAN, item.id, { ticketId: 't-own' });
    expect(linked.ticketId).toBe('t-own');
    expect(roadmap.get(item.id).ticketId).toBe('t-own');
    expect(() => roadmap.update(HUMAN, item.id, { ticketId: 't-foreign' })).toThrow(/not in this project/);
    expect(roadmap.update(HUMAN, item.id, { ticketId: null }).ticketId).toBeNull();
  });

  it('edits notes and title without touching order', () => {
    const a = add({ title: 'A' });
    add({ title: 'B' });
    const edited = roadmap.update(HUMAN, a.id, { title: 'A v2', notes: '## Notes' });
    expect(edited.title).toBe('A v2');
    expect(edited.notes).toBe('## Notes');
    expect(roadmap.list(h.projectId).map((i) => i.title)).toEqual(['A v2', 'B']);
  });

  it('emits created, updated and removed events carrying the project id', async () => {
    const item = add();
    roadmap.update(HUMAN, item.id, { status: 'planned' });
    roadmap.remove(HUMAN, item.id);
    await Promise.resolve(); // EventBus.emit fans out on a microtask
    const mine = h.events.filter((e) => e.entityType === 'roadmap');
    expect(mine.map((e) => e.type)).toEqual(['roadmap.created', 'roadmap.updated', 'roadmap.removed']);
    expect(mine.every((e) => (e.payload as { projectId: string }).projectId === h.projectId)).toBe(true);
    expect(mine.every((e) => e.entityId === item.id)).toBe(true);
  });
});
