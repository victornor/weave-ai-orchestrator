/**
 * VS-110: knowledge context accounting, end to end against real core services (not the fakes) —
 * `weave_knowledge_get` and `weave_knowledge_doc_get` record what they returned, once per distinct
 * document per run.
 */
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

const H = { authorization: 'Bearer sess' };

describe('knowledge context accounting (VS-110)', () => {
  it('records an explicit weave_knowledge_get as a document read', async () => {
    const { deps, harness, services } = boot();
    const app = createApp(deps);
    const ticket = services.tickets.create({ kind: 'human', id: null }, { projectId: harness.projectId, kind: 'task', title: 'Read the shared KB' });
    const agentId = harness.addWorker(ticket.id);
    const runId = 'run_1';
    const token = await signRunToken(runTokenSecret(harness.ctx.db), {
      workspaceId: harness.workspaceId, runId, agentId, agentKind: 'worker', projectId: harness.projectId, ticketId: ticket.id, roleId: harness.roleId,
    });

    const payload = await callTool(app, harness.workspaceId, token, 'weave_knowledge_get', { scope: 'shared' });
    expect(payload.ok).toBe(true);

    const rows = harness.db.all<{ kind: string; scope: string; slug: string | null; tokens: number }>(
      'SELECT kind, scope, slug, tokens FROM knowledge_usage_events WHERE run_id = ?', [runId],
    );
    expect(rows).toEqual([{ kind: 'document', scope: 'shared', slug: null, tokens: payload.data.tokenEstimate }]);
  });

  it('reading the same document twice in one run costs its tokens once', async () => {
    const { deps, harness, services } = boot();
    const app = createApp(deps);
    const ticket = services.tickets.create({ kind: 'human', id: null }, { projectId: harness.projectId, kind: 'task', title: 'Read a doc twice' });
    const agentId = harness.addWorker(ticket.id);
    const runId = 'run_1';
    const token = await signRunToken(runTokenSecret(harness.ctx.db), {
      workspaceId: harness.workspaceId, runId, agentId, agentKind: 'worker', projectId: harness.projectId, ticketId: ticket.id, roleId: harness.roleId,
    });
    services.knowledge.putDoc({ kind: 'agent', id: agentId, runId }, 'project', 'payments-webhooks', '# Payments webhooks\n\nStripe events.\n', harness.projectId);

    const first = await callTool(app, harness.workspaceId, token, 'weave_knowledge_doc_get', { slug: 'payments-webhooks', scope: 'project' });
    await callTool(app, harness.workspaceId, token, 'weave_knowledge_doc_get', { slug: 'payments-webhooks', scope: 'project' });

    const rows = harness.db.all<{ kind: string; scope: string; slug: string | null; tokens: number }>(
      'SELECT kind, scope, slug, tokens FROM knowledge_usage_events WHERE run_id = ?', [runId],
    );
    expect(rows).toEqual([{ kind: 'document', scope: 'project', slug: 'payments-webhooks', tokens: first.data.tokenEstimate }]);
  });

  it('an explicit hub read is recorded separately from a bootstrap hub entry for the same scope', async () => {
    const { deps, harness, services } = boot();
    const app = createApp(deps);
    const ticket = services.tickets.create({ kind: 'human', id: null }, { projectId: harness.projectId, kind: 'task', title: 'Re-read shared' });
    const agentId = harness.addWorker(ticket.id);
    const runId = 'run_1';
    const token = await signRunToken(runTokenSecret(harness.ctx.db), {
      workspaceId: harness.workspaceId, runId, agentId, agentKind: 'worker', projectId: harness.projectId, ticketId: ticket.id, roleId: harness.roleId,
    });
    // Stand in for what the engine's own bootstrap recording would have already written this turn.
    services.knowledgeUsage.recordBootstrap(runId, agentId, ticket.id, [{ scope: 'shared', projectId: null, tokens: 40 }]);

    await callTool(app, harness.workspaceId, token, 'weave_knowledge_get', { scope: 'shared' });

    const rows = harness.db.all<{ kind: string; scope: string }>('SELECT kind, scope FROM knowledge_usage_events WHERE run_id = ? ORDER BY kind', [runId]);
    expect(rows).toEqual([{ kind: 'document', scope: 'shared' }, { kind: 'hub', scope: 'shared' }]);
  });

  it('refuses workspace knowledge to a worker as weaver-only (VS-326)', async () => {
    const { deps, harness, services } = boot();
    const app = createApp(deps);
    const ticket = services.tickets.create({ kind: 'human', id: null }, { projectId: harness.projectId, kind: 'task', title: 'Try the workspace KB' });
    const agentId = harness.addWorker(ticket.id);
    const token = await signRunToken(runTokenSecret(harness.ctx.db), {
      workspaceId: harness.workspaceId, runId: 'run_1', agentId, agentKind: 'worker', projectId: harness.projectId, ticketId: ticket.id, roleId: harness.roleId,
    });

    const payload = await callTool(app, harness.workspaceId, token, 'weave_knowledge_get', { scope: 'workspace' });
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe('forbidden');
    expect(payload.error?.message).toBe('workspace and decisions knowledge are weaver-only');
  });
});

