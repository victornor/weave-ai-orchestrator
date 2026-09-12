/**
 * End-to-end against the real core services (not the fakes), so route wiring and service
 * signatures stay honest. Uses core's own test harness for the temp workspace.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
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

function boot(): { deps: AppDeps; runtime: WorkspaceRuntime; harness: ReturnType<typeof makeHarness> } {
  const harness = makeHarness();
  cleanup = harness.cleanup;
  const services = createCore(harness.ctx);
  const runtime: WorkspaceRuntime = { id: harness.workspaceId, ctx: harness.ctx, services, channels: null, webhooks: null, push: null };
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

  it('HTTP ticket list still includes description (VS-161)', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;
    await app.fetch(new Request(`${base}/tickets`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ projectId: harness.projectId, kind: 'task', title: 'Keep the body', description: 'the body' }),
    }));
    const listed = await (await app.fetch(new Request(`${base}/tickets`, { headers: H }))).json();
    expect(listed.items[0].description).toBe('the body');
    const lean = await (await app.fetch(new Request(`${base}/tickets?fields=label`, { headers: H }))).json();
    expect(lean.items[0].description).toBe('');
    const detail = await (await app.fetch(new Request(`${base}/tickets/${listed.items[0].id}`, { headers: H }))).json();
    expect(detail.ticket.description).toBe('the body');
  });

  it('round-trips a ticket summary on create and patch (VS-146)', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;

    const created = await (await app.fetch(new Request(`${base}/tickets`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ projectId: harness.projectId, kind: 'task', title: 'Add a health check', summary: 'Why this ticket exists.' }),
    }))).json();
    expect(created.summary).toBe('Why this ticket exists.');

    const patched = await (await app.fetch(new Request(`${base}/tickets/${created.id}`, {
      method: 'PATCH', headers: H, body: JSON.stringify({ summary: 'Updated why.' }),
    }))).json();
    expect(patched.summary).toBe('Updated why.');

    const cleared = await (await app.fetch(new Request(`${base}/tickets/${created.id}`, {
      method: 'PATCH', headers: H, body: JSON.stringify({ summary: null }),
    }))).json();
    expect(cleared.summary).toBeNull();
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

  // ---------- VS-106 ----------

  it('a reviewer conversation: queued delivery, approving the merge, then a retired worker is refused', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const services = deps.workspaces.get(harness.workspaceId)!.services;
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;

    const ticket = services.tickets.create({ kind: 'human', id: null }, { projectId: harness.projectId, kind: 'task', title: 'Add dark mode' });
    const workerId = harness.addWorker(ticket.id);
    harness.db.update('tickets', ticket.id, { status: 'in_review' });
    const decision = services.decisions.create({ kind: 'agent', id: workerId }, {
      kind: 'merge_approval', title: 'Merge dark mode?', ticketId: ticket.id, askedByAgentId: workerId, options: [{ key: 'approve', label: 'Approve' }, { key: 'changes', label: 'Request changes' }],
    });

    // No turn is executing (no active run seeded), so a live send queues rather than reaching a turn.
    const sent = await app.fetch(new Request(`${base}/workers/${workerId}/message`, {
      method: 'POST', headers: H, body: JSON.stringify({ body: 'why a token layer first?', live: true }),
    }));
    expect(sent.status).toBe(202);
    expect((await sent.json()).delivery).toBe('queued');
    expect(services.tickets.comments(ticket.id).at(-1)).toMatchObject({ body: 'why a token layer first?', kind: 'relay' });

    // Approving from the conversation answers the same decision the card would, landing the ticket.
    // VS-281: the weaver marks the card looked first; an unreviewed card is held.
    services.decisions.review({ kind: 'agent', id: harness.conductorId }, decision.id, { status: 'looked', note: 'diff matches the plan' });
    const approved = await app.fetch(new Request(`${base}/decisions/${decision.id}/answer`, {
      method: 'POST', headers: H, body: JSON.stringify({ key: 'approve' }),
    }));
    expect(approved.status).toBe(200);
    expect(services.tickets.get(ticket.id).status).toBe('merging');

    // Once the worker has retired, the ticket still names it (VS-106's lastWorker fallback) and a
    // new message is refused rather than queued into nothing.
    harness.db.update('agents', workerId, { status: 'retired' });
    harness.db.run('UPDATE tickets SET worker_id = NULL WHERE id = ?', [ticket.id]);

    const detail = await (await app.fetch(new Request(`${base}/tickets/${ticket.id}`, { headers: H }))).json();
    expect(detail.worker).toMatchObject({ id: workerId, status: 'retired' });

    const refused = await app.fetch(new Request(`${base}/workers/${workerId}/message`, {
      method: 'POST', headers: H, body: JSON.stringify({ body: 'are you still there?', live: true }),
    }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe('wrong_status');
  });

  it('asking for revisions from the conversation answers the decision and wakes the worker with the words', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const services = deps.workspaces.get(harness.workspaceId)!.services;
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;

    const ticket = services.tickets.create({ kind: 'human', id: null }, { projectId: harness.projectId, kind: 'task', title: 'Add dark mode' });
    const workerId = harness.addWorker(ticket.id);
    harness.db.update('tickets', ticket.id, { status: 'in_review' });
    const decision = services.decisions.create({ kind: 'agent', id: workerId }, {
      kind: 'merge_approval', title: 'Merge dark mode?', ticketId: ticket.id, askedByAgentId: workerId, options: [{ key: 'approve', label: 'Approve' }, { key: 'changes', label: 'Request changes' }],
    });

    const revised = await app.fetch(new Request(`${base}/decisions/${decision.id}/answer`, {
      method: 'POST', headers: H, body: JSON.stringify({ key: 'changes', text: 'please add a test' }),
    }));
    expect(revised.status).toBe(200);
    expect(services.tickets.get(ticket.id).status).toBe('in_progress');
    expect(services.tickets.comments(ticket.id).some((c) => c.body.includes('please add a test'))).toBe(true);
    expect(services.wake.listForAgent(workerId).length).toBeGreaterThan(0);
  });

  it('refuses approving a decision the weaver has concerns about over the REST route, then accepts an override (VS-266)', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const services = deps.workspaces.get(harness.workspaceId)!.services;
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;

    const ticket = services.tickets.create({ kind: 'human', id: null }, { projectId: harness.projectId, kind: 'task', title: 'Add dark mode' });
    const workerId = harness.addWorker(ticket.id);
    harness.db.update('tickets', ticket.id, { status: 'in_review' });
    const decision = services.decisions.create({ kind: 'agent', id: workerId }, {
      kind: 'merge_approval', title: 'Merge dark mode?', ticketId: ticket.id, askedByAgentId: workerId, options: [{ key: 'approve', label: 'Approve' }, { key: 'changes', label: 'Request changes' }],
    });
    services.decisions.review({ kind: 'agent', id: harness.conductorId }, decision.id, { status: 'concerns', note: 'no dark-mode screenshot attached' });

    const refused = await app.fetch(new Request(`${base}/decisions/${decision.id}/answer`, {
      method: 'POST', headers: H, body: JSON.stringify({ key: 'approve' }),
    }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe('revision_pending');
    expect(services.decisions.get(decision.id).status).toBe('open');

    const overridden = await app.fetch(new Request(`${base}/decisions/${decision.id}/answer`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ key: 'approve', overrideHold: true, overrideReason: 'screenshot not required for this change' }),
    }));
    expect(overridden.status).toBe(200);
    expect(services.tickets.get(ticket.id).status).toBe('merging');
  });

  it('refuses approving an unreviewed decision over the REST route, then accepts an override (VS-281)', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const services = deps.workspaces.get(harness.workspaceId)!.services;
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;

    const ticket = services.tickets.create({ kind: 'human', id: null }, { projectId: harness.projectId, kind: 'task', title: 'Add dark mode' });
    const workerId = harness.addWorker(ticket.id);
    harness.db.update('tickets', ticket.id, { status: 'in_review' });
    const decision = services.decisions.create({ kind: 'agent', id: workerId }, {
      kind: 'merge_approval', title: 'Merge dark mode?', ticketId: ticket.id, askedByAgentId: workerId, options: [{ key: 'approve', label: 'Approve' }, { key: 'changes', label: 'Request changes' }],
    });

    const refused = await app.fetch(new Request(`${base}/decisions/${decision.id}/answer`, {
      method: 'POST', headers: H, body: JSON.stringify({ key: 'approve' }),
    }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatchObject({ code: 'revision_pending', details: { weaverReviewStatus: 'unseen' } });
    expect(services.decisions.get(decision.id).status).toBe('open');

    const overridden = await app.fetch(new Request(`${base}/decisions/${decision.id}/answer`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ key: 'approve', overrideHold: true, overrideReason: 'reviewed it myself, no need to wait' }),
    }));
    expect(overridden.status).toBe(200);
    expect(services.tickets.get(ticket.id).status).toBe('merging');
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
    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/agent/tools/weave_ticket_comment`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: { id: ticket.identifier, body: 'checked out and working' } }),
    }));
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(services.tickets.comments(ticket.id).at(-1)?.body).toBe('checked out and working');
  });

  describe('weave_human_send reply targets', () => {
    /** Raises a real human_message wake for the conductor and binds it to a run, the way a dispatched turn would. */
    async function turnWokenBy(
      harness: ReturnType<typeof makeHarness>,
      services: ReturnType<typeof createCore>,
      bodies: string[],
    ): Promise<{ threadId: string; token: string; messageIds: string[] }> {
      const thread = services.threads.bindOrGet('web', `web-${Math.random()}`, null, 'Victor');
      const messageIds: string[] = [];
      for (const body of bodies) {
        const msg = await services.threads.inbound({ kind: 'human', id: null }, thread.id, body);
        messageIds.push(msg.id);
      }
      const wakes = services.wake.listForAgent(harness.conductorId, ['queued']).filter((w) => messageIds.includes((w.payload as { messageId?: string }).messageId ?? ''));
      const runId = 'run_reply';
      harness.db.insert('runs', {
        id: runId, workspaceId: harness.workspaceId, agentId: harness.conductorId, ticketId: null,
        wakeupIdsJson: wakes.map((w) => w.id), runtimeId: 'claude', model: null, status: 'queued',
        turnEpoch: 1, cwd: '/tmp', retryOfRunId: null, createdAt: new Date().toISOString(),
      });
      const token = await signRunToken(runTokenSecret(harness.ctx.db), {
        workspaceId: harness.workspaceId, runId, agentId: harness.conductorId, agentKind: 'weaver', projectId: null, ticketId: null, roleId: null,
      });
      return { threadId: thread.id, token, messageIds };
    }

    it('defaults the reply target to the single message that woke the turn', async () => {
      const { deps, harness } = boot();
      const app = createApp(deps);
      const services = deps.workspaces.get(harness.workspaceId)!.services;
      const { threadId, token, messageIds } = await turnWokenBy(harness, services, ['are you still there?']);

      const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/agent/tools/weave_human_send`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: { body: 'yes, still here' } }),
      }));
      expect((await res.json()).ok).toBe(true);

      const sent = services.threads.messages(threadId).at(-1);
      expect(sent?.body).toBe('yes, still here');
      expect(sent?.replyToMessageId).toBe(messageIds[0]);
      expect(sent?.replyToExcerpt).toBe('are you still there?');
    });

    it('sends with no reply target when replyToMessageId is explicitly null, even with a single wake', async () => {
      const { deps, harness } = boot();
      const app = createApp(deps);
      const services = deps.workspaces.get(harness.workspaceId)!.services;
      const { threadId, token } = await turnWokenBy(harness, services, ['are you still there?']);

      const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/agent/tools/weave_human_send`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: { body: 'unrelated: a ticket just landed', replyToMessageId: null } }),
      }));
      expect((await res.json()).ok).toBe(true);

      const sent = services.threads.messages(threadId).at(-1);
      expect(sent?.replyToMessageId).toBeNull();
      expect(sent?.replyToExcerpt).toBeNull();
    });

    it('applies no default when the turn was woken by more than one human message', async () => {
      const { deps, harness } = boot();
      const app = createApp(deps);
      const services = deps.workspaces.get(harness.workspaceId)!.services;
      const { threadId, token } = await turnWokenBy(harness, services, ['first question', 'second question']);

      const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/agent/tools/weave_human_send`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: { body: 'answering both' } }),
      }));
      expect((await res.json()).ok).toBe(true);

      const sent = services.threads.messages(threadId).at(-1);
      expect(sent?.replyToMessageId).toBeNull();
    });
  });

  describe('weave_human_send attachments (VS-273)', () => {
    async function weaverToken(harness: ReturnType<typeof makeHarness>): Promise<string> {
      return signRunToken(runTokenSecret(harness.ctx.db), {
        workspaceId: harness.workspaceId, runId: 'run_attach', agentId: harness.conductorId, agentKind: 'weaver', projectId: null, ticketId: null, roleId: null,
      });
    }

    it('attaches a single file and a named zip of several files in the same reply', async () => {
      const { deps, harness } = boot();
      const app = createApp(deps);
      const services = deps.workspaces.get(harness.workspaceId)!.services;
      const thread = services.threads.bindOrGet('web', 'web-attach1', null, 'Victor');
      const token = await weaverToken(harness);

      const knowledge = harness.ctx.paths.knowledge;
      mkdirSync(knowledge, { recursive: true });
      const contractPath = join(knowledge, 'design-contract.md');
      const briefPath = join(knowledge, 'brief-one.md');
      writeFileSync(contractPath, 'the design contract');
      writeFileSync(briefPath, 'the first brief');

      const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/agent/tools/weave_human_send`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          input: {
            threadId: thread.id, body: 'here is the handoff',
            attachments: [{ path: contractPath }, { paths: [briefPath, contractPath], zipName: 'handoff' }],
          },
        }),
      }));
      const payload = await res.json();
      expect(payload.ok).toBe(true);

      const sent = services.threads.messages(thread.id).at(-1);
      expect(sent?.parts).toHaveLength(2);
      expect(sent?.parts?.[0]).toEqual(expect.objectContaining({ filename: 'design-contract.md', mediaType: 'text/markdown' }));
      expect(sent?.parts?.[1]).toEqual(expect.objectContaining({ filename: 'handoff.zip', mediaType: 'application/zip' }));
    });

    it('refuses a path outside the allowlist, naming it, and sends no message at all', async () => {
      const { deps, harness } = boot();
      const app = createApp(deps);
      const services = deps.workspaces.get(harness.workspaceId)!.services;
      const thread = services.threads.bindOrGet('web', 'web-attach2', null, 'Victor');
      const token = await weaverToken(harness);

      const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/agent/tools/weave_human_send`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: { threadId: thread.id, body: 'oops', attachments: [{ path: harness.ctx.paths.secretsFile }] } }),
      }));
      const payload = await res.json();
      expect(payload.ok).toBe(false);
      expect(payload.error.message).toContain(harness.ctx.paths.secretsFile);
      expect(services.threads.messages(thread.id)).toHaveLength(0);
    });
  });

  describe('weave_thread_message_get', () => {
    it('returns the full body of a message a wake payload truncated (VS-242)', async () => {
      const { deps, harness } = boot();
      const app = createApp(deps);
      const services = deps.workspaces.get(harness.workspaceId)!.services;
      const thread = services.threads.bindOrGet('web', 'web-vs242', null, 'Victor');
      const body = 'z'.repeat(9000);
      const msg = await services.threads.inbound({ kind: 'human', id: null }, thread.id, body);
      const wakes = services.wake.listForAgent(harness.conductorId, ['queued']).filter((w) => (w.payload as { messageId?: string }).messageId === msg.id);
      expect((wakes[0]?.payload as { truncated?: boolean; bodyLength?: number }).truncated).toBe(true);
      expect((wakes[0]?.payload as { truncated?: boolean; bodyLength?: number }).bodyLength).toBe(9000);

      const token = await signRunToken(runTokenSecret(harness.ctx.db), {
        workspaceId: harness.workspaceId, runId: 'run_msg', agentId: harness.conductorId, agentKind: 'weaver', projectId: null, ticketId: null, roleId: null,
      });
      const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/agent/tools/weave_thread_message_get`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: { threadId: thread.id, messageId: msg.id } }),
      }));
      const payload = await res.json();
      expect(payload.ok).toBe(true);
      expect(payload.data.body).toBe(body);
      expect(payload.data.body).toHaveLength(9000);
    });

    it('is not_found for a messageId belonging to another thread', async () => {
      const { deps, harness } = boot();
      const app = createApp(deps);
      const services = deps.workspaces.get(harness.workspaceId)!.services;
      const other = services.threads.bindOrGet('web', 'web-vs242-other', null);
      const elsewhere = await services.threads.inbound({ kind: 'human', id: null }, other.id, 'over here');
      const t = services.threads.bindOrGet('web', 'web-vs242-here', null);

      const token = await signRunToken(runTokenSecret(harness.ctx.db), {
        workspaceId: harness.workspaceId, runId: 'run_msg2', agentId: harness.conductorId, agentKind: 'weaver', projectId: null, ticketId: null, roleId: null,
      });
      const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/agent/tools/weave_thread_message_get`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: { threadId: t.id, messageId: elsewhere.id } }),
      }));
      const payload = await res.json();
      expect(payload.ok).toBe(false);
      expect(payload.error.code).toBe('not_found');
    });

    it('is refused for a worker run token (conductor-scoped)', async () => {
      const { deps, harness } = boot();
      const app = createApp(deps);
      const services = deps.workspaces.get(harness.workspaceId)!.services;
      const thread = services.threads.bindOrGet('web', 'web-vs242-worker', null);
      const msg = await services.threads.inbound({ kind: 'human', id: null }, thread.id, 'a message');
      const workerId = harness.addWorker(null);

      const token = await signRunToken(runTokenSecret(harness.ctx.db), {
        workspaceId: harness.workspaceId, runId: 'run_msg3', agentId: workerId, agentKind: 'worker', projectId: harness.projectId, ticketId: null, roleId: harness.roleId,
      });
      const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/agent/tools/weave_thread_message_get`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: { threadId: thread.id, messageId: msg.id } }),
      }));
      expect(res.status).toBe(403);
    });
  });

  it('changes a role max workers through the conductor tool, as a new revision', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const services = deps.workspaces.get(harness.workspaceId)!.services;
    harness.ctx.config.defaults.hireApproval = 'none';
    const { role } = await services.roles.hire({ kind: 'human', id: null }, {
      id: 'api-backend', name: 'Backend Engineer', project: harness.projectSlug,
      charterSummary: 'Owns the api service.', scope: 'Backend work in the api repo.',
      responsibilities: [], capabilities: [], exclusions: [], rules: [],
      runtime: 'claude', model: null, sessionPolicy: 'per_ticket', maxWorkers: 2,
      permission: { mode: 'auto', allowed: [], denied: [] }, secrets: [], createdBy: 'human',
    } as never);
    expect(role.maxWorkers).toBe(2);

    const token = await signRunToken(runTokenSecret(harness.ctx.db), {
      workspaceId: harness.workspaceId, runId: 'run_c', agentId: harness.conductorId, agentKind: 'weaver', projectId: null, ticketId: null, roleId: null,
    });
    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/agent/tools/weave_role_set_max_workers`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: { id: role.id, maxWorkers: 6, reason: 'the queue is backing up' } }),
    }));
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.data.role.maxWorkers).toBe(6);
    // the project allows 4, so raising the role past it buys nothing
    expect(payload.data.concurrency).toMatchObject({ roleMax: 6, projectMax: 4, effective: 4 });
    expect(services.roles.revisions(role.id).at(-1)).toMatchObject({ reason: 'the queue is backing up', changedKeys: ['maxWorkers'] });

    const detail = await (await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/roles/${role.id}`, { headers: H }))).json();
    expect(detail.concurrency).toMatchObject({ roleMax: 6, projectMax: 4, effective: 4, live: 0, free: 4 });
  });

  it('refuses a runtime, a model or an effort in a PATCH /roles/:id, and still rejects an unknown key', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;
    const services = deps.workspaces.get(harness.workspaceId)!.services;
    harness.ctx.config.defaults.hireApproval = 'none';
    const { role } = await services.roles.hire({ kind: 'human', id: null }, {
      id: 'api-backend', name: 'Backend Engineer', project: harness.projectSlug,
      charterSummary: 'Owns the api service.', scope: 'Backend work in the api repo.',
      responsibilities: [], capabilities: [], exclusions: [], rules: [],
      sessionPolicy: 'per_ticket', maxWorkers: 2,
      permission: { mode: 'auto', allowed: [], denied: [] }, secrets: [], createdBy: 'human',
    } as never);

    const patch = (body: unknown): Promise<Response> =>
      app.fetch(new Request(`${base}/roles/${role.id}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) }));

    // A role carries none of the three since VS-77: each is refused rather than quietly dropped, so a
    // caller cannot believe it chose a model for one role.
    for (const key of ['runtime', 'model', 'effort']) {
      const res = await patch({ patch: { [key]: 'codex' }, reason: 'changed from the web app' });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('validation');
    }

    // what the web app used to send: the column name, not the spec field. Stripped silently before.
    const bad = await patch({ patch: { runtimeId: 'claude' }, reason: 'changed from the web app' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('validation');

    // A key the role does carry still works, so strictness has not frozen the whole patch.
    const ok = await patch({ patch: { maxWorkers: 5 }, reason: 'more parallelism' });
    expect(ok.status).toBe(200);
    expect(services.roles.get(role.id).maxWorkers).toBe(5);
    // Nothing on the response looks like a model knob any more.
    for (const key of ['runtimeId', 'model', 'effort']) expect(await ok.clone().json()).not.toHaveProperty(key);
  });

  // VS-77: `GET`/`PUT /models` is the whole of model selection over HTTP.
  it('reads both model settings and replaces them whole over PUT /models', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;

    const before = await (await app.fetch(new Request(`${base}/models`, { headers: H }))).json();
    expect(before).toEqual({ weaver: { runtime: 'claude', model: null }, workers: { runtime: 'claude', model: null }, workerOptions: [] });

    const next = {
      weaver: { runtime: 'claude', model: 'claude-fable-5-1' },
      workers: { runtime: 'codex', model: 'gpt-5', effort: 'high' },
    };
    const put = await app.fetch(new Request(`${base}/models`, { method: 'PUT', headers: H, body: JSON.stringify(next) }));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ...next, workerOptions: [] });
    expect(await (await app.fetch(new Request(`${base}/models`, { headers: H }))).json()).toEqual({ ...next, workerOptions: [] });
  });

  it('accepts a legacy conductor-keyed body and responds with weaver (VS-263)', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;

    const put = await app.fetch(new Request(`${base}/models`, {
      method: 'PUT', headers: H,
      body: JSON.stringify({ conductor: { runtime: 'claude', model: 'claude-fable-5-1' }, workers: { runtime: 'codex', model: 'gpt-5' } }),
    }));
    expect(put.status).toBe(200);
    const body = await put.json();
    expect(body).toMatchObject({ weaver: { runtime: 'claude', model: 'claude-fable-5-1' } });
    expect(body).not.toHaveProperty('conductor');

    const both = await app.fetch(new Request(`${base}/models`, {
      method: 'PUT', headers: H,
      body: JSON.stringify({ conductor: { runtime: 'claude' }, weaver: { runtime: 'codex' }, workers: { runtime: 'codex' } }),
    }));
    expect(both.status).toBe(400);
  });

  it('keeps workerOptions when PUT omits them and replaces when they are sent (VS-162)', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;
    const cheap = { id: 'cheap', description: 'Scouts.', runtime: 'opencode', model: 'glm-4.6' };
    const withOpt = {
      weaver: { runtime: 'claude', model: null },
      workers: { runtime: 'claude', model: null },
      workerOptions: [cheap],
    };
    expect((await app.fetch(new Request(`${base}/models`, { method: 'PUT', headers: H, body: JSON.stringify(withOpt) }))).status).toBe(200);
    const omitted = await app.fetch(new Request(`${base}/models`, {
      method: 'PUT', headers: H,
      body: JSON.stringify({ weaver: { runtime: 'claude', model: 'claude-fable-5-1' }, workers: { runtime: 'claude', model: null } }),
    }));
    expect(omitted.status).toBe(200);
    expect(await omitted.json()).toMatchObject({ workerOptions: [cheap] });
    const cleared = await app.fetch(new Request(`${base}/models`, {
      method: 'PUT', headers: H,
      body: JSON.stringify({ weaver: { runtime: 'claude', model: null }, workers: { runtime: 'claude', model: null }, workerOptions: [] }),
    }));
    expect(await cleared.json()).toMatchObject({ workerOptions: [] });
  });

  it('refuses a duplicate worker option id (VS-162)', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;
    const dup = { id: 'cheap', description: 'a', runtime: 'claude', model: null };
    const res = await app.fetch(new Request(`${base}/models`, {
      method: 'PUT', headers: H,
      body: JSON.stringify({
        weaver: { runtime: 'claude', model: null },
        workers: { runtime: 'claude', model: null },
        workerOptions: [dup, { ...dup, description: 'b' }],
      }),
    }));
    expect(res.status).toBe(400);
  });

  it('refuses a model setting with no runtime rather than storing it', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;
    const res = await app.fetch(new Request(`${base}/models`, {
      method: 'PUT', headers: H,
      body: JSON.stringify({ weaver: { runtime: '', model: null }, workers: { runtime: 'claude', model: null } }),
    }));
    expect(res.status).toBe(400);
    expect(await (await app.fetch(new Request(`${base}/models`, { headers: H }))).json())
      .toMatchObject({ weaver: { runtime: 'claude' } });
  });

  it('routes no way to set a runtime or a model anywhere else', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;

    // The conductor's runtime and model moved to /models; PATCH /conductor is gone.
    const patched = await app.fetch(new Request(`${base}/conductor`, { method: 'PATCH', headers: H, body: JSON.stringify({ runtime: 'codex' }) }));
    expect(patched.status).toBe(404);

    // A project no longer takes one either.
    const added = await app.fetch(new Request(`${base}/projects`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ url: 'git@github.com:acme/web.git', id: 'web', runtime: 'codex' }),
    }));
    expect(added.status).toBe(400);
  });

  it('exports the workspace as a portable package over POST /export', async () => {
    const { deps, harness } = boot();
    const app = createApp(deps);
    const base = `http://127.0.0.1/api/w/${harness.workspaceId}`;

    await app.fetch(new Request(`${base}/tickets`, {
      method: 'POST', headers: H, body: JSON.stringify({ projectId: harness.projectId, kind: 'task', title: 'Write the README' }),
    }));
    const res = await app.fetch(new Request(`${base}/export`, { method: 'POST', headers: H, body: '{}' }));
    expect(res.status).toBe(201);
    const result = await res.json();
    expect(result.tickets).toBe(1);
    expect(existsSync(join(result.path, 'workspace.yaml'))).toBe(true);
    expect(readdirSync(join(result.path, 'tickets'))).toEqual(['TST-1.md']);
    expect(existsSync(join(result.path, 'db.sqlite'))).toBe(false);
  });

  describe('ticket artifacts (VS-269)', () => {
    const SAMPLE_HTML = '<!doctype html><html><head><title>Test</title></head><body><h1>Hi</h1></body></html>';

    function bootWithWorkerTicket() {
      const { deps, harness } = boot();
      const app = createApp(deps);
      const services = deps.workspaces.get(harness.workspaceId)!.services;
      const ticket = services.tickets.create({ kind: 'human', id: null }, { projectId: harness.projectId, kind: 'task', title: 'Publish an artifact' });
      const agentId = harness.addWorker(ticket.id);
      return { deps, harness, app, services, ticket, agentId };
    }

    async function workerToken(harness: ReturnType<typeof makeHarness>, agentId: string, ticketId: string): Promise<string> {
      return signRunToken(runTokenSecret(harness.ctx.db), {
        workspaceId: harness.workspaceId, runId: 'run_artifact', agentId, agentKind: 'worker', projectId: harness.projectId, ticketId, roleId: harness.roleId,
      });
    }

    async function callTool(app: ReturnType<typeof createApp>, ws: string, token: string, tool: string, input: Record<string, unknown>) {
      const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${ws}/agent/tools/${tool}`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
      }));
      return res.json();
    }

    it('publishes an artifact and it shows up as a work product with a stable URL', async () => {
      const { harness, app, services, ticket, agentId } = bootWithWorkerTicket();
      const token = await workerToken(harness, agentId, ticket.id);

      const first = await callTool(app, harness.workspaceId, token, 'weave_ticket_artifact_put', { id: ticket.identifier, key: 'overview', html: SAMPLE_HTML, title: 'Overview', kind: 'diagram' });
      expect(first.ok).toBe(true);
      expect(first.data.revision).toBe(1);
      expect(first.data.url).toBe(`/api/w/${harness.workspaceId}/tickets/${ticket.id}/artifacts/overview/raw`);

      const products = services.tickets.workProducts(ticket.id);
      expect(products).toHaveLength(1);
      expect(products[0]).toMatchObject({ type: 'artifact', externalId: 'overview', url: first.data.url, title: 'Overview' });

      // Republishing under the same key updates the one row rather than adding another.
      const second = await callTool(app, harness.workspaceId, token, 'weave_ticket_artifact_put', { id: ticket.identifier, key: 'overview', html: SAMPLE_HTML, title: 'Overview v2' });
      expect(second.ok).toBe(true);
      expect(second.data.revision).toBe(2);
      expect(services.tickets.workProducts(ticket.id)).toHaveLength(1);
      expect(services.tickets.workProducts(ticket.id)[0]).toMatchObject({ title: 'Overview v2' });

      // Both revisions remain independently readable.
      expect(services.tickets.getDocument(ticket.id, 'artifact:overview', 1)?.body).toBe(SAMPLE_HTML);
      expect(services.tickets.getDocument(ticket.id, 'artifact:overview', 2)?.body).toBe(SAMPLE_HTML);
    });

    it('rejects an empty body, a non-HTML body, and an oversized body', async () => {
      const { harness, app, ticket, agentId } = bootWithWorkerTicket();
      const token = await workerToken(harness, agentId, ticket.id);

      const empty = await callTool(app, harness.workspaceId, token, 'weave_ticket_artifact_put', { id: ticket.identifier, key: 'a', html: '   ' });
      expect(empty.ok).toBe(false);
      expect(empty.error.message).toMatch(/empty/);

      const notHtml = await callTool(app, harness.workspaceId, token, 'weave_ticket_artifact_put', { id: ticket.identifier, key: 'b', html: 'just some text' });
      expect(notHtml.ok).toBe(false);
      expect(notHtml.error.message).toMatch(/does not look like an HTML document/);

      const oversized = await callTool(app, harness.workspaceId, token, 'weave_ticket_artifact_put', { id: ticket.identifier, key: 'c', html: `<html>${'x'.repeat(2_000_001)}</html>` });
      expect(oversized.ok).toBe(false);
      expect(oversized.error.message).toMatch(/over the 2,000,000-character cap|over the 2000000-character cap/);

      const accepted = await callTool(app, harness.workspaceId, token, 'weave_ticket_artifact_put', { id: ticket.identifier, key: 'd', html: SAMPLE_HTML });
      expect(accepted.ok).toBe(true);
    });

    it('never lets an agent read an artifact body back through the ordinary document tool', async () => {
      const { harness, app, ticket, agentId } = bootWithWorkerTicket();
      const token = await workerToken(harness, agentId, ticket.id);
      await callTool(app, harness.workspaceId, token, 'weave_ticket_artifact_put', { id: ticket.identifier, key: 'secret-ish', html: SAMPLE_HTML });
      await callTool(app, harness.workspaceId, token, 'weave_ticket_document_put', { id: ticket.identifier, key: 'report', body: 'plain notes' });

      const readAttempt = await callTool(app, harness.workspaceId, token, 'weave_ticket_document_get', { id: ticket.identifier, key: 'artifact:secret-ish' });
      expect(readAttempt.ok).toBe(false);
      expect(readAttempt.error.message).toMatch(/not readable by agents/);
      expect(readAttempt.error.message).not.toContain('<html');

      // The author of the artifact gets refused identically to anyone else, in the same run.
      const authorReadAttempt = await callTool(app, harness.workspaceId, token, 'weave_ticket_document_get', { id: ticket.identifier, key: 'artifact:secret-ish' });
      expect(authorReadAttempt.ok).toBe(false);

      // A wrong-key guess must not leak the artifact's key as a hint, but a plain document's key is fine.
      const guess = await callTool(app, harness.workspaceId, token, 'weave_ticket_document_get', { id: ticket.identifier, key: 'nonexistent' });
      expect(guess.ok).toBe(false);
      expect(guess.error.details.availableKeys).toContain('report');
      expect(guess.error.details.availableKeys).not.toContain('artifact:secret-ish');

      // Writing an artifact-shaped key through the general document tool is refused too.
      const directWrite = await callTool(app, harness.workspaceId, token, 'weave_ticket_document_put', { id: ticket.identifier, key: 'artifact:sneaky', body: SAMPLE_HTML });
      expect(directWrite.ok).toBe(false);
      expect(directWrite.error.message).toMatch(/weave_ticket_artifact_put/);
    });

    it('serves the raw artifact over HTTP with the mandated sandbox CSP, verbatim bytes, for a human session only', async () => {
      const { harness, app, ticket, agentId } = bootWithWorkerTicket();
      const token = await workerToken(harness, agentId, ticket.id);
      const published = await callTool(app, harness.workspaceId, token, 'weave_ticket_artifact_put', { id: ticket.identifier, key: 'view', html: SAMPLE_HTML });
      expect(published.ok).toBe(true);

      const res = await app.fetch(new Request(`http://127.0.0.1${published.data.url}`, { headers: H }));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(SAMPLE_HTML);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-security-policy')).toBe(
        "sandbox allow-scripts allow-forms allow-popups allow-downloads; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src data: 'self'; font-src data:; connect-src 'none'",
      );

      // A run token (an agent) cannot reach this route at all.
      const rejected = await app.fetch(new Request(`http://127.0.0.1${published.data.url}`, { headers: { authorization: `Bearer ${token}` } }));
      expect(rejected.status).toBe(403);
    });

    it('serves a superseded revision independently of the current one', async () => {
      const { harness, app, ticket, agentId } = bootWithWorkerTicket();
      const token = await workerToken(harness, agentId, ticket.id);
      const HTML_V2 = '<!doctype html><html><body><h1>v2</h1></body></html>';
      const first = await callTool(app, harness.workspaceId, token, 'weave_ticket_artifact_put', { id: ticket.identifier, key: 'view', html: SAMPLE_HTML });
      await callTool(app, harness.workspaceId, token, 'weave_ticket_artifact_put', { id: ticket.identifier, key: 'view', html: HTML_V2 });

      const current = await app.fetch(new Request(`http://127.0.0.1${first.data.url}`, { headers: H }));
      expect(await current.text()).toBe(HTML_V2);

      const earlier = await app.fetch(new Request(`http://127.0.0.1${first.data.url}?revision=1`, { headers: H }));
      expect(await earlier.text()).toBe(SAMPLE_HTML);
    });

    it('serves the AC Artifact Kit CSS verbatim at a stable asset path', async () => {
      const { harness, app } = bootWithWorkerTicket();
      const { ARTIFACT_KIT_CSS } = await import('@weave-ai/core');
      const res = await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/artifacts/kit.css`, { headers: H }));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expect(await res.text()).toBe(ARTIFACT_KIT_CSS);
    });

    // VS-270: the document explorer's Artifacts entry must land on the exact same route and CSP as
    // the ticket page's own viewer — this fetches the `url` the *new* project-wide listing itself
    // returns, not one the test constructs, so it proves the explorer's own read path is unrelaxed
    // rather than assuming so because the URL string looks right (design.md's stated reason).
    it('lists a published artifact across the project, and its listed URL still serves the mandated sandbox CSP', async () => {
      const { harness, app, ticket, agentId } = bootWithWorkerTicket();
      const token = await workerToken(harness, agentId, ticket.id);
      const published = await callTool(app, harness.workspaceId, token, 'weave_ticket_artifact_put', { id: ticket.identifier, key: 'overview', html: SAMPLE_HTML, title: 'Overview', kind: 'diagram' });
      expect(published.ok).toBe(true);

      const listed = await (await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/knowledge/artifacts?project=${harness.projectId}`, { headers: H }))).json();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ ticketId: ticket.id, ticketIdentifier: ticket.identifier, key: 'overview', title: 'Overview', url: published.data.url });

      const res = await app.fetch(new Request(`http://127.0.0.1${listed[0].url}`, { headers: H }));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(SAMPLE_HTML);
      expect(res.headers.get('content-security-policy')).toBe(
        "sandbox allow-scripts allow-forms allow-popups allow-downloads; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src data: 'self'; font-src data:; connect-src 'none'",
      );
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');

      // A different project sees none of it; the unfiltered call sees it regardless.
      const otherProjectId = 'other-proj';
      const now = new Date().toISOString();
      harness.db.insert('projects', {
        id: otherProjectId, workspaceId: harness.workspaceId, slug: 'other', name: 'Other', gitUrl: '', defaultBranch: 'main',
        clonePath: '/tmp/other', maxWorkers: 4, worktreeProvider: 'git', openspecEnabled: 1, policiesJson: {},
        status: 'ready', createdAt: now, updatedAt: now,
      });
      const forOther = await (await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/knowledge/artifacts?project=${otherProjectId}`, { headers: H }))).json();
      expect(forOther).toEqual([]);
      const unfiltered = await (await app.fetch(new Request(`http://127.0.0.1/api/w/${harness.workspaceId}/knowledge/artifacts`, { headers: H }))).json();
      expect(unfiltered).toHaveLength(1);
    });
  });
});
