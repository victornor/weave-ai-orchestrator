/**
 * HTTP client for the daemon API (docs/API.md).
 * Session cookie is the primary credential for the web app; a bearer token is
 * kept as well so the same client works when cookies are unavailable (PWA on
 * iOS in some contexts, or a token pasted from `oc login`).
 */

const TOKEN_KEY = 'oc.token';
const WS_KEY = 'oc.ws';

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

export interface RequestInitLike {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  raw?: BodyInit;
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

  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (body ? 'POST' : 'GET'),
      credentials: 'include',
      headers,
      ...(body === undefined ? {} : { body }),
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new NetworkError();
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed: unknown = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const err = (parsed as { error?: ApiErrorBody } | undefined)?.error;
    throw new ApiError(res.status, err ?? { code: `HTTP_${res.status}`, message: res.statusText || 'Request failed' });
  }
  return parsed as T;
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
