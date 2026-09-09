/**
 * Route-level coverage for VS-133: multipart send, server-side validation, the authenticated
 * serving route, and cross-thread/cross-workspace refusal. `threads.inbound`'s own storage/wake
 * wiring is covered in `packages/core/src/threads/threads.test.ts`; this file exercises the HTTP
 * boundary that sits in front of it, wired to the real core service (not a hand-written double) so
 * these tests catch a real mismatch between the route and what `threads.inbound` actually expects.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@agent-conductor/db';
import { createThreadsService } from '@agent-conductor/core';
import type { EnqueueInput } from '@agent-conductor/core';
import type { Wakeup } from '@agent-conductor/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { runTokenSecret, signRunToken } from '../src/runtoken.js';
import { authed, makeHarness, type Harness } from './fakes.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const NOT_A_PNG = Buffer.from('not actually a png');

let harnesses: Harness[] = [];
let attachmentsDirs: string[] = [];
afterEach(async () => {
  await Promise.all(harnesses.map((h) => h.close()));
  harnesses = [];
  for (const d of attachmentsDirs) rmSync(d, { recursive: true, force: true });
  attachmentsDirs = [];
});

/** Wires the real `createThreadsService` (not the default stub) against a real temp attachments dir. */
function withRealThreads(options: Parameters<typeof makeHarness>[0] = {}): { h: Harness; fetch: (path: string, init?: RequestInit) => Promise<Response> } {
  const h = makeHarness(options);
  harnesses.push(h);
  const attachmentsDir = mkdtempSync(join(tmpdir(), 'ac-attachments-route-'));
  attachmentsDirs.push(attachmentsDir);
  (h.runtime.ctx.paths as { attachments: string }).attachments = attachmentsDir;
  // `threads.bindOrGet` addresses every new thread's agent as "the workspace's conductor" — the
  // fake harness's db has none by default (it normally never needs one; `threads` is stubbed).
  const now = nowIso();
  h.db.insert('agents', {
    id: newId(), workspaceId: h.runtime.id, kind: 'conductor', name: 'Conductor', runtimeId: 'claude',
    status: 'active', homePath: '/tmp/conductor', turnEpoch: 0, turnCount: 0, spawnedBy: 'system', briefRevision: 1, createdAt: now, updatedAt: now,
  });
  h.runtime.services.threads = createThreadsService(h.runtime.ctx, () => h.runtime.services);
  return { h, fetch: (path, init) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init)) };
}

function multipart(fields: Record<string, string>, files: Array<{ field?: string; name: string; type: string; bytes: Buffer }> = []): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const f of files) form.append(f.field ?? 'files', new File([f.bytes], f.name, { type: f.type }));
  return form;
}

