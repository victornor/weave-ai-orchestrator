import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermanentChannelError, RetryableChannelError, textMessage, type ChannelContext, type InboundMessage, type RejectedContact } from '@weave-ai/channel-sdk';
import { createTelegramAdapter, PROGRESS_DELETE_AFTER_MS } from '../src/index.js';
import { mapTelegramError, isParseError } from '../src/api.js';
import { parseUpdate } from '../src/updates.js';
import { CallbackCodec } from '../src/callbacks.js';

interface Call { method: string; body: unknown; form?: FormData }

type Reply = { status?: number; body: Record<string, unknown> } | 'hang';

/** `hang` models Telegram's long poll: the request only settles when the channel stops. */
function makeFetch(responder: (method: string, body: Record<string, unknown>) => Reply) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = url.split('/').pop() ?? '';
    const raw = init?.body;
    const parsed = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : {};
    calls.push({ method, body: parsed, ...(raw instanceof FormData ? { form: raw } : {}) });
    const res = responder(method, parsed);
    if (res === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetchImpl: fetchImpl as unknown as typeof globalThis.fetch, calls };
}

function makeCtx(config: Record<string, unknown>): ChannelContext & { inboundMessages: InboundMessage[]; logs: Array<{ level: string; msg: string }>; rejectedContacts: RejectedContact[] } {
  const inboundMessages: InboundMessage[] = [];
  const logs: Array<{ level: string; msg: string }> = [];
  const rejectedContacts: RejectedContact[] = [];
  return {
    workspaceId: 'acme',
    config,
    async inbound(msg) { inboundMessages.push(msg); },
    async rejected(contact) { rejectedContacts.push(contact); },
    log(level, msg) { logs.push({ level, msg }); },
    inboundMessages,
    logs,
    rejectedContacts,
  };
}

const okBody = (result: unknown): Reply => ({ body: { ok: true, result } });

afterEach(() => { vi.restoreAllMocks(); });

describe('config validation', () => {
  it('accepts a missing bot token at the schema level (VS-125: it may live in the secret store instead) but rejects an unresolved env reference', () => {
    const adapter = createTelegramAdapter();
    expect(adapter.validateConfig({ botToken: 't', allowedUserIds: [1] })).toEqual({ ok: true });
    expect(adapter.validateConfig({}).ok).toBe(true);
    const unresolved = adapter.validateConfig({ botToken: '${TELEGRAM_BOT_TOKEN}' });
    expect(unresolved.ok).toBe(false);
    expect(unresolved.ok === false && unresolved.errors[0]).toContain('unresolved');
  });

  it('refuses to start without a resolved token even though the schema allows it', async () => {
    const adapter = createTelegramAdapter();
    const ctx = makeCtx({ allowedUserIds: [] });
    await expect(adapter.start(ctx)).rejects.toThrow(/no bot token resolved/);
  });

  it('publishes a json schema with botToken and allowedUserIds, neither required', () => {
    const schema = createTelegramAdapter().configSchema() as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(schema.properties)).toContain('allowedUserIds');
    expect(schema.required).toEqual([]);
  });
});

describe('update parsing', () => {
  const codec = new CallbackCodec();

  it('maps a text message', () => {
    const parsed = parseUpdate(
      { update_id: 5, message: { message_id: 11, chat: { id: -100 }, from: { id: 7, username: 'vic' }, text: ' hello ', reply_to_message: { message_id: 9 } } },
      (d) => codec.decode(d),
    );
    expect(parsed).toMatchObject({
      kind: 'message',
      userId: 7,
      chatId: -100,
      inbound: { externalThreadId: '-100', externalUserId: '7', externalMessageId: '11', text: 'hello', userLabel: '@vic', replyToExternalId: '9' },
    });
  });

  it('maps a callback query onto a decision action', () => {
    const data = codec.encode({ decisionId: 'dec_1', key: 'approve' });
    const parsed = parseUpdate(
      { update_id: 6, callback_query: { id: 'cq1', from: { id: 7, first_name: 'Vic' }, data, message: { message_id: 3, chat: { id: 42 } } } },
      (d) => codec.decode(d),
    );
    expect(parsed.kind).toBe('callback');
    expect(parsed.kind === 'callback' && parsed.inbound?.action).toEqual({ decisionId: 'dec_1', key: 'approve' });
  });

  it('ignores bots, empty messages and unknown update shapes', () => {
    expect(parseUpdate({ update_id: 1 }, () => null)).toMatchObject({ kind: 'ignored', reason: 'unsupported_update' });
    expect(parseUpdate({ update_id: 2, message: { message_id: 1, chat: { id: 1 }, from: { id: 2, is_bot: true }, text: 'x' } }, () => null))
      .toMatchObject({ kind: 'ignored', reason: 'bot_sender' });
    expect(parseUpdate({ update_id: 3, message: { message_id: 1, chat: { id: 1 }, from: { id: 2 } } }, () => null))
      .toMatchObject({ kind: 'ignored', reason: 'non_text_message' });
  });
});

describe('error mapping', () => {
  it('treats 429, 5xx and network failures as retryable', () => {
    const rate = mapTelegramError({ status: 429, description: 'Too Many Requests', retryAfterSec: 12 });
    expect(rate).toBeInstanceOf(RetryableChannelError);
    expect(rate.retryAfterSec).toBe(12);
    expect(mapTelegramError({ status: 502 })).toBeInstanceOf(RetryableChannelError);
    expect(mapTelegramError({ description: 'fetch failed' })).toBeInstanceOf(RetryableChannelError);
    expect(mapTelegramError({ description: 'fetch failed' }).code).toBe('network');
  });

  it('treats chat-not-found and blocked as permanent', () => {
    expect(mapTelegramError({ status: 400, description: 'Bad Request: chat not found' })).toMatchObject({ code: 'chat_not_found' });
    expect(mapTelegramError({ status: 403, description: 'Forbidden: bot was blocked by the user' })).toMatchObject({ code: 'blocked' });
    expect(mapTelegramError({ status: 400, description: 'Bad Request: chat not found' })).toBeInstanceOf(PermanentChannelError);
    expect(mapTelegramError({ status: 401, description: 'Unauthorized' })).toMatchObject({ code: 'unauthorized' });
  });

  it('recognises MarkdownV2 parse failures', () => {
    expect(isParseError(400, "Bad Request: can't parse entities: bad offset")).toBe(true);
    expect(isParseError(400, 'chat not found')).toBe(false);
    expect(isParseError(500, "can't parse entities")).toBe(false);
  });
});

describe('polling', () => {
  it('delivers inbound messages, acks with a typing action and ignores unlisted users', async () => {
    let served = false;
    const { fetchImpl, calls } = makeFetch((method) => {
      if (method === 'getUpdates') {
        if (served) return 'hang';
        served = true;
        return okBody([
          { update_id: 1, message: { message_id: 1, chat: { id: 5 }, from: { id: 7, username: 'vic' }, text: 'ship it' } },
          { update_id: 2, message: { message_id: 2, chat: { id: 6 }, from: { id: 99 }, text: 'let me in' } },
        ]);
      }
      return okBody(true);
    });
    const adapter = createTelegramAdapter({ fetchImpl, sleep: async () => undefined });
    const ctx = makeCtx({ botToken: 'T', allowedUserIds: [7] });
    const running = await adapter.start(ctx);
    await vi.waitFor(() => expect(ctx.inboundMessages).toHaveLength(1));
    await running.stop();

    expect(ctx.inboundMessages[0]).toMatchObject({ externalThreadId: '5', externalUserId: '7', text: 'ship it' });
    expect(calls.some((c) => c.method === 'sendChatAction')).toBe(true);
    expect(ctx.logs.some((l) => l.level === 'warn' && l.msg.includes('allowedUserIds'))).toBe(true);
  });

  it('an empty allowlist admits nobody by default (VS-125 — the old "empty means everyone" trap)', async () => {
    let served = false;
    const { fetchImpl } = makeFetch((method) => {
      if (method === 'getUpdates') {
        if (served) return 'hang';
        served = true;
        return okBody([{ update_id: 1, message: { message_id: 1, chat: { id: 5 }, from: { id: 7, username: 'vic' }, text: 'hi' } }]);
      }
      return okBody(true);
    });
    const adapter = createTelegramAdapter({ fetchImpl, sleep: async () => undefined });
    const ctx = makeCtx({ botToken: 'T', allowedUserIds: [] });
    const running = await adapter.start(ctx);
    await vi.waitFor(() => expect(ctx.logs.some((l) => l.msg.includes('allowedUserIds'))).toBe(true));
    await running.stop();
    expect(ctx.inboundMessages).toHaveLength(0);
  });

  it('records a rejected sender by identity and never calls inbound for them (VS-135)', async () => {
    let served = false;
    const { fetchImpl } = makeFetch((method) => {
      if (method === 'getUpdates') {
        if (served) return 'hang';
        served = true;
        return okBody([{ update_id: 1, message: { message_id: 1, chat: { id: 5 }, from: { id: 99, username: 'stranger', first_name: 'Sam' }, text: 'let me in, I am your colleague' } }]);
      }
      return okBody(true);
    });
    const adapter = createTelegramAdapter({ fetchImpl, sleep: async () => undefined });
    const ctx = makeCtx({ botToken: 'T', allowedUserIds: [7] });
    const running = await adapter.start(ctx);
    await vi.waitFor(() => expect(ctx.rejectedContacts).toHaveLength(1));
    await running.stop();
    expect(ctx.rejectedContacts[0]).toEqual({ externalUserId: '99', username: 'stranger', displayName: 'Sam' });
    expect(ctx.inboundMessages).toHaveLength(0);
    expect(JSON.stringify(ctx.rejectedContacts)).not.toContain('colleague');
  });

  it('records a repeat rejection from the same sender without duplicating', async () => {
    let calls = 0;
    const { fetchImpl } = makeFetch((method) => {
      if (method === 'getUpdates') {
        calls += 1;
        if (calls > 2) return 'hang';
        return okBody([{ update_id: calls, message: { message_id: calls, chat: { id: 5 }, from: { id: 99, username: 'stranger' }, text: `attempt ${calls}` } }]);
      }
      return okBody(true);
    });
    const adapter = createTelegramAdapter({ fetchImpl, sleep: async () => undefined });
    const ctx = makeCtx({ botToken: 'T', allowedUserIds: [7] });
    const running = await adapter.start(ctx);
    await vi.waitFor(() => expect(ctx.rejectedContacts).toHaveLength(2));
    await running.stop();
    expect(ctx.rejectedContacts.every((c) => c.externalUserId === '99')).toBe(true);
  });

  it('an empty allowlist with allowAll admits everyone', async () => {
    let served = false;
    const { fetchImpl } = makeFetch((method) => {
      if (method === 'getUpdates') {
        if (served) return 'hang';
        served = true;
        return okBody([{ update_id: 1, message: { message_id: 1, chat: { id: 5 }, from: { id: 7, username: 'vic' }, text: 'hi' } }]);
      }
      return okBody(true);
    });
    const adapter = createTelegramAdapter({ fetchImpl, sleep: async () => undefined });
    const ctx = makeCtx({ botToken: 'T', allowedUserIds: [], allowAll: true });
    const running = await adapter.start(ctx);
    await vi.waitFor(() => expect(ctx.inboundMessages).toHaveLength(1));
    await running.stop();
    expect(ctx.inboundMessages[0]).toMatchObject({ externalUserId: '7', text: 'hi' });
  });

  it('a populated allowlist restricts even when allowAll is true', async () => {
    let served = false;
    const { fetchImpl } = makeFetch((method) => {
      if (method === 'getUpdates') {
        if (served) return 'hang';
        served = true;
        return okBody([{ update_id: 1, message: { message_id: 1, chat: { id: 5 }, from: { id: 99 }, text: 'hi' } }]);
      }
      return okBody(true);
    });
    const adapter = createTelegramAdapter({ fetchImpl, sleep: async () => undefined });
    const ctx = makeCtx({ botToken: 'T', allowedUserIds: [7], allowAll: true });
    const running = await adapter.start(ctx);
    await vi.waitFor(() => expect(ctx.logs.some((l) => l.msg.includes('allowedUserIds'))).toBe(true));
    await running.stop();
    expect(ctx.inboundMessages).toHaveLength(0);
  });

  it('answers callback queries and forwards the decision action', async () => {
    let served = false;
    const { fetchImpl, calls } = makeFetch((method) => {
      if (method === 'getUpdates') {
        if (served) return 'hang';
        served = true;
        return okBody([
          { update_id: 3, callback_query: { id: 'cq7', from: { id: 7 }, data: 'd:dec_42:approve', message: { message_id: 2, chat: { id: 5 } } } },
        ]);
      }
      return okBody(true);
    });
    const adapter = createTelegramAdapter({ fetchImpl, sleep: async () => undefined });
    const ctx = makeCtx({ botToken: 'T', allowedUserIds: [7] });
    const running = await adapter.start(ctx);
    await vi.waitFor(() => expect(ctx.inboundMessages).toHaveLength(1));
    await running.stop();

    expect(ctx.inboundMessages[0]!.action).toEqual({ decisionId: 'dec_42', key: 'approve' });
    expect(calls.some((c) => c.method === 'answerCallbackQuery')).toBe(true);
  });

  it('stops polling on a permanent error', async () => {
    const { fetchImpl } = makeFetch((method) => {
      if (method === 'getUpdates') return { status: 401, body: { ok: false, description: 'Unauthorized' } };
      return okBody(true);
    });
    const adapter = createTelegramAdapter({ fetchImpl, sleep: async () => undefined });
    const ctx = makeCtx({ botToken: 'bad', allowedUserIds: [] });
    const running = await adapter.start(ctx);
    await vi.waitFor(() => expect(ctx.logs.some((l) => l.level === 'error')).toBe(true));
    await running.stop();
  });
});

