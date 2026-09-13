/**
 * VS-358: an opted-in project's worker mirrors its knowledge writes into its worktree, at the MCP
 * tool layer — where `mirrorTargetFor` decides whether a call gets a mirror target at all.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, initLogger } from '@weave-ai/core';
import { DaemonConfigSchema } from '@weave-ai/shared';
import { makeHarness } from '../../core/src/testing/context.js';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import type { AppDeps, WorkspaceRuntime } from '../src/types.js';

initLogger(process.env.AC_LOG_LEVEL ?? 'silent');

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; });

function boot() {
  const harness = makeHarness();
  cleanup = harness.cleanup;
  const services = createCore(harness.ctx);
  const runtime: WorkspaceRuntime = { id: harness.workspaceId, ctx: harness.ctx, services, channels: null, webhooks: null, push: null };
  const auth = { hasOperator: () => true, verify: () => ({ sessionId: 's1', operatorId: 'op1', kind: 'cli' as const }), totpEnabled: () => false } as unknown as AppDeps['auth'];
  const deps: AppDeps = {
    auth, daemon: DaemonConfigSchema.parse({}), workspaces: new Map([[harness.workspaceId, runtime]]),
    registries: harness.ctx.registries, listener: 'loopback', publicUrl: 'http://127.0.0.1:7433', version: 'test', uiDir: null,
  };
  return { deps, harness, services };
}

async function callTool(app: ReturnType<typeof createApp>, ws: string, token: string, name: string, input: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown>; error?: { code: string; message: string } }> {
  const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${ws}/agent/tools/${name}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  }));
  return res.json() as Promise<{ ok: boolean; data: Record<string, unknown>; error?: { code: string; message: string } }>;
}

function optIn(harness: ReturnType<typeof makeHarness>): void {
  harness.db.run('UPDATE projects SET knowledge_repo_enabled = 1 WHERE id = ?', [harness.projectId]);
}

async function workerToken(
  harness: ReturnType<typeof makeHarness>,
  services: ReturnType<typeof createCore>,
  over?: Record<string, unknown>,
): Promise<{ token: string; agentId: string; ticketId: string; worktreePath: string | null }> {
  const ticket = services.tickets.create({ kind: 'human', id: null }, { projectId: harness.projectId, kind: 'task', title: 'Note something' });
  const agentId = harness.addWorker(ticket.id, over);
  const agent = harness.db.get<{ worktreePath: string | null }>('SELECT worktree_path AS worktreePath FROM agents WHERE id = ?', [agentId])!;
  const runId = 'run_1';
  // A real worker turn's run row carries the ticket it belongs to (packages/core/src/knowledge/service.ts's
  // provenance lookup reads this) — without it, this write would look ticket-less and wrongly take the
  // weaver's out-of-ticket pull-request path (VS-358) instead of the ordinary ticket-scoped mirror path.
  harness.db.insert('runs', {
    id: runId, workspaceId: harness.workspaceId, agentId, ticketId: ticket.id, runtimeId: 'claude',
    status: 'running', turnEpoch: 0, cwd: agent.worktreePath ?? harness.root, createdAt: new Date().toISOString(),
  });
  const token = await signRunToken(runTokenSecret(harness.ctx.db), {
    workspaceId: harness.workspaceId, runId, agentId, agentKind: 'worker', projectId: harness.projectId, ticketId: ticket.id, roleId: harness.roleId,
  });
  return { token, agentId, ticketId: ticket.id, worktreePath: agent.worktreePath };
}

const mirrorFile = (worktreePath: string, ...rest: string[]): string => join(worktreePath, '.weave', 'knowledge', ...rest);

describe('knowledge repo mirror at the tool layer (VS-358)', () => {
  it('mirrors weave_knowledge_note into the worktree for an opted-in project', async () => {
    const { deps, harness, services } = boot();
    optIn(harness);
    const app = createApp(deps);
    const { token, worktreePath } = await workerToken(harness, services);

    const res = await callTool(app, harness.workspaceId, token, 'weave_knowledge_note', { scope: 'project', section: 'Landmines', text: 'The retry loop never backs off.' });
    expect(res.ok).toBe(true);
    expect(existsSync(mirrorFile(worktreePath!, 'PROJECT.md'))).toBe(true);
    expect(readFileSync(mirrorFile(worktreePath!, 'PROJECT.md'), 'utf8')).toContain('The retry loop never backs off.');
  });

  it('mirrors weave_knowledge_doc_put into the worktree for an opted-in project', async () => {
    const { deps, harness, services } = boot();
    optIn(harness);
    const app = createApp(deps);
    const { token, worktreePath } = await workerToken(harness, services);

    const res = await callTool(app, harness.workspaceId, token, 'weave_knowledge_doc_put', { slug: 'run-engine', body: '# Run engine\n\nOne turn end to end.\n' });
    expect(res.ok).toBe(true);
    expect(readFileSync(mirrorFile(worktreePath!, 'docs/run-engine.md'), 'utf8')).toBe('# Run engine\n\nOne turn end to end.\n');
  });

  it('mirrors weave_knowledge_replace into the worktree for an opted-in project', async () => {
    const { deps, harness, services } = boot();
    optIn(harness);
    const app = createApp(deps);
    const { token, worktreePath } = await workerToken(harness, services);
    const body = services.knowledge.get('project', harness.projectId).body.replace('## Overview', '## Overview\n\nRewritten by curation.');

    const res = await callTool(app, harness.workspaceId, token, 'weave_knowledge_replace', { scope: 'project', body });
    expect(res.ok).toBe(true);
    expect(readFileSync(mirrorFile(worktreePath!, 'PROJECT.md'), 'utf8')).toContain('Rewritten by curation.');
  });

  it('does not mirror for an opted-out project', async () => {
    const { deps, harness, services } = boot();
    const app = createApp(deps);
    const { token, worktreePath } = await workerToken(harness, services);

    const res = await callTool(app, harness.workspaceId, token, 'weave_knowledge_note', { scope: 'project', section: 'Landmines', text: 'Not mirrored: this project never opted in.' });
    expect(res.ok).toBe(true);
    expect(existsSync(mirrorFile(worktreePath!, 'PROJECT.md'))).toBe(false);
  });

  it('does not mirror for a worker with no worktree', async () => {
    const { deps, harness, services } = boot();
    optIn(harness);
    const app = createApp(deps);
    const { token } = await workerToken(harness, services, { worktreePath: null });

    const res = await callTool(app, harness.workspaceId, token, 'weave_knowledge_note', { scope: 'project', section: 'Landmines', text: 'Not mirrored: no worktree at all.' });
    expect(res.ok).toBe(true);
    // No worktree path to check under — the assertion is simply that the call succeeded without one.
  });

  it('does not mirror for the weaver', async () => {
    const { deps, harness, services } = boot();
    optIn(harness);
    const app = createApp(deps);
    const token = await signRunToken(runTokenSecret(harness.ctx.db), {
      workspaceId: harness.workspaceId, runId: 'run_1', agentId: harness.conductorId, agentKind: 'weaver', projectId: null, ticketId: null, roleId: null,
    });

    const res = await callTool(app, harness.workspaceId, token, 'weave_knowledge_note', { scope: 'project', projectId: harness.projectId, section: 'Landmines', text: 'Not mirrored: the weaver has no worktree.' });
    expect(res.ok).toBe(true);
  });
});
