/**
 * VS-499: incident reads span every workspace, while ticket and knowledge reads stay inside the
 * caller's own workspace. Exercised end to end against two real workspaces (each with its own
 * database and state directory, the `plannerScoping.test.ts` pattern) plus one daemon-level incidents
 * database, because the property under test is precisely which reads cross the workspace boundary.
 *
 * The ticket/knowledge half is the "widening is incidents-only" guard: those services resolve against
 * the caller's own workspace db, so a row that exists only in workspace A is unreachable from B. It
 * proves the incidents change did not disturb that. (Decisions have no cross-workspace read tool at
 * all — they are read through `weave_inbox`, which is per-workspace — so there is nothing to assert
 * against the tool surface here; the same db boundary covers them.)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, createIncidentsService, initLogger } from '@weave-ai/core';
import { DaemonConfigSchema } from '@weave-ai/shared';
import { openDb } from '@weave-ai/db';
import { makeHarness } from '../../core/src/testing/context.js';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import type { AppDeps, WorkspaceRuntime } from '../src/types.js';

initLogger(process.env.AC_LOG_LEVEL ?? 'silent');

let cleanups: Array<() => void> = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });

/** A real workspace with its own db/state, named so a human-readable incident tag can be asserted. */
function workspace(name: string) {
  const harness = makeHarness({ config: { name } });
  cleanups.push(harness.cleanup);
  const services = createCore(harness.ctx);
  const runtime: WorkspaceRuntime = { id: harness.workspaceId, ctx: harness.ctx, services, channels: null, webhooks: null, push: null };
  return { harness, services, runtime };
}

async function callTool(app: ReturnType<typeof createApp>, ws: string, token: string, name: string, input: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown>; error?: { code: string; message: string } }> {
  const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${ws}/agent/tools/${name}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  }));
  return res.json() as Promise<{ ok: boolean; data: Record<string, unknown>; error?: { code: string; message: string } }>;
}

describe('incident reads span workspaces; other reads do not (VS-499)', () => {
  it('workspace B lists, reads and resolves workspace A\'s incident, naming both workspaces', async () => {
    const a = workspace('V OFM');
    const b = workspace('Sideprojects');
    const daemonDb = openDb(':memory:');
    cleanups.push(() => daemonDb.close());

    const deps = {
      auth: { hasOperator: () => true, verify: () => ({ sessionId: 's1', operatorId: 'op1', kind: 'cli' as const }), totpEnabled: () => false },
      daemon: DaemonConfigSchema.parse({}), workspaces: new Map([[a.runtime.id, a.runtime], [b.runtime.id, b.runtime]]),
      registries: a.harness.ctx.registries, listener: 'loopback' as const, publicUrl: 'http://127.0.0.1:7433',
      version: 'test', uiDir: null, incidents: createIncidentsService(daemonDb),
    } as unknown as AppDeps;
    const app = createApp(deps);

    const tokenA = await signRunToken(runTokenSecret(a.harness.ctx.db), {
      workspaceId: a.harness.workspaceId, runId: 'run_a', agentId: a.harness.conductorId, agentKind: 'weaver',
      projectId: a.harness.projectId, ticketId: null, roleId: null,
    });
    const tokenB = await signRunToken(runTokenSecret(b.harness.ctx.db), {
      workspaceId: b.harness.workspaceId, runId: 'run_b', agentId: b.harness.conductorId, agentKind: 'weaver',
      projectId: b.harness.projectId, ticketId: null, roleId: null,
    });

    // A files an incident through the tool; its workspace is A.
    const filed = await callTool(app, a.harness.workspaceId, tokenA, 'weave_incident', {
      title: 'MCP call failed', whatFailed: 'weave_ticket_get returned not_found', tryingToDo: 'read the ticket',
    });
    expect(filed.ok).toBe(true);
    const incidentId = filed.data.id as string;

    // B's list includes it, tagged with A's display name.
    const listed = await callTool(app, b.harness.workspaceId, tokenB, 'weave_incident_list', {});
    expect(listed.ok).toBe(true);
    const items = listed.data.items as Array<{ id: string; workspaceId: string; workspaceName: string | null }>;
    const found = items.find((i) => i.id === incidentId);
    expect(found).toBeTruthy();
    expect(found).toMatchObject({ workspaceId: a.harness.workspaceId, workspaceName: 'V OFM' });

    // B reads it in full, no `forbidden`.
    const got = await callTool(app, b.harness.workspaceId, tokenB, 'weave_incident_get', { id: incidentId });
    expect(got.ok).toBe(true);
    expect(got.data).toMatchObject({ workspaceName: 'V OFM' });

    // B resolves it: filing workspace A and resolving workspace B stay distinct.
    const resolved = await callTool(app, b.harness.workspaceId, tokenB, 'weave_incident_resolve', { id: incidentId, resolution: 'fixed in Weave AI' });
    expect(resolved.ok).toBe(true);
    expect(resolved.data).toMatchObject({
      workspaceId: a.harness.workspaceId, workspaceName: 'V OFM',
      resolvedByWorkspaceId: b.harness.workspaceId, resolvedByWorkspaceName: 'Sideprojects',
    });
    const stored = deps.incidents.get(incidentId);
    expect(stored.workspaceId).toBe(a.harness.workspaceId);
    expect(stored.resolvedByWorkspaceId).toBe(b.harness.workspaceId);
  });

  it('workspace B cannot reach a ticket or knowledge that exists only in workspace A', async () => {
    const a = workspace('V OFM');
    const b = workspace('Sideprojects');
    const daemonDb = openDb(':memory:');
    cleanups.push(() => daemonDb.close());

    const ticketA = a.services.tickets.create({ kind: 'human', id: null }, { projectId: a.harness.projectId, kind: 'task', title: 'A only' });
    a.services.knowledge.note({ kind: 'agent', id: a.harness.conductorId }, 'project', 'Guard', 'A_ONLY_MARKER only in workspace A', a.harness.projectId);

    const deps = {
      auth: { hasOperator: () => true, verify: () => ({ sessionId: 's1', operatorId: 'op1', kind: 'cli' as const }), totpEnabled: () => false },
      daemon: DaemonConfigSchema.parse({}), workspaces: new Map([[a.runtime.id, a.runtime], [b.runtime.id, b.runtime]]),
      registries: a.harness.ctx.registries, listener: 'loopback' as const, publicUrl: 'http://127.0.0.1:7433',
      version: 'test', uiDir: null, incidents: createIncidentsService(daemonDb),
    } as unknown as AppDeps;
    const app = createApp(deps);

    const tokenB = await signRunToken(runTokenSecret(b.harness.ctx.db), {
      workspaceId: b.harness.workspaceId, runId: 'run_b', agentId: b.harness.conductorId, agentKind: 'weaver',
      projectId: b.harness.projectId, ticketId: null, roleId: null,
    });

    // The ticket lives in A's db; B's ticket service has no such row.
    const ticket = await callTool(app, b.harness.workspaceId, tokenB, 'weave_ticket_get', { id: ticketA.id });
    expect(ticket.ok).toBe(false);
    expect(ticket.error?.code).toBe('not_found');

    // A's project knowledge lives under A's state root; B's own project hub does not carry it.
    const knowledge = await callTool(app, b.harness.workspaceId, tokenB, 'weave_knowledge_get', { scope: 'project', projectId: b.harness.projectId });
    expect(knowledge.ok).toBe(true);
    expect(JSON.stringify(knowledge.data)).not.toContain('A_ONLY_MARKER');
  });
});
