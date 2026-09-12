import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, type FetchLike } from './api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function recorder(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

describe('ApiClient requests', () => {
  it('sends the bearer token and builds urls with query parameters', async () => {
    const { calls, fetchImpl } = recorder(() => jsonResponse({ ok: true }));
    const client = new ApiClient({ baseUrl: 'https://conductor.example.com/', token: 'tok_1', workspace: 'acme', fetchImpl });

    await client.wget('/tickets', { status: 'todo', limit: 10, skip: null, blank: '' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://conductor.example.com/api/w/acme/tickets?status=todo&limit=10');
    expect((calls[0]!.init!.headers as Record<string, string>)['authorization']).toBe('Bearer tok_1');
  });

  it('strips the trailing slash from the base url and json-encodes bodies', async () => {
    const { calls, fetchImpl } = recorder(() => jsonResponse({}));
    const client = new ApiClient({ baseUrl: 'http://127.0.0.1:7433/', token: null, workspace: 'ws', fetchImpl });
    await client.wpost('/tickets', { title: 'hi' });
    expect(calls[0]!.url).toBe('http://127.0.0.1:7433/api/w/ws/tickets');
    expect(calls[0]!.init!.body).toBe('{"title":"hi"}');
    expect((calls[0]!.init!.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect((calls[0]!.init!.headers as Record<string, string>)['authorization']).toBeUndefined();
  });

  it('refuses workspace-scoped paths without a workspace', async () => {
    const client = new ApiClient({ baseUrl: 'http://x', fetchImpl: async () => jsonResponse({}) });
    expect(() => client.w('/tickets')).toThrowError(/no workspace selected/);
  });

  it('encodes the workspace id and keeps the bare workspace path clean', () => {
    const client = new ApiClient({ baseUrl: 'http://x', workspace: 'a b', fetchImpl: async () => jsonResponse({}) });
    expect(client.w('')).toBe('/api/w/a%20b');
    expect(client.w('tickets')).toBe('/api/w/a%20b/tickets');
  });

  it('parses the typed error envelope', async () => {
    const { fetchImpl } = recorder(() => jsonResponse({ error: { code: 'worktree_dirty', message: 'the worktree has uncommitted changes', details: { files: 3 }, retryable: false } }, 422));
    const client = new ApiClient({ baseUrl: 'http://x', workspace: 'ws', fetchImpl });
    await expect(client.wget('/tickets')).rejects.toMatchObject({
      name: 'ApiError', code: 'worktree_dirty', status: 422, details: { files: 3 }, retryable: false,
    });
  });

  it('falls back to a status-derived code for untyped errors', async () => {
    const { fetchImpl } = recorder(() => new Response('nope', { status: 404 }));
    const client = new ApiClient({ baseUrl: 'http://x', workspace: 'ws', fetchImpl });
    await expect(client.wget('/tickets')).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('turns a network failure into net_daemon_unreachable', async () => {
    const client = new ApiClient({ baseUrl: 'http://127.0.0.1:1', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    const error = await client.get('/api/health').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('net_daemon_unreachable');
    expect((error as ApiError).retryable).toBe(true);
  });

  it('returns raw text when asked, and undefined for an empty body', async () => {
    const { fetchImpl } = recorder((url) => (url.endsWith('/log') ? new Response('{"a":1}\n{"a":2}') : new Response('', { status: 200 })));
    const client = new ApiClient({ baseUrl: 'http://x', workspace: 'ws', fetchImpl });
    expect(await client.request('GET', '/api/w/ws/runs/r1/log', { raw: true })).toBe('{"a":1}\n{"a":2}');
    expect(await client.post('/api/w/ws/x')).toBeUndefined();
  });
});

describe('ApiClient agent mode', () => {
  it('prefers the run token over the session token', async () => {
    const { calls, fetchImpl } = recorder(() => jsonResponse({ ok: true, data: {} }));
    const client = new ApiClient({ baseUrl: 'http://x', token: 'tok', runToken: 'rt_abc', workspace: 'ws', fetchImpl });
    expect(client.isAgent).toBe(true);
    await client.wget('/tickets');
    expect((calls[0]!.init!.headers as Record<string, string>)['authorization']).toBe('Bearer rt_abc');
  });

  it('routes writes through the agent tool endpoint and unwraps ToolResult', async () => {
    const { calls, fetchImpl } = recorder(() => jsonResponse({ ok: true, data: { id: 'tkt_1' } }));
    const client = new ApiClient({ baseUrl: 'http://x', runToken: 'rt_abc', workspace: 'ws', fetchImpl });

    const result = await client.write<{ id: string }>({
      tool: 'weave_ticket_comment', input: { ticketId: 'ACME-42', body: 'hi' },
      http: { method: 'POST', path: '/api/w/ws/tickets/ACME-42/comments', body: { body: 'hi' } },
    });

    expect(result).toEqual({ id: 'tkt_1' });
    expect(calls[0]!.url).toBe('http://x/api/w/ws/agent/tools/weave_ticket_comment');
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ input: { ticketId: 'ACME-42', body: 'hi' } });
  });

  it('raises a typed error from a failed ToolResult', async () => {
    const { fetchImpl } = recorder(() => jsonResponse({ ok: false, error: { code: 'not_checked_out', message: 'check the ticket out first', retryable: false } }));
    const client = new ApiClient({ baseUrl: 'http://x', runToken: 'rt', workspace: 'ws', fetchImpl });
    await expect(client.tool('weave_ticket_comment', {})).rejects.toMatchObject({ code: 'not_checked_out' });
  });

  it('uses http when there is no run token, even for tool-backed writes', async () => {
    const { calls, fetchImpl } = recorder(() => jsonResponse({ id: 'tkt_1' }));
    const client = new ApiClient({ baseUrl: 'http://x', token: 'tok', workspace: 'ws', fetchImpl });
    await client.write({
      tool: 'weave_ticket_comment', input: { ticketId: 'x' },
      http: { method: 'POST', path: '/api/w/ws/tickets/x/comments', body: { body: 'hi' } },
    });
    expect(calls[0]!.url).toBe('http://x/api/w/ws/tickets/x/comments');
  });
});

describe('ApiClient.stream', () => {
  function streamResponse(chunks: string[]): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  it('parses events, tracks the last id, and ignores heartbeat comments', async () => {
    const seen: Array<{ type: string; id: string | null; json: unknown }> = [];
    const urls: string[] = [];
    let served = 0;
    const client = new ApiClient({
      baseUrl: 'http://x', workspace: 'ws', token: 'tok',
      fetchImpl: async (url) => {
        urls.push(url);
        served += 1;
        if (served === 1) return streamResponse([': heartbeat\n\n', 'event: ticket.created\nid: 7\ndata: {"seq":7}\n\n']);
        return new Promise<Response>(() => {});   // second attempt hangs: we only assert the resume url
      },
    });

    const subscription = client.stream(client.w('/events'), { onMessage: (m) => seen.push({ type: m.type, id: m.id, json: m.json }) });
    await vi.waitFor(() => expect(urls.length).toBeGreaterThan(1), { timeout: 3000 });
    subscription.close();

    expect(seen).toEqual([{ type: 'ticket.created', id: '7', json: { seq: 7 } }]);
    expect(urls[0]).toBe('http://x/api/w/ws/events');
    expect(urls[1]).toBe('http://x/api/w/ws/events?after=7');
  });

  it('reports errors and stops reconnecting once closed', async () => {
    const errors: number[] = [];
    const client = new ApiClient({
      baseUrl: 'http://x', workspace: 'ws',
      fetchImpl: async () => { throw new Error('boom'); },
    });
    const subscription = client.stream(client.w('/events'), {
      onMessage: () => undefined,
      onError: (_error, attempt) => errors.push(attempt),
    });
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0), { timeout: 3000 });
    subscription.close();
    expect(subscription.closed).toBe(true);
  });
});
