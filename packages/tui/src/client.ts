/**
 * The slice of `@openconductor/cli`'s `ApiClient` the terminal apps need. Declared structurally so
 * the TUI never imports the CLI (the CLI imports the TUI, not the other way round).
 */
export interface TuiSseMessage { type: string; id: string | null; data: string; json: unknown }

export interface TuiSubscription { close(): void; readonly closed: boolean }

export interface TuiStreamOptions {
  onMessage: (message: TuiSseMessage) => void;
  onOpen?: () => void;
  onError?: (error: unknown, attempt: number) => void;
  after?: string | number | null;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export interface TuiClient {
  readonly baseUrl: string;
  readonly isAgent: boolean;
  workspace: string | null;
  /** Workspace-scoped path builder: `/tickets` becomes `/api/w/<ws>/tickets`. */
  w(path: string): string;
  get<T = unknown>(path: string, query?: Record<string, string | number | boolean | null | undefined>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  wget<T = unknown>(path: string, query?: Record<string, string | number | boolean | null | undefined>): Promise<T>;
  wpost<T = unknown>(path: string, body?: unknown): Promise<T>;
  stream(path: string, options: TuiStreamOptions): TuiSubscription;
}

/** Responses may wrap the entity or be the entity. */
export function unwrap<T>(payload: unknown, key: string): T {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const inner = (payload as Record<string, unknown>)[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner as T;
  }
  return payload as T;
}

export function items<T>(payload: unknown, key?: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record['items'])) return record['items'] as T[];
    if (key && Array.isArray(record[key])) return record[key] as T[];
    for (const value of Object.values(record)) if (Array.isArray(value)) return value as T[];
  }
  return [];
}
