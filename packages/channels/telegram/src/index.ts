import {
  PermanentChannelError, RetryableChannelError,
  type ChannelAdapter, type ChannelCapabilities, type ChannelContext, type ChannelProgress, type JsonSchema,
  type OutboundMessage, type RunningChannel, type SendResult,
} from '@weave-ai/channel-sdk';
import { TelegramClient, isParseError, mapTelegramError, type FetchLike, type MappedError } from './api.js';
import { CallbackCodec } from './callbacks.js';
import { TELEGRAM_CONFIG_JSON_SCHEMA, validateTelegramConfig, type TelegramConfig } from './config.js';
import { buildCalls, type TelegramCall } from './render.js';
import { parseUpdate, senderIdentity, senderOf, type TelegramUpdate } from './updates.js';

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
  /** VS-604: one progress entry per chat while a turn is live. */
  progress: Map<string, ProgressEntry>;
}

/** VS-604: the typing keep-alive, the one placeholder message, and its edit/delete timers, per chat. */
interface ProgressEntry {
  messageId: string | null;
  typing: boolean;
  typingTimer: ReturnType<typeof setTimeout> | null;
  lastEditAt: number;
  lastText: string | null;
  pendingText: string | null;
  /** A 429's `retry_after` puts edits on hold until this instant. */
  notBefore: number;
  ended: boolean;
  deleteTimer: ReturnType<typeof setTimeout> | null;
}

