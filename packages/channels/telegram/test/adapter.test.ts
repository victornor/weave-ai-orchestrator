import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermanentChannelError, RetryableChannelError, textMessage, type ChannelContext, type InboundMessage } from '@agent-conductor/channel-sdk';
import { createTelegramAdapter } from '../src/index.js';
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

function makeCtx(config: Record<string, unknown>): ChannelContext & { inboundMessages: InboundMessage[]; logs: Array<{ level: string; msg: string }> } {
  const inboundMessages: InboundMessage[] = [];
  const logs: Array<{ level: string; msg: string }> = [];
  return {
    workspaceId: 'acme',
    config,
    async inbound(msg) { inboundMessages.push(msg); },
    log(level, msg) { logs.push({ level, msg }); },
    inboundMessages,
    logs,
  };
}

const okBody = (result: unknown): Reply => ({ body: { ok: true, result } });

afterEach(() => { vi.restoreAllMocks(); });

describe('config validation', () => {
  it('requires a bot token and rejects unresolved env references', () => {
    const adapter = createTelegramAdapter();
    expect(adapter.validateConfig({ botToken: 't', allowedUserIds: [1] })).toEqual({ ok: true });
    expect(adapter.validateConfig({}).ok).toBe(false);
    const unresolved = adapter.validateConfig({ botToken: '${TELEGRAM_BOT_TOKEN}' });
    expect(unresolved.ok).toBe(false);
    expect(unresolved.ok === false && unresolved.errors[0]).toContain('unresolved');
  });

  it('publishes a json schema with botToken and allowedUserIds', () => {
    const schema = createTelegramAdapter().configSchema() as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(schema.properties)).toContain('allowedUserIds');
    expect(schema.required).toEqual(['botToken']);
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
