/**
 * A project's roadmap (VS-397): durable future ideas that are not tickets. Each item belongs to one
 * project, carries a `title`, markdown `notes`, a dense manual `position`, a status
 * (`idea`|`planned`|`dropped`) and an optional linked ticket.
 *
 * VS-478 grows it into blocks: ordered, named groups of **pending tickets** — items carrying the
 * fields a real ticket needs (`description`, `kind`, `priority`, `roleId`) and a `blockId`. The
 * weaver builds a block up, bundles related items by merging them, and starts the block, which
 * returns one filing-ready draft for the whole block (VS-557); `done` is derived from the block's
 * linked tickets, never stored. An item with no block is a loose item and keeps VS-397's behaviour.
 *
 * See `openspec/changes/vs-478-roadmap-blocks-group-pending-tickets-int`.
 */
import { newId, nowIso } from '@weave-ai/db';
import {
  OcError,
  ROADMAP_BLOCK_STATUSES,
  ROADMAP_STATUSES,
  TICKET_KINDS,
  TICKET_PRIORITIES,
  roadmapBlockStatus,
  type RoadmapBlock,
  type RoadmapBlockDraft,
  type RoadmapBlockStoredStatus,
  type RoadmapItem,
  type RoadmapMergeRecord,
  type RoadmapStatus,
  type TicketStatus,
} from '@weave-ai/shared';
import type {
  Actor,
  CoreServices,
  RoadmapBlockCreateInput,
  RoadmapBlockPatch,
  RoadmapBlockStart,
  RoadmapCreateInput,
  RoadmapItemCreateInput,
  RoadmapItemPatch,
  RoadmapPatch,
  RoadmapService,
} from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { tx } from '../tickets/tx.js';

/** A roadmap item row as stored: the columns, before the workspace id is added. */
type ItemRow = Omit<RoadmapItem, 'workspaceId'>;
/** A block row as stored: the columns, before status derivation, items and the workspace id. */
type BlockRow = Omit<RoadmapBlock, 'workspaceId' | 'reportedStatus' | 'items'>;

const isStatus = (v: unknown): v is RoadmapStatus => (ROADMAP_STATUSES as readonly string[]).includes(String(v));
const isBlockStatus = (v: unknown): v is RoadmapBlockStoredStatus =>
  (ROADMAP_BLOCK_STATUSES as readonly string[]).includes(String(v));

/**
 * One filing-ready draft for a whole block (VS-557): starting a block files **one ticket** by
 * default, so the draft carries every item as a section and the ids it covers. Kind and role are the
 * items' own only when they all agree; a disagreement is a named split reason for the weaver, so the
 * draft falls back to `change`/null rather than inventing an owner. Priority is the most urgent item,
 * so nothing is filed as less urgent than it is.
 */
function mergeBlockDraft(block: RoadmapBlock, items: ItemRow[]): RoadmapBlockDraft {
  const first = items[0]!;
  const agree = <T>(pick: (item: ItemRow) => T): T | null =>
    items.every((item) => pick(item) === pick(first)) ? pick(first) : null;
  const priority = items.reduce(
    (best, item) => (TICKET_PRIORITIES.indexOf(item.priority) < TICKET_PRIORITIES.indexOf(best) ? item.priority : best),
    first.priority,
  );
  const description = items
    .map((item) => `### ${item.title}\n\n${item.description.trim() || '_No description yet._'}`)
    .join('\n\n');
  return {
    title: block.title,
    description,
    kind: agree((item) => item.kind) ?? 'change',
    priority,
    roleId: agree((item) => item.roleId),
    itemIds: items.map((item) => item.id),
  };
}

