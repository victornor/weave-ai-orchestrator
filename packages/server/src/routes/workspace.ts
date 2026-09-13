import { resolve } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { nowIso } from '@weave-ai/db';
import { exportWorkspace } from '@weave-ai/core';
import { OcError, WorkspaceConfigSchema } from '@weave-ai/shared';
import type { AppDeps, AppEnv, WorkspaceRuntime } from '../types.js';
import { body } from '../http.js';
import { transcribe } from './daemon.js';

/** Workspace-level routes: summary, config, pause/resume, briefing, transcription. */
export function workspaceRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const ws = c.get('ws');
    return c.json({
      id: ws.id, name: ws.ctx.config.name, ticketPrefix: ws.ctx.config.ticketPrefix, root: ws.ctx.paths.root, rootPath: ws.ctx.paths.root,
      status: statusOf(ws), config: ws.ctx.config, loopbackUrl: ws.ctx.loopbackUrl,
      channels: [...Object.keys(ws.ctx.config.channels)],
      // VS-334: this workspace's own loaded plugins — workspace-configured and daemon-wide alike —
      // for the Settings management list and the web app's "Plugins" nav section / page route.
      plugins: ws.ctx.plugins.loaded,
    });
  });

  app.patch('/config', async (c) => {
    const ws = c.get('ws');
    // The patch is merged raw: parsing it against the config schema first would fill every key the
    // client left out with that key's default, and the merge would then write those over the config.
    const patch = await body(c, z.record(z.string(), z.unknown()));
    const merged = WorkspaceConfigSchema.safeParse(deepMerge(ws.ctx.config, patch));
    if (!merged.success) throw new OcError('validation', 'the patched workspace config is invalid', { issues: merged.error.issues });
    await ws.ctx.saveConfig(merged.data);
    ws.ctx.events.emit('workspace.updated', 'workspace', ws.id, { config: merged.data });
    return c.json(merged.data);
  });

  app.post('/pause', async (c) => {
    const ws = c.get('ws');
    await ws.services.dispatcher.stop();
    setStatus(ws, 'paused');
    return c.json({ id: ws.id, status: 'paused' });
  });

  app.post('/resume', (c) => {
    const ws = c.get('ws');
    ws.services.dispatcher.start();
    setStatus(ws, 'active');
    return c.json({ id: ws.id, status: 'active' });
  });

  /** PLAN §20: a portable package — workspace.yaml, roles, knowledge and tickets as markdown. No db, no runs, no secrets. */
  app.post('/export', async (c) => {
    const ws = c.get('ws');
    const { out } = await body(c, z.object({ out: z.string().min(1).optional() }));
    return c.json(exportWorkspace(ws.ctx, out ? { out: resolve(out) } : {}), 201);
  });

  app.get('/briefing', (c) => c.json(c.get('ws').services.briefing.snapshot()));
  app.post('/transcribe', (c) => transcribe(c as never, deps));

  return app;
}

/**
 * Merge a config patch key by key. A shallow spread would replace a whole block — `defaults`,
 * `weaver`, `presentation` — and the schema would then refill the keys the client did not send
 * with their defaults, silently resetting settings nobody touched. Lists are replaced wholesale.
 */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function statusOf(ws: WorkspaceRuntime): string {
  return ws.ctx.db.get<{ status: string }>('SELECT status FROM workspaces WHERE id = ?', [ws.ctx.workspaceId])?.status ?? 'active';
}
function setStatus(ws: WorkspaceRuntime, status: string): void {
  ws.ctx.db.run('UPDATE workspaces SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), ws.ctx.workspaceId]);
  ws.ctx.events.emit('workspace.updated', 'workspace', ws.id, { status });
}
