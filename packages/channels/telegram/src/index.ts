import {
  PermanentChannelError, RetryableChannelError,
  type ChannelAdapter, type ChannelCapabilities, type ChannelContext, type JsonSchema,
  type OutboundMessage, type RunningChannel, type SendResult,
} from '@openconductor/channel-sdk';
import { TelegramClient, isParseError, mapTelegramError, type FetchLike, type MappedError } from './api.js';
import { CallbackCodec } from './callbacks.js';
import { TELEGRAM_CONFIG_JSON_SCHEMA, validateTelegramConfig, type TelegramConfig } from './config.js';
import { buildCalls, type TelegramCall } from './render.js';
import { parseUpdate, type TelegramUpdate } from './updates.js';

export * from './api.js';
export * from './callbacks.js';
export * from './config.js';
export * from './markdown.js';
export * from './render.js';
export * from './updates.js';

export const capabilities: ChannelCapabilities = {
  supportsButtons: true,
  supportsMarkdown: true,
  supportsEdit: true,
  supportsThreads: false,
  supportsFiles: true,
  maxTextBytes: 4096,
};

export interface TelegramAdapterOptions {
  fetchImpl?: FetchLike;
  /** Injected for tests: resolves after `ms` or when the channel stops. */
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
}

interface RunningState {
  ctx: ChannelContext;
  cfg: TelegramConfig;
  client: TelegramClient;
  abort: AbortController;
  stopped: boolean;
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done(): void { clearTimeout(t); signal.removeEventListener('abort', done); resolve(); }
  });

const messageId = (result: unknown): string | undefined => {
  const id = (result as { message_id?: number } | null)?.message_id;
  return id == null ? undefined : String(id);
};

