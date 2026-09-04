/**
 * Presentation config (stored in workspace.yaml) and the presenter's handle bookkeeping (§14b).
 * The daemon only stores desired state; the presenter reconciles windows on its own machine.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { PresentationBlockSchema, agentUiStatus } from '@openconductor/shared';
import { nowIso } from '@openconductor/db';
import type { AppDeps, AppEnv } from './types.js';
import { body } from './http.js';

const PresentationSchema = z.object({
  default: z.string().default('headless'),
  conductor: PresentationBlockSchema.optional(),
  workers: PresentationBlockSchema.optional(),
});

export function presentationRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => c.json(c.get('ws').ctx.config.presentation));
  app.put('/', async (c) => {
    const ws = c.get('ws');
    const presentation = await body(c, PresentationSchema);
    const next = { ...ws.ctx.config, presentation };
    await ws.ctx.saveConfig(next);
    ws.ctx.events.emit('presentation.updated', 'workspace', ws.id, presentation);
    return c.json(presentation);
  });
  return app;
}

export function presenterRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Desired state: the conductor, every live worker as an AgentView, and the presentation config. */
  app.get('/desired', (c) => {
    const ws = c.get('ws');
    const s = ws.services;
    const view = (a: ReturnType<typeof s.workers.get>) => ({
      agentId: a.id, workspaceId: ws.id, name: a.name, kind: a.kind, projectId: a.projectId,
      ticketIdentifier: a.ticketId ? safe(() => s.tickets.get(a.ticketId!).identifier) : null,
      roleName: a.roleId ? safe(() => s.roles.get(a.roleId!).name) : null,
      status: a.status, uiStatus: agentUiStatus(a.status),
    });
    const workers = s.workers.list({ status: ['provisioning', 'active', 'running', 'paused', 'error'] }).map(view);
    const conductor = safe(() => view(s.workers.conductor()));
    return c.json({ conductor, workers, config: ws.ctx.config.presentation, surfaces: [...deps.registries.surfaces.keys()] });
  });

  app.put('/:presenterId/handles', async (c) => {
    const ws = c.get('ws');
    const presenterId = c.req.param('presenterId');
    const { handles } = await body(c, z.object({
      handles: z.array(z.object({ agentId: z.string(), surfaceKind: z.string(), handle: z.record(z.string(), z.unknown()) })),
    }));
    const db = ws.ctx.db;
    db.transaction(() => {
      db.run('DELETE FROM surface_handles WHERE presenter_id = ?', [presenterId]);
      for (const h of handles) {
        db.run('INSERT INTO surface_handles (presenter_id, agent_id, surface_kind, handle_json, updated_at) VALUES (?,?,?,?,?)',
          [presenterId, h.agentId, h.surfaceKind, JSON.stringify(h.handle), nowIso()]);
      }
    });
    return c.json({ stored: handles.length });
  });

  app.get('/:presenterId/handles', (c) => c.json(c.get('ws').ctx.db.all(
    'SELECT presenter_id, agent_id, surface_kind, handle_json, updated_at FROM surface_handles WHERE presenter_id = ?',
    [c.req.param('presenterId')],
  )));

  return app;
}

function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }
