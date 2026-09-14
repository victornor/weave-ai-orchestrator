/**
 * A project's roadmap (VS-397): durable future ideas that are not tickets. Each item belongs to one
 * project, carries a `title`, markdown `notes`, a dense manual `position`, a status
 * (`idea`|`planned`|`dropped`) and an optional linked ticket. See
 * `openspec/changes/vs-397-projects-have-no-roadmap-give-each-proje`.
 */
import { newId, nowIso } from '@weave-ai/db';
import { OcError, ROADMAP_STATUSES, type RoadmapItem, type RoadmapStatus } from '@weave-ai/shared';
import type { Actor, CoreServices, RoadmapCreateInput, RoadmapPatch, RoadmapService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { tx } from '../tickets/tx.js';

function isStatus(v: unknown): v is RoadmapStatus {
  return (ROADMAP_STATUSES as readonly string[]).includes(String(v));
}

export function createRoadmapService(ctx: WorkspaceContext, deps: () => CoreServices): RoadmapService {
  const db = ctx.db;
  const ws = ctx.workspaceId;

  /** The row as returned to callers: the stored columns plus this workspace's id. */
  const asItem = (row: Omit<RoadmapItem, 'workspaceId'>): RoadmapItem => ({ ...row, workspaceId: ws });

  const get = (itemId: string): RoadmapItem => {
    const row = db.get<Omit<RoadmapItem, 'workspaceId'>>('SELECT * FROM roadmap_items WHERE id = ?', [itemId]);
    if (!row) throw new OcError('not_found', `roadmap item ${itemId} not found`);
    return asItem(row);
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

  return {
    list(projectId) {
      const pid = resolveProject(projectId);
      return db.all<Omit<RoadmapItem, 'workspaceId'>>(
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
        id, projectId: pid, title, notes: input.notes ?? '', position: nextPosition(pid), status,
        ticketId: input.ticketId ?? null, createdByKind: actor.kind, createdById: actor.id, createdAt: now, updatedAt: now,
      });
      const item = get(id);
      ctx.events.emit('roadmap.created', 'roadmap', id, { projectId });
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
  };
}
