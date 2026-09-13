/**
 * Route-level coverage for VS-320: `GET /threads/:id/search` and the `around` param on
 * `GET /threads/:id/messages`. `ThreadsService.search()`/`around()`'s own scoping, ordering and
 * tie-break behavior are covered in `packages/core/src/threads/threads.test.ts`; this file
 * exercises the HTTP boundary (query validation, status codes, response shape) wired to the real
 * core service, the same way `threads-attachments.test.ts` does for the attachment routes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createThreadsService } from '@weave-ai/core';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness } from './fakes.js';

let harnesses: Harness[] = [];
afterEach(async () => {
  await Promise.all(harnesses.map((h) => h.close()));
  harnesses = [];
});

/** Wires the real `createThreadsService` (not the default stub), mirroring `threads-attachments.test.ts`. */
function withRealThreads(options: Parameters<typeof makeHarness>[0] = {}): { h: Harness; fetch: (path: string, init?: RequestInit) => Promise<Response> } {
  const h = makeHarness(options);
  harnesses.push(h);
  h.runtime.services.threads = createThreadsService(h.runtime.ctx, () => h.runtime.services);
  return { h, fetch: (path, init) => createApp(h.deps).fetch(new Request(`http://127.0.0.1:7433${path}`, init)) };
}

async function send(fetch: (path: string, init?: RequestInit) => Promise<Response>, threadId: string, body: string): Promise<{ id: string }> {
  const res = await fetch(`/api/w/ws1/threads/${threadId}/messages`, {
    method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ body }),
  });
  return res.json();
}

describe('GET /threads/:id/search', () => {
  it('finds a matching message with a highlighted snippet', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-1', null);
    const msg = await send(fetch, t.id, 'the deploy runs at midnight');

    const res = await fetch(`/api/w/ws1/threads/${t.id}/search?q=midnight`, { headers: authed() });
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results).toEqual([expect.objectContaining({ messageId: msg.id, snippet: expect.stringContaining('\u0002midnight\u0003') })]);
  });

  it('rejects an empty query as validation, not a 500', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-2', null);

    const res = await fetch(`/api/w/ws1/threads/${t.id}/search?q=`, { headers: authed() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation');
  });

  it('a thread id from another workspace resolves not_found, not another workspace\'s results', async () => {
    const { h: h1, fetch: fetch1 } = withRealThreads();
    const t1 = h1.runtime.services.threads.bindOrGet('web', 'web-3', null);
    await send(fetch1, t1.id, 'a workspace-one secret');

    const { fetch: fetch2 } = withRealThreads({ workspaceId: 'ws2' });
    // Same thread id string is meaningless across workspaces: a second harness is a separate db
    // (mirrors the attachment cross-workspace test in threads-attachments.test.ts).
    const res = await fetch2(`/api/w/ws2/threads/${t1.id}/search?q=secret`, { headers: authed() });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });
});

describe('GET /threads/:id/messages?around=', () => {
  it('returns a window centered on the target message, oldest-first', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-4', null);
    const first = await send(fetch, t.id, 'm0');
    const target = await send(fetch, t.id, 'm1');
    const third = await send(fetch, t.id, 'm2');

    const res = await fetch(`/api/w/ws1/threads/${t.id}/messages?around=${target.id}`, { headers: authed() });
    expect(res.status).toBe(200);
    const window = await res.json();
    expect(window.map((m: { id: string }) => m.id)).toEqual([first.id, target.id, third.id]);
  });

  it('rejects combining around with before in the same request', async () => {
    const { h, fetch } = withRealThreads();
    const t = h.runtime.services.threads.bindOrGet('web', 'web-5', null);
    const msg = await send(fetch, t.id, 'm0');

    const res = await fetch(`/api/w/ws1/threads/${t.id}/messages?around=${msg.id}&before=2026-01-01T00:00:00.000Z`, { headers: authed() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation');
  });

  it('a target id from another thread is not found', async () => {
    const { h, fetch } = withRealThreads();
    const other = h.runtime.services.threads.bindOrGet('web', 'web-6a', null);
    const elsewhere = await send(fetch, other.id, 'over here');
    const t = h.runtime.services.threads.bindOrGet('web', 'web-6b', null);
    await send(fetch, t.id, 'over there');

    const res = await fetch(`/api/w/ws1/threads/${t.id}/messages?around=${elsewhere.id}`, { headers: authed() });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });
});