describe('send', () => {
  it('falls back to plain text when MarkdownV2 is rejected', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { fetchImpl } = makeFetch((method, body) => {
      if (method === 'getUpdates') return 'hang';
      if (method === 'sendMessage') {
        seen.push(body);
        if (body.parse_mode === 'MarkdownV2') return { status: 400, body: { ok: false, description: "Bad Request: can't parse entities" } };
        return okBody({ message_id: 77 });
      }
      return okBody(true);
    });
    const adapter = createTelegramAdapter({ fetchImpl, sleep: async () => undefined });
    const ctx = makeCtx({ botToken: 'T', allowedUserIds: [7] });
    const running = await adapter.start(ctx);
    const result = await adapter.send({ threadExternalId: '5', message: textMessage('hi **there**.') });
    await running.stop();

    expect(result).toEqual({ delivered: true, externalMessageId: '77' });
    expect(seen).toHaveLength(2);
    expect(seen[1]!.parse_mode).toBeUndefined();
    expect(seen[1]!.text).toBe('hi **there**.');
  });

  it('reports retryable delivery failures without throwing', async () => {
    const { fetchImpl } = makeFetch((method) => {
      if (method === 'getUpdates') return 'hang';
      return { status: 429, body: { ok: false, description: 'Too Many Requests', parameters: { retry_after: 3 } } };
    });
    const adapter = createTelegramAdapter({ fetchImpl, sleep: async () => undefined });
    const ctx = makeCtx({ botToken: 'T', allowedUserIds: [] });
    const running = await adapter.start(ctx);
    const result = await adapter.send({ threadExternalId: '5', message: textMessage('hello') });
    await running.stop();
    expect(result.delivered).toBe(false);
    expect(result.error).toMatchObject({ code: 'rate_limited', retryable: true });
  });

  it('uploads file parts as multipart/form-data', async () => {
    const { fetchImpl, calls } = makeFetch((method) => (method === 'getUpdates' ? 'hang' : okBody({ message_id: 5 })));
    const adapter = createTelegramAdapter({ fetchImpl, sleep: async () => undefined });
    const ctx = makeCtx({ botToken: 'T', allowedUserIds: [] });
    const running = await adapter.start(ctx);
    const result = await adapter.send({
      threadExternalId: '5',
      message: { text: '', parts: [{ type: 'file', name: 'r.md', mime: 'text/markdown', data: new Uint8Array([1, 2]) }] },
    });
    await running.stop();
    expect(result.delivered).toBe(true);
    const upload = calls.find((c) => c.method === 'sendDocument');
    expect(upload?.form?.get('document')).toBeInstanceOf(Blob);
  });

  it('refuses to send before start', async () => {
    const adapter = createTelegramAdapter({ fetchImpl: (() => { throw new Error('no network'); }) as unknown as typeof globalThis.fetch });
    const result = await adapter.send({ threadExternalId: '1', message: textMessage('x') });
    expect(result).toMatchObject({ delivered: false, error: { code: 'not_started', retryable: true } });
  });
});