describe('POST /threads/:id/messages — multipart attachments', () => {
  it('accepts a message with one image attachment and shows it on the message', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-1', null, 'Victor');
    const res = await fetch(`/api/w/ws1/threads/${t.id}/messages`, {
      method: 'POST', headers: authed(),
      body: multipart({ body: 'look at this' }, [{ name: 'shot.png', type: 'image/png', bytes: PNG }]),
    });
    expect(res.status).toBe(201);
    const msg = await res.json();
    expect(msg.parts).toEqual([expect.objectContaining({ type: 'attachment', filename: 'shot.png', mediaType: 'image/png' })]);
  });

  it('survives a reload: GET messages returns the same attachment part', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-reload', null, 'Victor');
    await fetch(`/api/w/ws1/threads/${t.id}/messages`, {
      method: 'POST', headers: authed(),
      body: multipart({ body: 'here' }, [{ name: 'shot.png', type: 'image/png', bytes: PNG }]),
    });
    const res = await fetch(`/api/w/ws1/threads/${t.id}/messages`, { headers: authed() });
    const messages = await res.json();
    expect(messages).toHaveLength(1);
    expect(messages[0].parts).toEqual([expect.objectContaining({ type: 'attachment', filename: 'shot.png' })]);
  });

  it('rejects more than four files, storing nothing', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-2', null);
    const files = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, type: 'text/plain', bytes: Buffer.from('x') }));
    const res = await fetch(`/api/w/ws1/threads/${t.id}/messages`, { method: 'POST', headers: authed(), body: multipart({ body: 'too many' }, files) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation');
    expect(h.runtime.services.threads.messages(t.id)).toHaveLength(0);
  });

  it('rejects a disallowed file type, storing nothing', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-3', null);
    const res = await fetch(`/api/w/ws1/threads/${t.id}/messages`, {
      method: 'POST', headers: authed(),
      body: multipart({ body: 'a pdf' }, [{ name: 'doc.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4') }]),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/not an accepted attachment type/);
    expect(h.runtime.services.threads.messages(t.id)).toHaveLength(0);
  });

  it('rejects a text file over its size cap, storing nothing', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-4', null);
    const oversized = Buffer.alloc(256 * 1024 + 1, 'a');
    const res = await fetch(`/api/w/ws1/threads/${t.id}/messages`, {
      method: 'POST', headers: authed(),
      body: multipart({ body: 'huge notes' }, [{ name: 'notes.txt', type: 'text/plain', bytes: oversized }]),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/exceeds the .* byte cap/);
    expect(h.runtime.services.threads.messages(t.id)).toHaveLength(0);
  });

  it('rejects an image whose bytes do not match its declared type, storing nothing', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-5', null);
    const res = await fetch(`/api/w/ws1/threads/${t.id}/messages`, {
      method: 'POST', headers: authed(),
      body: multipart({ body: 'mislabelled' }, [{ name: 'fake.png', type: 'image/png', bytes: NOT_A_PNG }]),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/do not match the declared type/);
    expect(h.runtime.services.threads.messages(t.id)).toHaveLength(0);
  });

  it('rejects an attachment on a ticket-bound thread', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-6', null);
    h.runtime.services.threads.bindTicket({ kind: 'human', id: 'victor' }, t.id, 'tk_1');
    const res = await fetch(`/api/w/ws1/threads/${t.id}/messages`, {
      method: 'POST', headers: authed(),
      body: multipart({ body: 'see attached' }, [{ name: 'x.txt', type: 'text/plain', bytes: Buffer.from('x') }]),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/ticket-bound thread/);
  });

  it('still accepts a plain JSON text-only send, unchanged', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-7', null);
    const res = await fetch(`/api/w/ws1/threads/${t.id}/messages`, {
      method: 'POST', headers: { ...authed(), 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'plain text' }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).parts).toEqual([]);
  });
});

describe('GET /threads/:threadId/attachments/:attachmentId', () => {
  it('serves the bytes with the stored media type for a matching thread', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-8', null);
    const sent = await fetch(`/api/w/ws1/threads/${t.id}/messages`, {
      method: 'POST', headers: authed(),
      body: multipart({ body: 'here' }, [{ name: 'shot.png', type: 'image/png', bytes: PNG }]),
    });
    const attachmentId = (await sent.json()).parts[0].id;

    const res = await fetch(`/api/w/ws1/threads/${t.id}/attachments/${attachmentId}`, { headers: authed() });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
  });

  it('refuses a fetch naming the wrong thread as not found', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-9', null);
    const other = h.runtime.services.threads.bindOrGet('web', 'web-10', null);
    const sent = await fetch(`/api/w/ws1/threads/${t.id}/messages`, {
      method: 'POST', headers: authed(),
      body: multipart({ body: 'here' }, [{ name: 'shot.png', type: 'image/png', bytes: PNG }]),
    });
    const attachmentId = (await sent.json()).parts[0].id;

    const res = await fetch(`/api/w/ws1/threads/${other.id}/attachments/${attachmentId}`, { headers: authed() });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });

  it('refuses an unauthenticated fetch', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-11', null);
    const sent = await fetch(`/api/w/ws1/threads/${t.id}/messages`, {
      method: 'POST', headers: authed(),
      body: multipart({ body: 'here' }, [{ name: 'shot.png', type: 'image/png', bytes: PNG }]),
    });
    const attachmentId = (await sent.json()).parts[0].id;

    const res = await fetch(`/api/w/ws1/threads/${t.id}/attachments/${attachmentId}`);
    expect(res.status).toBe(401);
  });

  it('an attachment created in one workspace is not found from another', async () => {
    const { h: h1, fetch: fetch1 } = withRealThreads();
    const t1 = h1.runtime.services.threads.bindOrGet('web', 'web-12', null);
    const sent = await fetch1(`/api/w/ws1/threads/${t1.id}/messages`, {
      method: 'POST', headers: authed(),
      body: multipart({ body: 'here' }, [{ name: 'shot.png', type: 'image/png', bytes: PNG }]),
    });
    const attachmentId = (await sent.json()).parts[0].id;

    const { fetch: fetch2 } = withRealThreads({ workspaceId: 'ws2' });
    // Same thread id string is meaningless across workspaces: a second harness is a separate db.
    const res = await fetch2(`/api/w/ws2/threads/${t1.id}/attachments/${attachmentId}`, { headers: authed() });
    expect(res.status).toBe(404);
  });
});