describe('knowledge context routes (VS-110)', () => {
  it('serves a ticket\'s knowledge context', async () => {
    const { deps, harness, services } = boot();
    const app = createApp(deps);
    const ticket = services.tickets.create({ kind: 'human', id: null }, { projectId: harness.projectId, kind: 'task', title: 'Read the shared KB' });
    const worker = harness.addWorker(ticket.id);
    services.knowledgeUsage.recordBootstrap('run_1', worker, ticket.id, [{ scope: 'shared', projectId: null, tokens: 40 }]);
    services.knowledgeUsage.recordRead({ runId: 'run_1', agentId: worker, ticketId: ticket.id, scope: 'project', projectId: harness.projectId, slug: 'doc-a', tokens: 10 });

    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/tickets/${ticket.identifier}/knowledge-usage`, { headers: H }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hubTokens: 40, documentTokens: 10, totalTokens: 50, documents: [{ scope: 'project', projectId: harness.projectId, slug: 'doc-a', tokens: 10 }] });
  });

  it('serves the project summary, top-documents and never-read views', async () => {
    const { deps, harness, services } = boot();
    const app = createApp(deps);
    const worker = harness.addWorker(null);
    services.knowledge.putDoc({ kind: 'human', id: 'v' }, 'project', 'popular-doc', '# Popular doc\n\nEveryone reads this.\n', harness.projectId);
    services.knowledge.putDoc({ kind: 'human', id: 'v' }, 'project', 'unread-doc', '# Unread doc\n\nNobody has opened this.\n', harness.projectId);
    services.knowledgeUsage.recordRead({ runId: 'run_1', agentId: worker, ticketId: null, scope: 'project', projectId: harness.projectId, slug: 'popular-doc', tokens: 10 });
    harness.db.run("UPDATE knowledge_usage_events SET occurred_at = '2020-01-01T00:00:00.000Z'");

    const base = `http://127.0.0.1/api/w/${harness.workspaceId}/knowledge/usage`;
    const summary = await (await app.fetch(new Request(`${base}/summary?project=${harness.projectId}&window=all`, { headers: H }))).json();
    expect(summary).toEqual({ averageTokensPerRun: 10, runs: 1 });

    const top = await (await app.fetch(new Request(`${base}/top?project=${harness.projectId}&window=all`, { headers: H }))).json();
    expect(top).toMatchObject([{ scope: 'project', slug: 'popular-doc', reads: 1, tokens: 10 }]);

    const never = await (await app.fetch(new Request(`${base}/never-read?project=${harness.projectId}&window=all`, { headers: H }))).json();
    expect(never.map((d: { slug: string }) => d.slug)).toEqual(['unread-doc']);
  });
});
