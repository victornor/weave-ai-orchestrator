import { Hono } from 'hono';
import { nowIso } from '@openconductor/db';
import { OcError, WorkspaceConfigSchema } from '@openconductor/shared';
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
    });
  });

  app.patch('/config', async (c) => {
    const ws = c.get('ws');
    const patch = await body(c, WorkspaceConfigSchema.deepPartial());
    const merged = WorkspaceConfigSchema.safeParse({ ...ws.ctx.config, ...patch });
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

  app.get('/briefing', (c) => c.json(c.get('ws').services.briefing.snapshot()));
  app.post('/transcribe', (c) => transcribe(c as never, deps));

  return app;
}

function statusOf(ws: WorkspaceRuntime): string {
  return ws.ctx.db.get<{ status: string }>('SELECT status FROM workspaces WHERE id = ?', [ws.ctx.workspaceId])?.status ?? 'active';
}
function setStatus(ws: WorkspaceRuntime, status: string): void {
  ws.ctx.db.run('UPDATE workspaces SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), ws.ctx.workspaceId]);
  ws.ctx.events.emit('workspace.updated', 'workspace', ws.id, { status });
}