describe('end to end: a sent attachment reaches ac_inbox as real content (VS-133)', () => {
  /** `wake` stays a hand-double even here — its own scheduling/persistence is not this ticket's
   * concern — but `enqueue`/`listForAgent` are wired to a real in-memory queue, so the exact payload
   * shape `threads.inbound` writes is the exact shape `ac_inbox` reads, with nothing hand-copied
   * between the two ends of the seam. */
  function withRealThreadsAndWake(): { h: Harness; fetch: (path: string, init?: RequestInit) => Promise<Response>; conductorId: string } {
    const { h, fetch } = withRealThreads({ listener: 'loopback' });
    const conductorId = h.db.get<{ id: string }>("SELECT id FROM agents WHERE workspace_id = ? AND kind = 'conductor'", [h.runtime.id])!.id;
    const queue: Wakeup[] = [];
    h.impls.wake!['enqueue'] = (agentId: string, input: EnqueueInput): Wakeup => {
      const w: Wakeup = {
        id: newId(), workspaceId: h.runtime.id, agentId, source: input.source, reason: input.reason,
        payload: input.payload ?? {}, idempotencyKey: input.idempotencyKey ?? null, status: 'claimed', coalescedIntoId: null,
        skipReason: null, runId: 'run_1', requestedByKind: input.requestedBy?.kind ?? 'system', requestedById: input.requestedBy?.id ?? null,
        notBefore: input.notBefore ?? null, createdAt: nowIso(), claimedAt: null, finishedAt: null,
      };
      queue.push(w);
      return w;
    };
    h.impls.wake!['listForAgent'] = () => queue;
    return { h, fetch, conductorId };
  }

  it('a message with an image attachment turns into a real MCP image content block on ac_inbox', async () => {
    const { h, fetch, conductorId } = withRealThreadsAndWake();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-loop', null, 'Victor');
    const sent = await fetch(`/api/w/ws1/threads/${t.id}/messages`, {
      method: 'POST', headers: authed(),
      body: multipart({ body: 'look at this' }, [{ name: 'shot.png', type: 'image/png', bytes: PNG }]),
    });
    expect(sent.status).toBe(201);

    const app = createApp(h.deps);
    const token = await signRunToken(runTokenSecret(h.runtime.ctx.db), {
      workspaceId: 'ws1', runId: 'run_1', agentId: conductorId, agentKind: 'conductor', projectId: null, ticketId: null, roleId: null,
    });
    const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1/mcp/runs/run_1'), {
      fetch: (url, init) => app.fetch(new Request(url, init as RequestInit)) as Promise<Response>,
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);

    const res = await client.callTool({ name: 'ac_inbox', arguments: {} });
    const blocks = res.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    const summary = JSON.parse(blocks[0]!.text!);
    expect(summary.data.messages[0]).toMatchObject({
      payload: expect.objectContaining({ body: 'look at this' }),
      attachments: [expect.objectContaining({ filename: 'shot.png', mediaType: 'image/png' })],
    });
    const image = blocks.find((b) => b.type === 'image');
    expect(image).toEqual({ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' });
    await client.close();
  });
});

describe('POST /threads/:id/messages — JSON idempotency (VS-148)', () => {
  it('two requests with the same idempotencyKey produce one stored message', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-idem', null, 'Victor');
    const send = () => fetch(`/api/w/ws1/threads/${t.id}/messages`, {
      method: 'POST',
      headers: authed({ 'content-type': 'application/json' }),
      body: JSON.stringify({ body: 'ship it', idempotencyKey: 'k-retry' }),
    });

    const first = await send();
    expect(first.status).toBe(201);
    const a = await first.json() as { id: string };
    const second = await send();
    expect(second.status).toBe(201);
    const b = await second.json() as { id: string };

    expect(b.id).toBe(a.id);
    expect(h.runtime.services.threads.messages(t.id)).toHaveLength(1);
  });
});
