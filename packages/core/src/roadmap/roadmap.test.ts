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

describe('roadmap blocks (VS-478)', () => {
  let h: TestHarness;
  let roadmap: RoadmapService;
  const OTHER = 'p-other';

  beforeEach(() => {
    h = makeHarness();
    h.ctx.db.insert('projects', {
      id: OTHER, workspaceId: h.workspaceId, slug: 'other', name: 'Other', gitUrl: 'git@example.com:acme/other.git',
      defaultBranch: 'main', clonePath: '/tmp/other', maxWorkers: 4, worktreeProvider: 'git', openspecEnabled: 1,
      policiesJson: {}, status: 'ready', createdAt: 't0', updatedAt: 't0',
    });
    h.services.projects = {
      get: (id: string) => {
        if (id === h.projectId || id === h.projectSlug) return { id: h.projectId };
        if (id === OTHER || id === 'other') return { id: OTHER };
        throw new OcError('not_found', `project ${id} not found`);
      },
      list: () => [],
    } as never;
    h.services.roles = {
      get: (id: string) => {
        if (id === h.roleId) return { id, projectId: h.projectId };
        if (id === 'r-other') return { id, projectId: OTHER };
        throw new OcError('not_found', `role ${id} not found`);
      },
    } as never;
    // A real role row in the other project, so the `roadmap_items.role_id` foreign key holds.
    h.ctx.db.insert('roles', {
      id: 'r-other', workspaceId: h.workspaceId, projectId: OTHER, slug: 'other-role', name: 'Other', charterSummary: 'x',
      scopeText: 'x', sessionPolicy: 'per_ticket', maxWorkers: 1, status: 'active', specRevision: 1, createdBy: 'weaver', createdAt: 't0', updatedAt: 't0',
    });
    // Ticket reads go through the db so a test can move a ticket between statuses; the rows are real
    // so the `roadmap_items.ticket_id` foreign key holds.
    h.services.tickets = {
      get: (id: string) => {
        const row = h.ctx.db.get<{ id: string; projectId: string; status: string }>('SELECT id, project_id, status FROM tickets WHERE id = ?', [id]);
        if (!row) throw new OcError('not_found', `ticket ${id} not found`);
        return { id: row.id, projectId: row.projectId, status: row.status };
      },
    } as never;
    roadmap = createRoadmapService(h.ctx, h.deps);
    h.services.roadmap = roadmap;
  });
  afterEach(() => h.cleanup());

  const seedTicket = (id: string, projectId: string, status = 'todo') =>
    h.ctx.db.insert('tickets', {
      id, workspaceId: h.workspaceId, projectId, number: Number(id.replace(/\D/g, '')) || 1, identifier: `TST-${id}`,
      kind: 'change', title: id, status, createdByKind: 'human', createdAt: 't0', updatedAt: 't0',
    });

  const block = (title = 'UI polish', projectId = h.projectId) => roadmap.createBlock(HUMAN, projectId, { title });

  it('creates blocks in order, reorders densely, and derives no status before it starts', () => {
    const b1 = block('UI polish');
    const b2 = block('Docs');
    expect(b1.status).toBe('open');
    expect(b1.reportedStatus).toBe('open');
    expect(b1.startedAt).toBeNull();
    expect([b1.position, b2.position]).toEqual([0, 1]);
    roadmap.updateBlock(HUMAN, b2.id, { position: 0 });
    expect(roadmap.listBlocks(h.projectId).map((b) => b.title)).toEqual(['Docs', 'UI polish']);
    expect(roadmap.listBlocks(h.projectId).map((b) => b.position)).toEqual([0, 1]);
    expect(() => roadmap.createBlock(HUMAN, h.projectId, { title: '  ' })).toThrow(/title is required/);
  });

  it('adds ordered pending tickets, merges two and moves one between blocks', () => {
    const b1 = block();
    const b2 = block('Second');
    const a = roadmap.addItem(HUMAN, { blockId: b1.id, title: 'A', description: 'A body', kind: 'task', priority: 'high', roleId: h.roleId });
    const b = roadmap.addItem(HUMAN, { blockId: b1.id, title: 'B', description: 'B body' });
    const c = roadmap.addItem(HUMAN, { blockId: b1.id, title: 'C', description: 'C body' });
    expect(a.kind).toBe('task');
    expect(a.priority).toBe('high');
    expect(a.roleId).toBe(h.roleId);
    expect(a.status).toBe('planned');

    roadmap.mergeItems(HUMAN, [a.id, b.id]);
    expect(roadmap.listBlocks(h.projectId).find((x) => x.id === b1.id)!.items.map((i) => i.title)).toEqual(['A', 'C']);
    expect(roadmap.get(a.id).description).toContain('A body');
    expect(roadmap.get(a.id).description).toContain('### Merged: B');
    expect(roadmap.merges(a.id).map((m) => m.sourceTitle)).toEqual(['B']);

    roadmap.updateItem(HUMAN, c.id, { blockId: b2.id });
    expect(roadmap.listBlocks(h.projectId).find((x) => x.id === b1.id)!.items.map((i) => i.title)).toEqual(['A']);
    expect(roadmap.listBlocks(h.projectId).find((x) => x.id === b2.id)!.items.map((i) => i.title)).toEqual(['C']);
    expect(roadmap.updateItem(HUMAN, c.id, { blockId: null }).blockId).toBeNull();
    expect(roadmap.listBlocks(h.projectId).find((x) => x.id === b2.id)!.items).toHaveLength(0);
  });

  it('refuses bad kinds, foreign blocks and roles, and unsafe merges', () => {
    const b1 = block();
    const b2 = block('Second', OTHER);
    const a = roadmap.addItem(HUMAN, { blockId: b1.id, title: 'A' });
    const c = roadmap.addItem(HUMAN, { blockId: b1.id, title: 'C' });
    expect(() => roadmap.addItem(HUMAN, { blockId: b1.id, title: 'x', kind: 'nope' as never })).toThrow(/kind must be/);
    expect(() => roadmap.addItem(HUMAN, { blockId: b1.id, title: 'x', priority: 'huge' as never })).toThrow(/priority must be/);
    expect(() => roadmap.addItem(HUMAN, { blockId: 'ghost', title: 'x' })).toThrow(OcError);
    expect(() => roadmap.addItem(HUMAN, { blockId: b1.id, title: 'x', roleId: 'r-other' })).toThrow(/not in this project/);
    expect(() => roadmap.updateItem(HUMAN, a.id, { blockId: b2.id })).toThrow(/not in this project/);
    expect(() => roadmap.mergeItems(HUMAN, [a.id])).toThrow(/at least two/);
    const foreign = roadmap.addItem(HUMAN, { blockId: b2.id, title: 'F' });
    expect(() => roadmap.mergeItems(HUMAN, [a.id, foreign.id])).toThrow(/one project/);
    seedTicket('t-1', h.projectId);
    roadmap.updateItem(HUMAN, c.id, { ticketId: 't-1' });
    expect(() => roadmap.mergeItems(HUMAN, [a.id, c.id])).toThrow(/already linked/);
  });

  it('starts a block into one merged draft, then reports started and done from its tickets', () => {
    const b = block();
    const i1 = roadmap.addItem(HUMAN, { blockId: b.id, title: 'One', description: 'd1', kind: 'change', priority: 'medium', roleId: h.roleId });
    const i2 = roadmap.addItem(HUMAN, { blockId: b.id, title: 'Two', description: 'd2' });
    const started = roadmap.startBlock(HUMAN, b.id);
    expect(started.block.status).toBe('started');
    expect(started.block.startedAt).not.toBeNull();
    // One ticket for the whole block: every item as a section, so the default path cannot fan out.
    expect(started.draft).toMatchObject({ title: 'UI polish', kind: 'change', priority: 'medium', roleId: null });
    expect(started.draft!.itemIds).toEqual([i1.id, i2.id]);
    expect(started.draft!.description).toContain('### One');
    expect(started.draft!.description).toContain('d1');
    expect(started.draft!.description).toContain('### Two');
    expect(started.draft!.description).toContain('d2');

    seedTicket('t-1', h.projectId, 'in_progress');
    seedTicket('t-2', h.projectId, 'done');
    roadmap.updateItem(HUMAN, i1.id, { ticketId: 't-1' });
    roadmap.updateItem(HUMAN, i2.id, { ticketId: 't-2' });
    expect(roadmap.getBlock(b.id).reportedStatus).toBe('started');
    // A second start returns only what is still unfiled, so a partial filing retries cleanly.
    expect(roadmap.startBlock(HUMAN, b.id).draft).toBeNull();
    h.ctx.db.run("UPDATE tickets SET status = 'done' WHERE id = 't-1'");
    expect(roadmap.getBlock(b.id).reportedStatus).toBe('done');
    roadmap.updateBlock(HUMAN, b.id, { status: 'dropped' });
    expect(() => roadmap.startBlock(HUMAN, b.id)).toThrow(/dropped/);
  });

  it('derives the merged draft from the items: shared role, most urgent priority, fallbacks when they differ', () => {
    const b = block();
    const a = roadmap.addItem(HUMAN, { blockId: b.id, title: 'A', description: 'body a', kind: 'task', priority: 'low', roleId: h.roleId });
    const c = roadmap.addItem(HUMAN, { blockId: b.id, title: 'C', priority: 'critical', roleId: h.roleId });
    const draft = roadmap.startBlock(HUMAN, b.id).draft!;
    // Kind differs (task vs the default change), so the draft falls back to change rather than guess.
    expect(draft).toMatchObject({ title: 'UI polish', kind: 'change', priority: 'critical', roleId: h.roleId });
    expect(draft.itemIds).toEqual([a.id, c.id]);
    expect(draft.description).toContain('body a');
    expect(draft.description).toContain('_No description yet._');

    const empty = block('Empty');
    expect(roadmap.startBlock(HUMAN, empty.id).draft).toBeNull();
  });

  it('emits block events with the project id', async () => {
    const b = block();
    roadmap.updateBlock(HUMAN, b.id, { notes: 'n' });
    roadmap.startBlock(HUMAN, b.id);
    await Promise.resolve();
    const mine = h.events.filter((e) => e.type.startsWith('roadmap.block.'));
    expect(mine.map((e) => e.type)).toEqual(['roadmap.block.created', 'roadmap.block.updated', 'roadmap.block.updated']);
    expect(mine.every((e) => (e.payload as { projectId: string }).projectId === h.projectId)).toBe(true);
  });
});