export function createTelegramAdapter(options: TelegramAdapterOptions = {}): ChannelAdapter {
  const codec = new CallbackCodec();
  const sleep = options.sleep ?? defaultSleep;
  const rejectedUsers = new Set<string>();
  let state: RunningState | null = null;

  const send = async (msg: OutboundMessage): Promise<SendResult> => {
    if (!state || state.stopped) {
      return { delivered: false, error: { code: 'not_started', retryable: true, message: 'telegram channel is not running' } };
    }
    const { client, abort } = state;
    const replyTo = msg.replyToExternalId != null ? Number(msg.replyToExternalId) : undefined;
    const calls = buildCalls(msg.message, {
      chatId: msg.threadExternalId,
      encode: (ref) => codec.encode(ref),
      ...(replyTo != null && Number.isFinite(replyTo) ? { replyToMessageId: replyTo } : {}),
    });
    if (!calls.length) return { delivered: true };

    let lastId: string | undefined;
    for (const call of calls) {
      try {
        lastId = messageId(await dispatch(client, call, abort.signal));
      } catch (err) {
        const mapped = err as MappedError;
        if (mapped instanceof PermanentChannelError && isParseError(mapped.status, mapped.message) && call.fallback) {
          try {
            lastId = messageId(await dispatch(client, { ...call, params: call.fallback, ...(call.file ? { file: call.file } : {}) }, abort.signal));
            continue;
          } catch (retryErr) {
            return failure(retryErr, state.ctx);
          }
        }
        return failure(err, state.ctx);
      }
    }
    return lastId != null ? { delivered: true, externalMessageId: lastId } : { delivered: true };
  };

  const start = async (ctx: ChannelContext): Promise<RunningChannel> => {
    const validated = validateTelegramConfig(ctx.config);
    if (!validated.ok) throw new PermanentChannelError(`invalid telegram config: ${validated.errors.join('; ')}`, 'validation');
    const cfg = validated.value;
    const client = new TelegramClient({
      botToken: cfg.botToken,
      ...(cfg.apiBaseUrl ? { apiBaseUrl: cfg.apiBaseUrl } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    const abort = new AbortController();
    const running: RunningState = { ctx, cfg, client, abort, stopped: false };
    state = running;

    const allowed = new Set(cfg.allowedUserIds);
    const loop = (async (): Promise<void> => {
      let offset = 0;
      let backoffMs = 1000;
      while (!running.stopped) {
        let updates: TelegramUpdate[];
        try {
          updates = await client.getUpdates(offset, cfg.pollTimeoutSec, abort.signal);
          backoffMs = 1000;
        } catch (err) {
          if (running.stopped) break;
          if (err instanceof PermanentChannelError) {
            ctx.log('error', 'telegram polling stopped: permanent error', { code: err.code, message: err.message });
            break;
          }
          const retryAfter = (err as MappedError).retryAfterSec;
          const waitMs = retryAfter != null ? retryAfter * 1000 : backoffMs;
          ctx.log('warn', 'telegram polling failed, retrying', { message: (err as Error).message, waitMs });
          await sleep(waitMs, abort.signal);
          backoffMs = Math.min(backoffMs * 2, 30_000);
          continue;
        }
        for (const update of updates) {
          offset = update.update_id + 1;
          if (running.stopped) break;
          try {
            await handleUpdate(update, running, allowed, codec, rejectedUsers);
          } catch (err) {
            ctx.log('warn', 'telegram update handling failed', { message: (err as Error).message, updateId: update.update_id });
          }
        }
      }
    })();

    ctx.log('info', 'telegram channel started', { workspaceId: ctx.workspaceId, allowedUsers: cfg.allowedUserIds.length });

    return {
      async stop(): Promise<void> {
        running.stopped = true;
        abort.abort();
        await loop.catch(() => undefined);
        if (state === running) state = null;
      },
    };
  };

  return {
    kind: 'telegram',
    capabilities,
    configSchema(): JsonSchema { return TELEGRAM_CONFIG_JSON_SCHEMA; },
    validateConfig(config: unknown) {
      const res = validateTelegramConfig(config);
      return res.ok ? ({ ok: true } as const) : ({ ok: false, errors: res.errors } as const);
    },
    start,
    send,
  };
}

async function dispatch(client: TelegramClient, call: TelegramCall, signal: AbortSignal): Promise<unknown> {
  if (call.file) return client.upload(call, { signal });
  return client.call(call.method, call.params, { signal });
}

function failure(err: unknown, ctx: ChannelContext): SendResult {
  const mapped = err instanceof RetryableChannelError || err instanceof PermanentChannelError
    ? (err as MappedError)
    : mapTelegramError({ description: (err as Error)?.message ?? String(err), cause: err });
  const retryable = mapped instanceof RetryableChannelError;
  ctx.log(retryable ? 'warn' : 'error', 'telegram send failed', { code: mapped.code, message: mapped.message });
  return { delivered: false, error: { code: mapped.code, retryable, message: mapped.message } };
}

async function handleUpdate(
  update: TelegramUpdate,
  running: RunningState,
  allowed: Set<number>,
  codec: CallbackCodec,
  rejectedUsers: Set<string>,
): Promise<void> {
  const { ctx, client, abort } = running;
  const parsed = parseUpdate(update, (data) => codec.decode(data));
  if (parsed.kind === 'ignored') {
    ctx.log('debug', 'telegram update ignored', { reason: parsed.reason, updateId: update.update_id });
    return;
  }
  if (allowed.size && !allowed.has(parsed.userId)) {
    const key = String(parsed.userId);
    if (!rejectedUsers.has(key)) {
      rejectedUsers.add(key);
      ctx.log('warn', 'telegram message from user not in allowedUserIds (ignored)', { userId: key });
    }
    if (parsed.kind === 'callback') await client.answerCallbackQuery(parsed.callbackQueryId, 'Not authorised.', abort.signal).catch(() => undefined);
    return;
  }

  if (parsed.kind === 'callback') {
    await client.answerCallbackQuery(parsed.callbackQueryId, parsed.ref ? undefined : 'This button has expired.', abort.signal).catch(() => undefined);
    if (!parsed.inbound) {
      ctx.log('warn', 'telegram callback data could not be resolved', { data: parsed.data });
      return;
    }
    await ctx.inbound(parsed.inbound);
    return;
  }

  await client.sendChatAction(String(parsed.chatId), 'typing', abort.signal).catch(() => undefined);
  await ctx.inbound(parsed.inbound);
}

export const adapter: ChannelAdapter = createTelegramAdapter();
export default adapter;
