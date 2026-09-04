/**
 * End-to-end against the real core services (not the fakes), so route wiring and service
 * signatures stay honest. Uses core's own test harness for the temp workspace.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, initLogger } from '@openconductor/core';
import { DaemonConfigSchema } from '@openconductor/shared';
import { makeHarness } from '../../core/src/testing/context.js';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import type { AppDeps, WorkspaceRuntime } from '../src/types.js';

initLogger(process.env.OC_LOG_LEVEL ?? 'silent');

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; });

function boot(): { deps: AppDeps; runtime: WorkspaceRuntime; harness: ReturnType<typeof makeHarness> } {
  const harness = makeHarness();
  cleanup = harness.cleanup;
  const services = createCore(harness.ctx);
  const runtime: WorkspaceRuntime = { id: harness.workspaceId, ctx: harness.ctx, services, channels: null };
  const auth = { hasOperator: () => true, verify: () => ({ sessionId: 's1', operatorId: 'op1', kind: 'cli' as const }), totpEnabled: () => false } as unknown as AppDeps['auth'];
  const deps: AppDeps = {
    auth, daemon: DaemonConfigSchema.parse({}), workspaces: new Map([[harness.workspaceId, runtime]]),
    registries: harness.ctx.registries, listener: 'loopback', publicUrl: 'http://127.0.0.1:7433', version: 'test', uiDir: null,
  };
  return { deps, runtime, harness };
}

const H = { authorization: 'Bearer sess', 'content-type': 'application/json' };

describe('real core services over HTTP', () => {
  it('creates, reads and transitions a ticket', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;

    const created = await (await app.fetch(new Request(`${base}/tickets`, {
      method: 'POST', headers: H, body: JSON.stringify({ projectId: harness.projectId, kind: 'task', title: 'Add a health check' }),
    }))).json();
    expect(created.identifier).toMatch(/^TST-\d+$/);

    const fetched = await (await app.fetch(new Request(`${base}/tickets/${created.identifier}`, { headers: H }))).json();
    expect(fetched.ticket.title).toBe('Add a health check');

    const moved = await app.fetch(new Request(`${base}/tickets/${created.id}/transition`, {
      method: 'POST', headers: H, body: JSON.stringify({ to: 'todo' }),
    }));
    expect(moved.status).toBe(200);
    expect((await moved.json()).status).toBe('todo');

    const listed = await (await app.fetch(new Request(`${base}/tickets`, { headers: H }))).json();
    expect(listed.total).toBe(1);
  });

  it('answers a decision through the REST route', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;
    const created = deps.workspaces.get(harness.workspaceId)!.services.decisions.create({ kind: 'human', id: null }, {
      kind: 'question', title: 'Ship it?', options: [{ key: 'yes', label: 'Yes' }],
    });
    const res = await app.fetch(new Request(`${base}/decisions/${created.id}/answer`, { method: 'POST', headers: H, body: JSON.stringify({ key: 'yes' }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('answered');
  });

  it('serves an agent tool call backed by real services', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const services = deps.workspaces.get(harness.workspaceId)!.services;
    const ticket = services.tickets.create({ kind: 'human', id: null }, { projectId: harness.projectId, kind: 'task', title: 'Worker work' });
    const agentId = harness.addWorker(ticket.id);
    const token = await signRunToken(runTokenSecret(harness.ctx.db), {
      workspaceId: harness.workspaceId, runId: 'run_1', agentId, agentKind: 'worker', projectId: harness.projectId, ticketId: ticket.id, roleId: harness.roleId,
    });
    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/agent/tools/oc_ticket_comment`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: { id: ticket.identifier, body: 'checked out and working' } }),
    }));
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(services.tickets.comments(ticket.id).at(-1)?.body).toBe('checked out and working');
  });
});
