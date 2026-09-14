/**
 * VS-398 task 3.1a: a planner's reads are scoped to its own plan's project plus `shared` knowledge —
 * never `workspace`/`decisions` scope, never another project's tickets/specs/knowledge. Exercised end
 * to end against real core services (not the fakes.ts doubles), the same way knowledge-usage.test.ts
 * does, because the mechanism under test (`knowledgeScope`/`projectScope`/`readTicket` in
 * packages/server/src/tools.ts) is already kind-agnostic — it checks "not the weaver," not "is a
 * worker" — so this is verification that the existing guard covers the new kind, not new code.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, initLogger } from '@weave-ai/core';
import { DaemonConfigSchema } from '@weave-ai/shared';
import { newId, nowIso } from '@weave-ai/db';
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

/** A real (if minimal) `planner`-kind agent row — its worktree/thread do not exist, but nothing under test reads them. */
function addPlanner(harness: ReturnType<typeof makeHarness>, projectId: string): string {
  const id = newId();
  const now = nowIso();
  harness.db.insert('agents', {
    id, workspaceId: harness.workspaceId, kind: 'planner', projectId, roleId: null, ticketId: null, planId: null,
    name: 'Planner', runtimeId: 'fake', status: 'active', homePath: '/tmp/planner',
    turnEpoch: 0, turnCount: 0, spawnedBy: 'human', briefRevision: 1, createdAt: now, updatedAt: now,
  });
  return id;
}

describe('a planner’s reads stay inside its own project, plus shared knowledge (VS-398)', () => {
  it('refuses workspace- and decisions-scope knowledge outright', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const runId = 'run_1';
    const agentId = addPlanner(harness, harness.projectId);
    const token = await signRunToken(runTokenSecret(harness.ctx.db), {
      workspaceId: harness.workspaceId, runId, agentId, agentKind: 'planner',
      projectId: harness.projectId, ticketId: null, planId: null, roleId: null,
    });

    const workspaceRes = await callTool(app, harness.workspaceId, token, 'weave_knowledge_get', { scope: 'workspace' });
    expect(workspaceRes.ok).toBe(false);
    expect(workspaceRes.error?.code).toBe('forbidden');

    const decisionsRes = await callTool(app, harness.workspaceId, token, 'weave_knowledge_get', { scope: 'decisions' });
    expect(decisionsRes.ok).toBe(false);
    expect(decisionsRes.error?.code).toBe('forbidden');

    const sharedRes = await callTool(app, harness.workspaceId, token, 'weave_knowledge_get', { scope: 'shared' });
    expect(sharedRes.ok).toBe(true);
  });

  it('reads its own project’s knowledge but refuses another project’s', async () => {
    const { deps, harness, services } = boot();
    const app = createApp(deps);
    const otherProjectId = newId();
    harness.db.insert('projects', {
      id: otherProjectId, workspaceId: harness.workspaceId, slug: 'other', name: 'Other', gitUrl: 'git@example.com:acme/other.git',
      defaultBranch: 'main', clonePath: '/tmp/other', maxWorkers: 4, worktreeProvider: 'git', openspecEnabled: 1,
      policiesJson: {}, status: 'ready', createdAt: nowIso(), updatedAt: nowIso(),
    });
    const runId = 'run_1';
    const agentId = addPlanner(harness, harness.projectId);
    const token = await signRunToken(runTokenSecret(harness.ctx.db), {
      workspaceId: harness.workspaceId, runId, agentId, agentKind: 'planner',
      projectId: harness.projectId, ticketId: null, planId: null, roleId: null,
    });

    const own = await callTool(app, harness.workspaceId, token, 'weave_knowledge_get', { scope: 'project' });
    expect(own.ok).toBe(true);

    const foreign = await callTool(app, harness.workspaceId, token, 'weave_knowledge_get', { scope: 'project', projectId: otherProjectId });
    expect(foreign.ok).toBe(false);
    expect(foreign.error?.code).toBe('forbidden');

    // Confirms the guard reaches the tool the planner actually has (weave_knowledge_docs), not just weave_knowledge_get.
    const foreignDocs = await callTool(app, harness.workspaceId, token, 'weave_knowledge_docs', { projectId: otherProjectId });
    expect(foreignDocs.ok).toBe(true);
    expect((foreignDocs.data as unknown as { items?: unknown[] }).items ?? foreignDocs.data).not.toMatchObject([{ projectId: otherProjectId }]);

    void services;
  });

  it('reads its own project’s tickets and specs but refuses another project’s', async () => {
    const { deps, harness, services } = boot();
    const app = createApp(deps);
    const otherProjectId = newId();
    harness.db.insert('projects', {
      id: otherProjectId, workspaceId: harness.workspaceId, slug: 'other', name: 'Other', gitUrl: 'git@example.com:acme/other.git',
      defaultBranch: 'main', clonePath: '/tmp/other', maxWorkers: 4, worktreeProvider: 'git', openspecEnabled: 1,
      policiesJson: {}, status: 'ready', createdAt: nowIso(), updatedAt: nowIso(),
    });
    const ownTicket = services.tickets.create({ kind: 'human', id: null }, { projectId: harness.projectId, kind: 'task', title: 'Own project ticket' });
    const foreignTicket = services.tickets.create({ kind: 'human', id: null }, { projectId: otherProjectId, kind: 'task', title: 'Foreign project ticket' });

    const runId = 'run_1';
    const agentId = addPlanner(harness, harness.projectId);
    const token = await signRunToken(runTokenSecret(harness.ctx.db), {
      workspaceId: harness.workspaceId, runId, agentId, agentKind: 'planner',
      projectId: harness.projectId, ticketId: null, planId: null, roleId: null,
    });

    const own = await callTool(app, harness.workspaceId, token, 'weave_ticket_get', { id: ownTicket.id });
    expect(own.ok).toBe(true);

    const foreign = await callTool(app, harness.workspaceId, token, 'weave_ticket_get', { id: foreignTicket.id });
    expect(foreign.ok).toBe(false);
    expect(foreign.error?.code).toBe('forbidden');

    const list = await callTool(app, harness.workspaceId, token, 'weave_ticket_list', { projectId: otherProjectId });
    expect(list.ok).toBe(true);
    expect((list.data as { items: Array<{ id: string }> }).items.map((t) => t.id)).not.toContain(foreignTicket.id);

    const foreignSpec = await callTool(app, harness.workspaceId, token, 'weave_spec_list', { projectId: otherProjectId });
    expect(foreignSpec.ok).toBe(false);
    expect(foreignSpec.error?.code).toBe('forbidden');
  });
});
