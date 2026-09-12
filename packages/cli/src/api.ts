/**
 * `ApiClient` — the only place the CLI (and, through it, the TUI) talks to the daemon.
 * Coded strictly against docs/API.md: bearer auth, `{ error: { code, message, details, retryable } }`
 * envelopes, workspace-scoped routes under `/api/w/:ws`, SSE with `id:` sequence resume.
 *
 * Agent mode: when `AC_RUN_TOKEN` is set the same client authenticates with the run token and routes
 * writes through `POST /api/w/:ws/agent/tools/:tool` (PLAN §9.5), so `weave ticket comment` works
 * identically for a human and for an agent inside a run.
 */
import type { ErrorCode, ToolResult } from '@weave-ai/shared';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  token?: string | null;
  runToken?: string | null;
  workspace?: string | null;
  fetchImpl?: FetchLike;
  userAgent?: string;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
  /** Return the response body as text instead of parsing JSON (raw run logs, openapi, llms.txt). */
  raw?: boolean;
  signal?: AbortSignal;
}

/** A write that has both an HTTP route (human token) and an agent tool (run token). */
export interface WriteSpec<T> {
  tool?: string;
  input?: Record<string, unknown>;
  http: { method: string; path: string; body?: unknown; query?: RequestOptions['query'] };
  /** Set when the agent tool returns a different shape than the HTTP route. */
  fromTool?: (data: unknown) => T;
}

export interface SseMessage { type: string; id: string | null; data: string; json: unknown }

export interface StreamOptions {
  onMessage: (message: SseMessage) => void;
  onOpen?: () => void;
  /** Called on every disconnect; the stream reconnects on its own unless `close()` was called. */
  onError?: (error: unknown, attempt: number) => void;
  signal?: AbortSignal;
  /** Resume point: sent as `?after=` and as `Last-Event-ID`. */
  after?: string | number | null;
  query?: RequestOptions['query'];
  maxRetryMs?: number;
}

export interface Subscription { close(): void; readonly closed: boolean }

