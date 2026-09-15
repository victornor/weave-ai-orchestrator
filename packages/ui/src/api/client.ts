/**
 * HTTP client for the daemon API (docs/API.md).
 * Session cookie is the primary credential for the web app; a bearer token is
 * kept as well so the same client works when cookies are unavailable (PWA on
 * iOS in some contexts, or a token pasted from `weave login`).
 */

const TOKEN_KEY = 'conductor.token';
const WS_KEY = 'conductor.ws';

let memoryToken: string | null = null;

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = localStorage.getItem(TOKEN_KEY);
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

export function setToken(token: string | null, remember: boolean): void {
  memoryToken = token;
  try {
    if (token && remember) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

export function getWorkspaceId(): string | null {
  try {
    return localStorage.getItem(WS_KEY);
  } catch {
    return null;
  }
}

export function setWorkspaceId(id: string): void {
  try {
    localStorage.setItem(WS_KEY, id);
  } catch {
    /* ignore */
  }
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: unknown;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message || body.code);
    this.name = 'ApiError';
    this.code = body.code;
    this.status = status;
    this.retryable = body.retryable ?? false;
    this.details = body.details;
  }
}

/** Thrown when the daemon could not be reached at all. */
export class NetworkError extends Error {
  readonly code = 'NET_DAEMON_UNREACHABLE';
  constructor(message = 'The daemon did not respond.') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** GET/HEAD abort so a starved request becomes an error instead of an eternal skeleton (VS-227). */
export const GET_TIMEOUT_MS = 30_000;
/** POST/PUT/PATCH/DELETE abort so a send cannot sit on “Sending…” forever (VS-227). */
export const SEND_TIMEOUT_MS = 15_000;

export interface RequestInitLike {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  raw?: BodyInit;
  /** Override the method's default abort; `0` disables the timer. */
  timeoutMs?: number;
}

function combineSignals(signals: AbortSignal[]): AbortSignal | undefined {
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const ctrl = new AbortController();
  const abortFrom = (s: AbortSignal): void => {
    if (!ctrl.signal.aborted) ctrl.abort(s.reason);
  };
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      return ctrl.signal;
    }
    s.addEventListener('abort', () => abortFrom(s), { once: true });
  }
  return ctrl.signal;
}

/** Reject with `NetworkError` if `promise` has not settled within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new NetworkError()), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export async function request<T>(path: string, init: RequestInitLike = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...init.headers };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let body: BodyInit | undefined = init.raw;
  if (init.body !== undefined && init.raw === undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }

  const method = init.method ?? (body ? 'POST' : 'GET');
  const timeoutMs = init.timeoutMs ?? ((method === 'GET' || method === 'HEAD') ? GET_TIMEOUT_MS : SEND_TIMEOUT_MS);
  const timeoutCtrl = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => timeoutCtrl.abort(), timeoutMs) : undefined;
  const signal = combineSignals([
    ...(init.signal ? [init.signal] : []),
    ...(timeoutMs > 0 ? [timeoutCtrl.signal] : []),
  ]);

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'include',
      headers,
      ...(body === undefined ? {} : { body }),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    const aborted = cause instanceof DOMException && (cause.name === 'AbortError' || cause.name === 'TimeoutError');
    if (aborted) {
      // Query cancellation must stay AbortError so TanStack does not surface it as a failed fetch.
      if (timeoutCtrl.signal.aborted && !init.signal?.aborted) throw new NetworkError();
      throw cause;
    }
    throw new NetworkError();
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed: unknown = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const err = (parsed as { error?: ApiErrorBody } | undefined)?.error;
    if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized();
    throw new ApiError(res.status, err ?? { code: `HTTP_${res.status}`, message: res.statusText || 'Request failed' });
  }
  return parsed as T;
}

/**
 * A 401 outside the auth routes means the session is gone (expired, revoked, or a cookie the
 * daemon no longer recognises): forget the token and go to the login page once, remembering
 * where we were so sign-in can return there. `/login` is terminal so the redirect cannot loop
 * (VS-353, VS-456).
 */
let redirecting = false;
function onUnauthorized(): void {
  const path = window.location.pathname;
  if (redirecting || path === '/login') return;
  redirecting = true;
  setToken(null, true);
  const next = path + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

/**
 * List endpoints answer with a bare array, `{ items, total }` (the daemon's paged shape) or a
 * named key (`{ tickets }`); accept all three so a hook never turns a 200 into "undefined data".
 */
export function listOf<T>(payload: unknown, key?: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    if (Array.isArray(rec['items'])) return rec['items'] as T[];
    if (key && Array.isArray(rec[key])) return rec[key] as T[];
    for (const v of Object.values(rec)) if (Array.isArray(v)) return v as T[];
  }
  return [];
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  /** Daemon-level (no workspace). */
  root<T>(path: string, init?: RequestInitLike): Promise<T> {
    return request<T>(`/api${path}`, init);
  },
  /** Workspace-scoped. */
  ws<T>(workspace: string, path: string, init?: RequestInitLike): Promise<T> {
    return request<T>(`/api/w/${encodeURIComponent(workspace)}${path}`, init);
  },
  qs,
};

export { qs };