/** Telegram's `typing` action expires in about 5 s; refresh comfortably inside that. */
const TYPING_REFRESH_MS = 4000;
/** Telegram tolerates roughly one `editMessageText` per second; the plan targets about one per 3 s. */
const EDIT_MIN_MS = 3000;
/** How long an unconsumed placeholder waits for an answer before it is deleted. */
export const PROGRESS_DELETE_AFTER_MS = 30_000;

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
    // VS-604: the answer is always a NEW message — Telegram raises no notification for an edit — so the
    // placeholder is taken out of play now and removed after the answer lands. Late updates are ignored.
    const placeholderId = takePlaceholder(state, msg.threadExternalId);
    if (!calls.length) {
      if (placeholderId) await deletePlaceholder(state, msg.threadExternalId, placeholderId);
      return { delivered: true };
    }

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
        // Delivery failed: keep the placeholder so a retry's own send removes it.
        return failure(err, state.ctx);
      }
    }
    if (placeholderId) await deletePlaceholder(state, msg.threadExternalId, placeholderId);
    return lastId != null ? { delivered: true, externalMessageId: lastId } : { delivered: true };
  };

  /**
   * VS-604: show that a turn is live. `start` opens a placeholder and the typing keep-alive, `update`
   * edits the placeholder within the rate limits, `end` removes it after the grace period. The final
   * answer is never an edit — `send` delivers it as a new message and deletes the placeholder. Nothing
   * here throws: a Bot API failure is logged and swallowed so it can never fail the turn.
   */
  const progress = async (p: ChannelProgress): Promise<void> => {
    const running = state;
    if (!running || running.stopped) return;
    const chatId = p.threadExternalId;
    let entry = running.progress.get(chatId);
    if (p.phase === 'end') {
      if (!entry) return;
      stopProgressTimers(entry);
      entry.ended = true;
      if (entry.messageId) armPlaceholderDelete(running, chatId, entry);
      else running.progress.delete(chatId);
      return;
    }
    if (!entry) {
      entry = { messageId: null, typing: false, typingTimer: null, lastEditAt: 0, lastText: null, pendingText: null, notBefore: 0, ended: false, deleteTimer: null };
      running.progress.set(chatId, entry);
    }
    if (entry.ended) return;
    if (!entry.typing) {
      entry.typing = true;
      startTyping(running, chatId, entry);
    }
    const text = p.text ?? '';
    if (p.phase === 'start') {
      if (entry.messageId == null) {
        try {
          const result = await running.client.call<{ message_id?: number }>('sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true } }, { signal: running.abort.signal });
          entry.messageId = result?.message_id != null ? String(result.message_id) : null;
          entry.lastText = text;
        } catch (err) {
          running.ctx.log('warn', 'telegram progress placeholder failed', { message: (err as Error)?.message });
        }
      }
      return;
    }
    entry.pendingText = text;
    if (entry.messageId == null || entry.pendingText === entry.lastText) return;
    const nowMs = Date.now();
    if (nowMs < entry.notBefore || nowMs - entry.lastEditAt < EDIT_MIN_MS) return;
    await editProgress(running, chatId, entry, entry.pendingText);
  };

  const start = async (ctx: ChannelContext): Promise<RunningChannel> => {
    const validated = validateTelegramConfig(ctx.config);
    if (!validated.ok) throw new PermanentChannelError(`invalid telegram config: ${validated.errors.join('; ')}`, 'validation');
    const cfg = validated.value;
    if (!cfg.botToken) throw new PermanentChannelError('no bot token resolved for this workspace', 'validation');
    const client = new TelegramClient({
      botToken: cfg.botToken,
      ...(cfg.apiBaseUrl ? { apiBaseUrl: cfg.apiBaseUrl } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    const abort = new AbortController();
    const running: RunningState = { ctx, cfg, client, abort, stopped: false, progress: new Map() };
    state = running;

    const allowed = new Set(cfg.allowedUserIds);
    /** Meaningful only when `allowed` is empty (VS-125): an empty list otherwise means nobody, not everybody. */
    const openToAll = cfg.allowAll && allowed.size === 0;
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
            await handleUpdate(update, running, allowed, openToAll, codec, rejectedUsers);
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
        for (const entry of running.progress.values()) stopProgressTimers(entry);
        running.progress.clear();
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
    progress,
  };
}

async function dispatch(client: TelegramClient, call: TelegramCall, signal: AbortSignal): Promise<unknown> {
  if (call.file) return client.upload(call, { signal });
  return client.call(call.method, call.params, { signal });
}

/** VS-604: the typing keep-alive — a recursive, unref'd timer, cleared when the turn ends or the channel stops. */
function startTyping(running: RunningState, chatId: string, entry: ProgressEntry): void {
  const tick = (): void => {
    if (!entry.typing || running.stopped) return;
    void running.client.sendChatAction(chatId, 'typing', running.abort.signal).catch((e: unknown) =>
      running.ctx.log('warn', 'telegram typing refresh failed', { message: (e as Error)?.message }));
    entry.typingTimer = setTimeout(tick, TYPING_REFRESH_MS);
    entry.typingTimer.unref?.();
  };
  tick();
}

function stopProgressTimers(entry: ProgressEntry): void {
  entry.typing = false;
  if (entry.typingTimer) { clearTimeout(entry.typingTimer); entry.typingTimer = null; }
  if (entry.deleteTimer) { clearTimeout(entry.deleteTimer); entry.deleteTimer = null; }
}

/** Best-effort: a progress failure is logged and swallowed, never raised into the run. */
async function editProgress(running: RunningState, chatId: string, entry: ProgressEntry, text: string): Promise<void> {
  if (entry.messageId == null) return;
  try {
    await running.client.editMessageText(chatId, entry.messageId, text, { signal: running.abort.signal });
    entry.lastEditAt = Date.now();
    entry.lastText = text;
  } catch (err) {
    const mapped = err as MappedError;
    if (mapped instanceof RetryableChannelError && mapped.retryAfterSec != null) {
      entry.notBefore = Date.now() + mapped.retryAfterSec * 1000;
      running.ctx.log('warn', 'telegram progress edit rate limited', { retryAfterSec: mapped.retryAfterSec });
    } else {
      running.ctx.log('warn', 'telegram progress edit failed', { message: (err as Error)?.message });
    }
  }
}

/** VS-604: with no answer following, the placeholder is removed after a bounded grace period. */
function armPlaceholderDelete(running: RunningState, chatId: string, entry: ProgressEntry): void {
  if (entry.messageId == null) return;
  entry.deleteTimer = setTimeout(() => {
    entry.deleteTimer = null;
    if (running.stopped || running.progress.get(chatId) !== entry) return;
    running.progress.delete(chatId);
    void running.client.deleteMessage(chatId, entry.messageId!, running.abort.signal).catch((e: unknown) =>
      running.ctx.log('warn', 'telegram progress placeholder delete failed', { message: (e as Error)?.message }));
  }, PROGRESS_DELETE_AFTER_MS);
  entry.deleteTimer.unref?.();
}

/**
 * VS-604: once the answer is going out, the placeholder is out of play — its typing loop and timers stop,
 * and it is marked ended so a late `update` cannot open a second placeholder before `end` clears it.
 * Returns the placeholder's message id, or null when there is none.
 */
function takePlaceholder(running: RunningState, chatId: string): string | null {
  const entry = running.progress.get(chatId);
  if (!entry?.messageId) return null;
  stopProgressTimers(entry);
  entry.ended = true;
  return entry.messageId;
}

/**
 * VS-604: remove the placeholder after the answer has been sent (an edit would raise no Telegram
 * notification, so the answer is always a new message). Best effort: a failure is logged, never raised.
 * The emptied entry is kept briefly as a tombstone so a late `update` is ignored, then dropped.
 */
async function deletePlaceholder(running: RunningState, chatId: string, messageId: string): Promise<void> {
  const entry = running.progress.get(chatId);
  if (entry) {
    entry.messageId = null;
    entry.deleteTimer = setTimeout(() => {
      if (running.progress.get(chatId) === entry) running.progress.delete(chatId);
    }, PROGRESS_DELETE_AFTER_MS);
    entry.deleteTimer.unref?.();
  }
  await running.client.deleteMessage(chatId, messageId, running.abort.signal).catch((e: unknown) =>
    running.ctx.log('warn', 'telegram progress placeholder delete failed', { message: (e as Error)?.message }));
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
  openToAll: boolean,
  codec: CallbackCodec,
  rejectedUsers: Set<string>,
): Promise<void> {
  const { ctx, client, abort } = running;
  const parsed = parseUpdate(update, (data) => codec.decode(data));
  if (parsed.kind === 'ignored') {
    ctx.log('debug', 'telegram update ignored', { reason: parsed.reason, updateId: update.update_id });
    return;
  }
  /**
   * A populated list always restricts to itself. An empty list admits nobody unless the workspace
   * is explicitly marked open to all (VS-125) — the old behavior, where an empty list admitted
   * everyone, was the exact trap this ticket exists to close.
   */
  if (allowed.size ? !allowed.has(parsed.userId) : !openToAll) {
    const key = String(parsed.userId);
    if (!rejectedUsers.has(key)) {
      rejectedUsers.add(key);
      ctx.log('warn', 'telegram message from user not in allowedUserIds (ignored)', { userId: key });
    }
    await ctx.rejected?.({ externalUserId: key, ...senderIdentity(senderOf(update)) }).catch((e: unknown) =>
      ctx.log('warn', 'recording the rejected sender failed', { userId: key, message: (e as Error)?.message }));
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