/** VS-604: a turn shows as a refreshed typing action and one placeholder message edited in place. */
describe('progress', () => {
  afterEach(() => { vi.useRealTimers(); });

  const fakeTimers = { toFake: ['setTimeout', 'clearTimeout', 'Date'] as Array<'setTimeout' | 'clearTimeout' | 'Date'> };

  async function boot(responder: (method: string, body: Record<string, unknown>) => Reply): Promise<{
    adapter: ReturnType<typeof createTelegramAdapter>;
    ctx: ReturnType<typeof makeCtx>;
    running: { stop(): Promise<void> };
    calls: Call[];
  }> {
    const { fetchImpl, calls } = makeFetch(responder);
    const adapter = createTelegramAdapter({ fetchImpl, sleep: async () => undefined });
    const ctx = makeCtx({ botToken: 'T', allowedUserIds: [] });
    const running = await adapter.start(ctx);
    return { adapter, ctx, running, calls };
  }

  const ok = (method: string): Reply => (method === 'getUpdates' ? 'hang' : okBody({ message_id: 11 }));
  const typing = (calls: Call[]): number => calls.filter((c) => c.method === 'sendChatAction').length;
  const edits = (calls: Call[]): Call[] => calls.filter((c) => c.method === 'editMessageText');

  it('keeps the typing action refreshed inside its expiry, and stops it at the turn end', async () => {
    vi.useFakeTimers(fakeTimers);
    const { adapter, running, calls } = await boot(ok);
    await adapter.progress!({ threadExternalId: '5', phase: 'start', text: 'Working · 0 s' });
    expect(typing(calls)).toBe(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(typing(calls)).toBe(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(typing(calls)).toBe(3);

    await adapter.progress!({ threadExternalId: '5', phase: 'end' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(typing(calls)).toBe(3);
    await running.stop();
  });

  it('sends one placeholder and coalesces edits to about one per 3 s', async () => {
    vi.useFakeTimers(fakeTimers);
    const { adapter, running, calls } = await boot(ok);
    await adapter.progress!({ threadExternalId: '5', phase: 'start', text: 'Working · 0 s' });
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1);

    await adapter.progress!({ threadExternalId: '5', phase: 'update', text: 'Working · 1 s' });
    expect(edits(calls)).toHaveLength(1);
    await adapter.progress!({ threadExternalId: '5', phase: 'update', text: 'Working · 2 s' });
    expect(edits(calls)).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3000);
    await adapter.progress!({ threadExternalId: '5', phase: 'update', text: 'Working · 5 s' });
    expect(edits(calls)).toHaveLength(2);
    expect(edits(calls)[1]!.body.text).toBe('Working · 5 s');
    await running.stop();
  });

  it('honours a 429 retry_after and then sends the newest text, without failing the turn', async () => {
    vi.useFakeTimers(fakeTimers);
    let firstEdit = true;
    const { adapter, ctx, running, calls } = await boot((method) => {
      if (method === 'getUpdates') return 'hang';
      if (method === 'editMessageText' && firstEdit) {
        firstEdit = false;
        return { status: 429, body: { ok: false, description: 'Too Many Requests', parameters: { retry_after: 5 } } };
      }
      return okBody({ message_id: 11 });
    });
    await adapter.progress!({ threadExternalId: '5', phase: 'start', text: 'Working · 0 s' });
    await adapter.progress!({ threadExternalId: '5', phase: 'update', text: 'Working · 1 s' });
    expect(edits(calls)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3000);
    await adapter.progress!({ threadExternalId: '5', phase: 'update', text: 'Working · 4 s' });
    expect(edits(calls)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3000);
    await adapter.progress!({ threadExternalId: '5', phase: 'update', text: 'Working · 7 s' });
    expect(edits(calls)).toHaveLength(2);
    expect(edits(calls)[1]!.body.text).toBe('Working · 7 s');
    expect(ctx.logs.some((l) => l.msg.includes('rate limited'))).toBe(true);
    await running.stop();
  });

  it('delivers the answer with sendMessage and never editMessageText, then deletes the placeholder', async () => {
    const { adapter, running, calls } = await boot(ok);
    await adapter.progress!({ threadExternalId: '5', phase: 'start', text: 'Working · 0 s' });
    const result = await adapter.send({ threadExternalId: '5', message: textMessage('Done: shipped it.') });

    expect(result).toEqual({ delivered: true, externalMessageId: '11' });
    const sends = calls.filter((c) => c.method === 'sendMessage');
    expect(sends).toHaveLength(2); // the placeholder and the answer
    expect(String(sends[1]!.body.text)).toContain('shipped it');
    // An edit raises no Telegram notification, so the answer is never delivered as one.
    expect(edits(calls)).toHaveLength(0);
    const del = calls.find((c) => c.method === 'deleteMessage');
    expect(del?.body).toMatchObject({ chat_id: '5', message_id: 11 });
    expect(calls.indexOf(del!)).toBeGreaterThan(calls.indexOf(sends[1]!)); // deleted after the answer
    await running.stop();
  });

  it('sends a card or attachment answer normally and still deletes the placeholder', async () => {
    const { adapter, running, calls } = await boot(ok);
    await adapter.progress!({ threadExternalId: '5', phase: 'start', text: 'Working · 0 s' });
    const result = await adapter.send({
      threadExternalId: '5',
      message: { text: '', parts: [{ type: 'file', name: 'r.md', mime: 'text/markdown', data: new Uint8Array([1]) }] },
    });
    expect(result.delivered).toBe(true);
    expect(calls.some((c) => c.method === 'sendDocument')).toBe(true);
    expect(edits(calls)).toHaveLength(0);
    expect(calls.some((c) => c.method === 'deleteMessage')).toBe(true);
    await running.stop();
  });

  it('ignores a late update once the answer has been sent', async () => {
    const { adapter, running, calls } = await boot(ok);
    await adapter.progress!({ threadExternalId: '5', phase: 'start', text: 'Working · 0 s' });
    await adapter.send({ threadExternalId: '5', message: textMessage('Done.') });
    const before = calls.length;
    await adapter.progress!({ threadExternalId: '5', phase: 'update', text: 'Working · 9 s' });
    expect(calls.length).toBe(before);
    expect(edits(calls)).toHaveLength(0);
    await running.stop();
  });

  it('deletes the placeholder when no answer follows', async () => {
    vi.useFakeTimers(fakeTimers);
    const { adapter, running, calls } = await boot(ok);
    await adapter.progress!({ threadExternalId: '5', phase: 'start', text: 'Working · 0 s' });
    await adapter.progress!({ threadExternalId: '5', phase: 'end' });

    await vi.advanceTimersByTimeAsync(PROGRESS_DELETE_AFTER_MS);
    const del = calls.find((c) => c.method === 'deleteMessage');
    expect(del?.body).toMatchObject({ chat_id: '5', message_id: 11 });
    await running.stop();
  });

  it('logs and swallows a progress failure, never throwing into the run', async () => {
    const { adapter, ctx, running } = await boot((method) =>
      (method === 'getUpdates' ? 'hang' : { status: 500, body: { ok: false, description: 'server blew up' } }));
    await expect(adapter.progress!({ threadExternalId: '5', phase: 'start', text: 'Working · 0 s' })).resolves.toBeUndefined();
    await expect(adapter.progress!({ threadExternalId: '5', phase: 'update', text: 'Working · 1 s' })).resolves.toBeUndefined();
    await expect(adapter.progress!({ threadExternalId: '5', phase: 'end' })).resolves.toBeUndefined();
    expect(ctx.logs.some((l) => l.level === 'warn')).toBe(true);
    await running.stop();
  });
});