export class ApiClient {
  readonly baseUrl: string;
  token: string | null;
  runToken: string | null;
  workspace: string | null;
  private readonly fetchImpl: FetchLike;
  private readonly userAgent: string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token ?? null;
    this.runToken = options.runToken ?? null;
    this.workspace = options.workspace ?? null;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.userAgent = options.userAgent ?? 'ac-cli';
  }

  /** True when the client authenticates as an agent inside a run. */
  get isAgent(): boolean { return this.runToken !== null && this.runToken !== ''; }

  get authToken(): string | null { return this.runToken || this.token; }

  /** Workspace-scoped path: `/tickets` → `/api/w/acme/tickets`. */
  w(path: string): string {
    if (!this.workspace) throw new ApiError('validation', 'no workspace selected: pass --workspace, set AC_WORKSPACE, or run inside a workspace directory', 400);
    const suffix = path === '' ? '' : path.startsWith('/') ? path : `/${path}`;
    return `/api/w/${encodeURIComponent(this.workspace)}${suffix}`;
  }

  url(path: string, query?: RequestOptions['query']): string {
    const u = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === null || v === undefined || v === '') continue;
      u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': this.userAgent, ...(options.headers ?? {}) };
    const auth = this.authToken;
    if (auth) headers['authorization'] = `Bearer ${auth}`;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path, options.query), { method, headers, body, signal: options.signal });
    } catch (cause) {
      throw new ApiError('net_daemon_unreachable', `cannot reach the daemon at ${this.baseUrl} (${(cause as Error)?.message ?? 'network error'})`, 0, undefined, true);
    }

    const text = await res.text().catch(() => '');
    if (!res.ok) throw toApiError(res.status, text);
    if (options.raw) return text as unknown as T;
    if (!text) return undefined as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  get<T = unknown>(path: string, query?: RequestOptions['query'], options: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, { ...options, query });
  }
  post<T = unknown>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }
  patch<T = unknown>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }
  put<T = unknown>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }
  del<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  /** Workspace-scoped shorthands. */
  wget<T = unknown>(path: string, query?: RequestOptions['query'], options: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', this.w(path), { ...options, query });
  }
  wpost<T = unknown>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', this.w(path), { ...options, body });
  }

  /** `POST /api/w/:ws/agent/tools/:tool` — unwraps the `ToolResult` envelope. */
  async tool<T = unknown>(tool: string, input: Record<string, unknown> = {}): Promise<T> {
    const result = await this.request<ToolResult<T>>('POST', this.w(`/agent/tools/${encodeURIComponent(tool)}`), { body: { input } });
    if (result && typeof result === 'object' && 'ok' in result) {
      if (result.ok) return result.data;
      throw new ApiError(result.error.code, result.error.message, 400, result.error.details, result.error.retryable);
    }
    return result as unknown as T;
  }

  /** Route a write through the agent tool when we hold a run token, over HTTP otherwise. */
  async write<T = unknown>(spec: WriteSpec<T>): Promise<T> {
    if (this.isAgent && spec.tool) {
      const data = await this.tool<unknown>(spec.tool, spec.input ?? {});
      return (spec.fromTool ? spec.fromTool(data) : (data as T));
    }
    return this.request<T>(spec.http.method, spec.http.path, { body: spec.http.body, query: spec.http.query });
  }

  /**
   * SSE with reconnect. Resumes from the last `id:` seen, so a dropped connection never loses
   * events; `close()` (or an aborted signal) is the only way it stops.
   */
  stream(path: string, options: StreamOptions): Subscription {
    const controller = new AbortController();
    let closed = false;
    let lastId: string | null = options.after === null || options.after === undefined ? null : String(options.after);
    const maxRetry = options.maxRetryMs ?? 15_000;

    const onAbort = () => { closed = true; controller.abort(); };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    void (async () => {
      let attempt = 0;
      while (!closed) {
        try {
          const headers: Record<string, string> = { accept: 'text/event-stream', 'cache-control': 'no-cache', 'user-agent': this.userAgent };
          const auth = this.authToken;
          if (auth) headers['authorization'] = `Bearer ${auth}`;
          if (lastId !== null) headers['last-event-id'] = lastId;
          const query = { ...(options.query ?? {}) };
          if (lastId !== null) query['after'] = lastId;

          const res = await this.fetchImpl(this.url(path, query), { method: 'GET', headers, signal: controller.signal });
          if (!res.ok) throw toApiError(res.status, await res.text().catch(() => ''));
          if (!res.body) throw new ApiError('internal', 'event stream has no body', 500);
          attempt = 0;
          options.onOpen?.();

          const decoder = new TextDecoder();
          let buffer = '';
          const reader = (res.body as unknown as ReadableStream<Uint8Array>).getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = indexOfFrameEnd(buffer)) !== -1) {
              const frame = buffer.slice(0, idx);
              buffer = buffer.slice(idx).replace(/^(\r?\n){2}/, '');
              const message = parseFrame(frame);
              if (!message) continue;
              if (message.id !== null) lastId = message.id;
              try { options.onMessage(message); } catch { /* a bad handler must not kill the stream */ }
            }
          }
          if (!closed) throw new ApiError('net_daemon_unreachable', 'event stream closed by the daemon', 0, undefined, true);
        } catch (error) {
          if (closed || controller.signal.aborted) break;
          attempt += 1;
          options.onError?.(error, attempt);
          const wait = Math.min(maxRetry, 500 * 2 ** Math.min(attempt, 5));
          await sleep(wait, controller.signal);
        }
      }
    })();

    return {
      close() { closed = true; controller.abort(); },
      get closed() { return closed; },
    };
  }
}

function indexOfFrameEnd(buffer: string): number {
  const a = buffer.indexOf('\n\n');
  const b = buffer.indexOf('\r\n\r\n');
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function parseFrame(frame: string): SseMessage | null {
  let type = 'message';
  let id: string | null = null;
  const data: string[] = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue;    // heartbeat comment
    const colon = rawLine.indexOf(':');
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    const value = colon === -1 ? '' : rawLine.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') type = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0 && type === 'message') return null;
  const text = data.join('\n');
  let json: unknown = null;
  if (text) { try { json = JSON.parse(text); } catch { json = null; } }
  return { type, id, data: text, json };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function toApiError(status: number, text: string): ApiError {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string; details?: Record<string, unknown>; retryable?: boolean } };
    const e = parsed?.error;
    if (e && (e.code || e.message)) {
      return new ApiError(e.code ?? 'internal', e.message ?? `request failed with ${status}`, status, e.details, e.retryable === true);
    }
  } catch { /* not a typed envelope */ }
  const code = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 409 ? 'conflict' : status >= 500 ? 'internal' : 'validation';
  return new ApiError(code, text ? text.slice(0, 300) : `request failed with ${status}`, status, undefined, status >= 500);
}