export function createRoadmapService(ctx: WorkspaceContext, deps: () => CoreServices): RoadmapService {
  const db = ctx.db;
  const ws = ctx.workspaceId;

  /** The row as returned to callers: the stored columns plus this workspace's id. */
  const asItem = (row: ItemRow): RoadmapItem => ({ ...row, workspaceId: ws });

  const get = (itemId: string): RoadmapItem => {
    const row = db.get<ItemRow>('SELECT * FROM roadmap_items WHERE id = ?', [itemId]);
    if (!row) throw new OcError('not_found', `roadmap item ${itemId} not found`);
    return asItem(row);
  };

  const getBlockRow = (blockId: string): BlockRow => {
    const row = db.get<BlockRow>('SELECT * FROM roadmap_blocks WHERE id = ?', [blockId]);
    if (!row) throw new OcError('not_found', `roadmap block ${blockId} not found`);
    return row;
  };

  /**
   * The project's canonical id, accepting either the slug or the id (VS-397 review). Every method
   * resolves through here before touching `project_id`, so a caller that names a project by slug —
   * which the weaver normally does — stores and queries the same id the row's foreign key requires.
   * A project that does not exist is `not_found`.
   */
  const resolveProject = (projectId: string): string => {
    if (!projectId) throw new OcError('validation', 'projectId is required');
    return deps().projects.get(projectId).id;
  };

  const requireTitle = (title: string): string => {
    const trimmed = title.trim();
    if (!trimmed) throw new OcError('validation', 'title is required');
    return trimmed;
  };

  const requireTicket = (ticketId: string, projectId: string): void => {
    const ticket = deps().tickets.get(ticketId);
    if (ticket.projectId !== projectId) throw new OcError('not_found', `ticket ${ticketId} is not in this project`);
  };

  const requireRole = (roleId: string, projectId: string): void => {
    const role = deps().roles.get(roleId);
    if (role.projectId !== projectId) throw new OcError('not_found', `role ${roleId} is not in this project`);
  };

  /** A block of the item's own project, or `not_found`. */
  const requireBlock = (blockId: string, projectId: string): BlockRow => {
    const row = getBlockRow(blockId);
    if (row.projectId !== projectId) throw new OcError('not_found', `roadmap block ${blockId} is not in this project`);
    return row;
  };

  const requireKind = (kind: unknown): void => {
    if (!(TICKET_KINDS as readonly string[]).includes(String(kind))) {
      throw new OcError('validation', `kind must be ${TICKET_KINDS.join('|')}`);
    }
  };

  const requirePriority = (priority: unknown): void => {
    if (!(TICKET_PRIORITIES as readonly string[]).includes(String(priority))) {
      throw new OcError('validation', `priority must be ${TICKET_PRIORITIES.join('|')}`);
    }
  };

  /** A project's item ids in listing order. */
  const orderedIds = (projectId: string): string[] =>
    db.all<{ id: string }>(
      'SELECT id FROM roadmap_items WHERE project_id = ? ORDER BY position, created_at, id',
      [projectId],
    ).map((r) => r.id);

  /** Renumber a project's items densely from the given order. */
  const renumber = (ids: string[], now: string): void => {
    ids.forEach((id, i) => db.update('roadmap_items', id, { position: i, updatedAt: now }));
  };

  /** A project's block ids in listing order. */
  const orderedBlockIds = (projectId: string): string[] =>
    db.all<{ id: string }>(
      'SELECT id FROM roadmap_blocks WHERE project_id = ? ORDER BY position, created_at, id',
      [projectId],
    ).map((r) => r.id);

  const renumberBlocks = (ids: string[], now: string): void => {
    ids.forEach((id, i) => db.update('roadmap_blocks', id, { position: i, updatedAt: now }));
  };

  /** The listing order with `movedId` placed at `position`, clamped to the list. */
  const withPlaced = (ids: string[], movedId: string, position: number): string[] => {
    const rest = ids.filter((id) => id !== movedId);
    rest.splice(Math.max(0, Math.min(Math.trunc(position), rest.length)), 0, movedId);
    return rest;
  };

  const nextPosition = (projectId: string): number => {
    const row = db.get<{ n: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM roadmap_items WHERE project_id = ?', [projectId]);
    return Number(row?.n ?? 0);
  };

  const nextBlockPosition = (projectId: string): number => {
    const row = db.get<{ n: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM roadmap_blocks WHERE project_id = ?', [projectId]);
    return Number(row?.n ?? 0);
  };

  const itemsOfBlock = (blockId: string): ItemRow[] =>
    db.all<ItemRow>('SELECT * FROM roadmap_items WHERE block_id = ? ORDER BY position, created_at, id', [blockId]);

  /** The status of an item's linked ticket, or null when it has none. */
  const linkedStatus = (item: ItemRow): TicketStatus | null => {
    if (!item.ticketId) return null;
    try {
      return deps().tickets.get(item.ticketId).status;
    } catch {
      // A ticket link is ON DELETE SET NULL, so a dangling link is not expected; treat one as unlinked.
      return null;
    }
  };

  const asBlock = (row: BlockRow): RoadmapBlock => {
    const items = itemsOfBlock(row.id).map(asItem);
    return {
      ...row,
      workspaceId: ws,
      reportedStatus: roadmapBlockStatus(row.status, items.map(linkedStatus)),
      items,
    };
  };

  return {
    list(projectId) {
      const pid = resolveProject(projectId);
      return db.all<ItemRow>(
        'SELECT * FROM roadmap_items WHERE project_id = ? ORDER BY position, created_at, id',
        [pid],
      ).map(asItem);
    },

    get,

    create(actor, projectId, input: RoadmapCreateInput) {
      const pid = resolveProject(projectId);
      const title = requireTitle(input.title);
      const status: RoadmapStatus = input.status ?? 'idea';
      if (!isStatus(status)) throw new OcError('validation', `status must be ${ROADMAP_STATUSES.join('|')}`);
      if (input.ticketId) requireTicket(input.ticketId, pid);
      const now = nowIso();
      const id = newId();
      db.insert('roadmap_items', {
        id, projectId: pid, blockId: null, title, notes: input.notes ?? '', description: '',
        kind: 'change', priority: 'medium', roleId: null, position: nextPosition(pid), status,
        ticketId: input.ticketId ?? null, createdByKind: actor.kind, createdById: actor.id, createdAt: now, updatedAt: now,
      });
      const item = get(id);
      ctx.events.emit('roadmap.created', 'roadmap', id, { projectId: pid });
      return item;
    },

    update(actor, itemId, patch: RoadmapPatch) {
      const current = get(itemId);
      const fields: Record<string, unknown> = {};
      if (patch.title !== undefined) fields.title = requireTitle(patch.title);
      if (patch.notes !== undefined) fields.notes = patch.notes;
      if (patch.status !== undefined) {
        if (!isStatus(patch.status)) throw new OcError('validation', `status must be ${ROADMAP_STATUSES.join('|')}`);
        fields.status = patch.status;
      }
      if (patch.ticketId !== undefined) {
        if (patch.ticketId === null) fields.ticketId = null;
        else { requireTicket(patch.ticketId, current.projectId); fields.ticketId = patch.ticketId; }
      }
      const now = nowIso();
      tx(db, () => {
        if (Object.keys(fields).length) db.update('roadmap_items', itemId, { ...fields, updatedAt: now });
        if (patch.position !== undefined) renumber(withPlaced(orderedIds(current.projectId), itemId, patch.position), now);
      });
      const item = get(itemId);
      ctx.events.emit('roadmap.updated', 'roadmap', itemId, { projectId: current.projectId });
      return item;
    },

    remove(actor, itemId) {
      const current = get(itemId);
      tx(db, () => {
        db.run('DELETE FROM roadmap_items WHERE id = ?', [itemId]);
        renumber(orderedIds(current.projectId), nowIso());
      });
      ctx.events.emit('roadmap.removed', 'roadmap', itemId, { projectId: current.projectId });
    },

    listBlocks(projectId) {
      const pid = resolveProject(projectId);
      return db.all<BlockRow>('SELECT * FROM roadmap_blocks WHERE project_id = ? ORDER BY position, created_at, id', [pid]).map(asBlock);
    },

    getBlock(blockId) {
      return asBlock(getBlockRow(blockId));
    },

    createBlock(actor, projectId, input: RoadmapBlockCreateInput) {
      const pid = resolveProject(projectId);
      const title = requireTitle(input.title);
      const now = nowIso();
      const id = newId();
      db.insert('roadmap_blocks', {
        id, projectId: pid, title, notes: input.notes ?? '', position: nextBlockPosition(pid),
        status: 'open', startedAt: null, createdByKind: actor.kind, createdById: actor.id, createdAt: now, updatedAt: now,
      });
      ctx.events.emit('roadmap.block.created', 'roadmap', id, { projectId: pid });
      return asBlock(getBlockRow(id));
    },

    updateBlock(actor, blockId, patch: RoadmapBlockPatch) {
      const current = getBlockRow(blockId);
      const fields: Record<string, unknown> = {};
      if (patch.title !== undefined) fields.title = requireTitle(patch.title);
      if (patch.notes !== undefined) fields.notes = patch.notes;
      if (patch.status !== undefined) {
        if (!isBlockStatus(patch.status)) throw new OcError('validation', `status must be ${ROADMAP_BLOCK_STATUSES.join('|')}`);
        fields.status = patch.status;
      }
      const now = nowIso();
      tx(db, () => {
        if (Object.keys(fields).length) db.update('roadmap_blocks', blockId, { ...fields, updatedAt: now });
        if (patch.position !== undefined) renumberBlocks(withPlaced(orderedBlockIds(current.projectId), blockId, patch.position), now);
      });
      ctx.events.emit('roadmap.block.updated', 'roadmap', blockId, { projectId: current.projectId });
      return asBlock(getBlockRow(blockId));
    },

    startBlock(actor, blockId): RoadmapBlockStart {
      const current = getBlockRow(blockId);
      if (current.status === 'dropped') throw new OcError('validation', 'a dropped block cannot be started');
      const now = nowIso();
      if (current.status !== 'started') {
        db.update('roadmap_blocks', blockId, { status: 'started', startedAt: now, updatedAt: now });
        ctx.events.emit('roadmap.block.updated', 'roadmap', blockId, { projectId: current.projectId });
      }
      const block = asBlock(getBlockRow(blockId));
      const items = itemsOfBlock(blockId).filter((item) => item.ticketId === null);
      return { block, draft: items.length ? mergeBlockDraft(block, items) : null };
    },

    addItem(actor, input: RoadmapItemCreateInput) {
      const block = getBlockRow(input.blockId);
      const projectId = block.projectId;
      const title = requireTitle(input.title);
      const kind = input.kind ?? 'change';
      requireKind(kind);
      const priority = input.priority ?? 'medium';
      requirePriority(priority);
      if (input.roleId) requireRole(input.roleId, projectId);
      const now = nowIso();
      const id = newId();
      db.insert('roadmap_items', {
        id, projectId, blockId: block.id, title, notes: input.notes ?? '', description: input.description ?? '',
        kind: kind as string, priority: priority as string, roleId: input.roleId ?? null, position: nextPosition(projectId),
        status: 'planned', ticketId: null, createdByKind: actor.kind, createdById: actor.id, createdAt: now, updatedAt: now,
      });
      ctx.events.emit('roadmap.created', 'roadmap', id, { projectId });
      return get(id);
    },

    updateItem(actor, itemId, patch: RoadmapItemPatch) {
      const current = get(itemId);
      const fields: Record<string, unknown> = {};
      if (patch.title !== undefined) fields.title = requireTitle(patch.title);
      if (patch.notes !== undefined) fields.notes = patch.notes;
      if (patch.description !== undefined) fields.description = patch.description;
      if (patch.status !== undefined) {
        if (!isStatus(patch.status)) throw new OcError('validation', `status must be ${ROADMAP_STATUSES.join('|')}`);
        fields.status = patch.status;
      }
      if (patch.kind !== undefined) { requireKind(patch.kind); fields.kind = patch.kind; }
      if (patch.priority !== undefined) { requirePriority(patch.priority); fields.priority = patch.priority; }
      if (patch.roleId !== undefined) {
        if (patch.roleId === null) fields.roleId = null;
        else { requireRole(patch.roleId, current.projectId); fields.roleId = patch.roleId; }
      }
      if (patch.blockId !== undefined) {
        if (patch.blockId === null) fields.blockId = null;
        else { requireBlock(patch.blockId, current.projectId); fields.blockId = patch.blockId; }
      }
      if (patch.ticketId !== undefined) {
        if (patch.ticketId === null) fields.ticketId = null;
        else { requireTicket(patch.ticketId, current.projectId); fields.ticketId = patch.ticketId; }
      }
      const now = nowIso();
      tx(db, () => {
        if (Object.keys(fields).length) db.update('roadmap_items', itemId, { ...fields, updatedAt: now });
        // An explicit position reorders the project's list; a bare move places the item at the end of
        // its new group. Either way the project's item order stays dense and unique.
        if (patch.position !== undefined) renumber(withPlaced(orderedIds(current.projectId), itemId, patch.position), now);
        else if (patch.blockId !== undefined) renumber(withPlaced(orderedIds(current.projectId), itemId, orderedIds(current.projectId).length), now);
      });
      ctx.events.emit('roadmap.updated', 'roadmap', itemId, { projectId: current.projectId });
      return get(itemId);
    },

    mergeItems(actor, itemIds: string[]) {
      if (!Array.isArray(itemIds) || itemIds.length < 2) throw new OcError('validation', 'merging needs at least two items');
      const items = itemIds.map(get);
      const projectId = items[0]!.projectId;
      if (items.some((i) => i.projectId !== projectId)) throw new OcError('validation', 'merge items must belong to one project');
      if (items.some((i) => i.ticketId !== null)) throw new OcError('validation', 'an item already linked to a ticket cannot be merged');
      const survivor = items[0]!;
      const absorbed = items.slice(1);
      const now = nowIso();
      const combined = [
        survivor.description,
        ...absorbed.map((i) => `### Merged: ${i.title}\n\n${i.description}`.trimEnd()),
      ].filter((s) => s.length > 0).join('\n\n');
      tx(db, () => {
        db.update('roadmap_items', survivor.id, { description: combined, updatedAt: now });
        for (const item of absorbed) {
          db.insert('roadmap_item_merges', {
            id: newId(), itemId: survivor.id, sourceItemId: item.id, sourceTitle: item.title,
            sourceDescription: item.description, mergedByKind: actor.kind, mergedById: actor.id, mergedAt: now,
          });
          db.run('DELETE FROM roadmap_items WHERE id = ?', [item.id]);
        }
        renumber(orderedIds(projectId), now);
      });
      ctx.events.emit('roadmap.updated', 'roadmap', survivor.id, { projectId });
      return get(survivor.id);
    },

    merges(itemId: string) {
      get(itemId);
      return db.all<RoadmapMergeRecord>('SELECT * FROM roadmap_item_merges WHERE item_id = ? ORDER BY merged_at, id', [itemId]);
    },
  };
}
