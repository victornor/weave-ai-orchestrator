import { spawn } from 'node:child_process';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { OcError } from '@agent-conductor/shared';
import { detectHostToolsCached, getLogger } from '@agent-conductor/core';
import type { AppDeps, AppEnv } from '../types.js';
import { body } from '../http.js';

const log = getLogger('http', { component: 'daemon-routes' });

/** Workspace registration/creation is a daemon-lifecycle concern; the daemon injects it. */
export interface WorkspaceAdmin {
  unregister(id: string): Promise<{ ok: true; id: string }>;
  register(path: string): Promise<{ id: string; path: string }>;
  init(input: { path: string; id: string; name: string; ticketPrefix: string }): Promise<{ id: string; path: string }>;
  importPackage(input: { path: string; target: string }): Promise<{ id: string; path: string; created: boolean; roles: number; knowledgeFiles: number; tickets: number; skipped: number }>;
}

/** `~` and `~/x` mean the daemon user's home; anything else resolves against the daemon's cwd. */
function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return resolve(p);
}

/** A workspace is registered under both its slug and its db id; list it once. */
const uniqueWorkspaces = (deps: AppDeps) => [...new Set(deps.workspaces.values())];

export function daemonRoutes(deps: AppDeps, admin: WorkspaceAdmin | null): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/health', async (c) => c.json({
    ok: true,
    version: deps.version,
    workspaces: uniqueWorkspaces(deps).map((w) => ({ id: w.id, name: w.ctx.config.name, status: 'active' })),
    operatorConfigured: deps.auth.hasOperator(),
    tlsMode: deps.daemon.http.tls.mode,
    publicUrl: deps.publicUrl,
    transcription: { configured: deps.daemon.transcription.provider === 'command' && Boolean(deps.daemon.transcription.command) },
    host: { platform: process.platform, hostname: hostname(), home: homedir(), defaultWorkspaceRoot: join(homedir(), 'agent-conductor'), tools: await detectHostToolsCached() },
  }));

  app.get('/workspaces', (c) => c.json(uniqueWorkspaces(deps).map((w) => ({
    id: w.id, name: w.ctx.config.name, ticketPrefix: w.ctx.config.ticketPrefix, root: w.ctx.paths.root,
    projects: w.ctx.config.projects.map((p) => p.id),
  }))));

  app.post('/workspaces', async (c) => {
    if (!admin) throw new OcError('internal', 'workspace registration is not available on this listener');
    const { path } = await body(c, z.object({ path: z.string().min(1) }));
    return c.json(await admin.register(path), 201);
  });

  app.delete('/workspaces/:id', async (c) => {
    if (!admin) throw new OcError('internal', 'workspace registration is not available on this listener');
    return c.json(await admin.unregister(c.req.param('id')));
  });

  app.post('/workspaces/init', async (c) => {
    if (!admin) throw new OcError('internal', 'workspace creation is not available on this listener');
    const input = await body(c, z.object({
      /** Absolute, `~`-prefixed, or omitted (→ `~/agent-conductor/<id>`). Always on the daemon host. */
      path: z.string().min(1).optional(), id: z.string().min(1), name: z.string().min(1),
      ticketPrefix: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
    }));
    const path = expandHome(input.path ?? join('~', 'agent-conductor', input.id));
    return c.json(await admin.init({ ...input, path }), 201);
  });

  /** PLAN §20 `conductor workspace import`: stage an export into `target`, register it, and land its tickets in the backlog. */
  app.post('/workspaces/import', async (c) => {
    if (!admin) throw new OcError('internal', 'workspace import is not available on this listener');
    const input = await body(c, z.object({ path: z.string().min(1), target: z.string().min(1) }));
    return c.json(await admin.importPackage(input), 201);
  });

  app.get('/runtimes', async (c) => {
    const out = [];
    for (const [id, adapter] of deps.registries.runtimes) {
      const detection = await adapter.detect().catch((e: unknown) => ({ status: 'broken' as const, notes: String(e) }));
      out.push({ id, displayName: adapter.displayName, detection, capabilities: adapter.capabilities, models: [] as unknown[] });
    }
    return c.json(out);
  });

  app.get('/runtimes/:id/models', async (c) => {
    const adapter = deps.registries.runtimes.get(c.req.param('id'));
    if (!adapter) throw new OcError('not_found', `runtime ${c.req.param('id')} is not registered`);
    return c.json(await adapter.listModels());
  });

  app.post('/transcribe', (c) => transcribe(c, deps));

  /**
   * Upgrade support (PLAN §20 `conductor daemon upgrade`): stop dispatching new turns everywhere and
   * wait for in-flight ones, bounded. Nothing is persisted, so a restart comes back dispatching;
   * `undrain` is for the case where the restart never happens.
   */
  app.post('/daemon/drain', async (c) => {
    const { timeoutSec } = await body(c, z.object({ timeoutSec: z.number().int().min(0).max(3600).default(180) }));
    const all = uniqueWorkspaces(deps);
    const deadline = Date.now() + timeoutSec * 1000;
    const stops = all.map((w) => w.services.dispatcher.stop().catch(() => undefined));
    await Promise.race([Promise.all(stops), new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now())))]);
    const running = all.flatMap((w) => {
      try { return w.services.runs.list({ status: ['running', 'queued'] }).items.map((r) => ({ workspace: w.id, runId: r.id })); } catch { return []; }
    });
    return c.json({ drained: running.length === 0, running, workspaces: all.map((w) => w.id) });
  });

  app.post('/daemon/undrain', (c) => {
    const resumed: string[] = [];
    for (const w of uniqueWorkspaces(deps)) {
      const status = w.ctx.db.get<{ status: string }>('SELECT status FROM workspaces WHERE id = ?', [w.ctx.workspaceId])?.status ?? 'active';
      if (status !== 'paused') { w.services.dispatcher.start(); resumed.push(w.id); }
    }
    return c.json({ resumed });
  });
  return app;
}

/**
 * Audio → text. 501 unless `daemon.transcription.provider === 'command'`, in which case the raw
 * audio bytes are piped to the configured command's stdin and its stdout is the transcript.
 */
export async function transcribe(c: { req: { raw: Request }; json: (v: unknown, s?: number) => Response }, deps: AppDeps): Promise<Response> {
  const cfg = deps.daemon.transcription;
  if (cfg.provider !== 'command' || !cfg.command) {
    return c.json({ error: { code: 'internal', message: 'no transcription provider is configured on the daemon host', retryable: false } }, 501);
  }
  const audio = await readAudio(c.req.raw);
  if (!audio.byteLength) throw new OcError('validation', 'no audio in the request body');
  const text = await runCommand(cfg.command, audio);
  return c.json({ text });
}

/** Accepts either `multipart/form-data` with an `audio`/`file` field or a raw audio body. */
async function readAudio(req: Request): Promise<Buffer> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    const part = form.get('audio') ?? form.get('file');
    if (part && typeof part !== 'string') return Buffer.from(await part.arrayBuffer());
    throw new OcError('validation', 'multipart body has no audio field');
  }
  return Buffer.from(await req.arrayBuffer());
}

function runCommand(command: string, audio: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { err += d; });
    child.on('error', (e) => reject(new OcError('internal', `transcription command failed: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) return resolve(out.trim());
      log.warn({ code, err: err.slice(0, 500) }, 'transcription command failed');
      reject(new OcError('internal', `transcription command exited with ${code}`));
    });
    child.stdin.end(audio);
  });
}
