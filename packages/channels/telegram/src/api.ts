import { PermanentChannelError, RetryableChannelError } from '@weave-ai/channel-sdk';
import type { TelegramCall } from './render.js';
import type { TelegramUpdate } from './updates.js';

export type FetchLike = typeof globalThis.fetch;

export interface TelegramApiError { status?: number; description?: string; retryAfterSec?: number; cause?: unknown }
export type MappedError = (RetryableChannelError | PermanentChannelError) & { retryAfterSec?: number; status?: number };

/** Map a Bot API failure onto the channel-sdk error taxonomy. Pure. */
export function mapTelegramError(input: TelegramApiError): MappedError {
  const desc = (input.description ?? '').toLowerCase();
  const status = input.status;
  const attach = (err: RetryableChannelError | PermanentChannelError): MappedError => {
    const e = err as MappedError;
    if (status != null) e.status = status;
    if (input.retryAfterSec != null) e.retryAfterSec = input.retryAfterSec;
    return e;
  };
  const message = input.description ?? (status != null ? `telegram http ${status}` : 'telegram network failure');

  if (status == null) return attach(new RetryableChannelError(message, 'network'));
  if (status === 429) return attach(new RetryableChannelError(message, 'rate_limited'));
  if (status >= 500) return attach(new RetryableChannelError(message, 'server_error'));
  if (status === 401) return attach(new PermanentChannelError(message, 'unauthorized'));
  if (status === 403) return attach(new PermanentChannelError(message, /blocked/.test(desc) ? 'blocked' : 'forbidden'));
  if (status === 404) return attach(new PermanentChannelError(message, 'not_found'));
  if (status === 400) {
    if (/chat not found/.test(desc)) return attach(new PermanentChannelError(message, 'chat_not_found'));
    if (/user is deactivated|bot was blocked/.test(desc)) return attach(new PermanentChannelError(message, 'blocked'));
    if (isParseError(status, input.description)) return attach(new PermanentChannelError(message, 'parse_error'));
    return attach(new PermanentChannelError(message, 'bad_request'));
  }
  if (status >= 400) return attach(new PermanentChannelError(message, 'bad_request'));
  return attach(new RetryableChannelError(message, 'unexpected_status'));
}

/** MarkdownV2 rejected by Telegram: the caller should resend as plain text. */
export function isParseError(status: number | undefined, description: string | undefined): boolean {
  if (status !== 400) return false;
  return /can't parse entities|can not parse entities|unsupported parse_mode|entities/i.test(description ?? '');
}

export const isRetryable = (err: unknown): err is RetryableChannelError => err instanceof RetryableChannelError;

interface RawResponse<T> { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number; migrate_to_chat_id?: number } }

export interface TelegramClientOptions {
  botToken: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
}

/** Thin Bot API client: fetch only, no dependencies. */
export class TelegramClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  constructor(private readonly opts: TelegramClientOptions) {
    this.base = (opts.apiBaseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '');
    this.timeoutMs = opts.requestTimeoutMs ?? 20_000;
  }

  private get fetchImpl(): FetchLike {
    return this.opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  private url(method: string): string {
    return `${this.base}/bot${this.opts.botToken}/${method}`;
  }

  private signal(timeoutMs: number, external?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return external ? AbortSignal.any([timeout, external]) : timeout;
  }

  private async finish<T>(res: Response): Promise<T> {
    let body: RawResponse<T> | null = null;
    try { body = (await res.json()) as RawResponse<T>; } catch { body = null; }
    if (!res.ok || !body?.ok) {
      throw mapTelegramError({
        status: res.status,
        ...(body?.description ? { description: body.description } : {}),
        ...(body?.parameters?.retry_after != null ? { retryAfterSec: body.parameters.retry_after } : {}),
      });
    }
    return body.result as T;
  }

  async call<T>(method: string, params: Record<string, unknown>, o: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(method), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: this.signal(o.timeoutMs ?? this.timeoutMs, o.signal),
      });
    } catch (cause) {
      throw mapTelegramError({ description: `network error calling ${method}: ${(cause as Error)?.message ?? String(cause)}`, cause });
    }
    return this.finish<T>(res);
  }

  /** multipart/form-data upload (sendDocument with inline bytes). */
  async upload<T>(call: TelegramCall, o: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    const form = new FormData();
    for (const [k, v] of Object.entries(call.params)) {
      if (v == null) continue;
      form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    if (call.file) {
      const bytes = new Uint8Array(call.file.data);
      form.append(call.file.field, new Blob([bytes], { type: call.file.mime || 'application/octet-stream' }), call.file.name);
    }
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(call.method), {
        method: 'POST',
        body: form,
        signal: this.signal(o.timeoutMs ?? Math.max(this.timeoutMs, 60_000), o.signal),
      });
    } catch (cause) {
      throw mapTelegramError({ description: `network error uploading to ${call.method}: ${(cause as Error)?.message ?? String(cause)}`, cause });
    }
    return this.finish<T>(res);
  }

  async getUpdates(offset: number, timeoutSec: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>(
      'getUpdates',
      { offset, timeout: timeoutSec, allowed_updates: ['message', 'edited_message', 'callback_query'] },
      { ...(signal ? { signal } : {}), timeoutMs: (timeoutSec + 15) * 1000 },
    );
  }

  async getMe(signal?: AbortSignal): Promise<{ id: number; username?: string }> {
    return this.call('getMe', {}, signal ? { signal } : {});
  }

  async sendChatAction(chatId: string, action = 'typing', signal?: AbortSignal): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action }, signal ? { signal } : {});
  }

  async answerCallbackQuery(id: string, text?: string, signal?: AbortSignal): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) }, signal ? { signal } : {});
  }
}
