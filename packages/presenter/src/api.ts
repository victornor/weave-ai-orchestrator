import { EventSource } from 'eventsource';
import type { WorkspaceEvent } from '@openconductor/shared';
import { toAgentView } from './views.js';
import type { DesiredPresentation, EventSubscription, PresenterApi, StoredHandle } from './types.js';

export interface HttpApiOptions {
  apiUrl: string;
  token: string;
  workspaceId: string;
  fetchImpl?: typeof globalThis.fetch;
  /** Injected in tests. */
  eventSourceFactory?(url: string, init: { fetch: typeof globalThis.fetch }): EventSourceLike;
}

export interface EventSourceLike {
  addEventListener(type: string, listener: (ev: { data?: string }) => void): void;
  close(): void;
}

const trimSlash = (s: string): string => s.replace(/\/+$/, '');

export function createHttpPresenterApi(opts: HttpApiOptions): PresenterApi {
  const base = `${trimSlash(opts.apiUrl)}/api/w/${encodeURIComponent(opts.workspaceId)}`;
  const doFetch: typeof globalThis.fetch = (input, init) => (opts.fetchImpl ?? globalThis.fetch)(input, init);
  const authFetch: typeof globalThis.fetch = (input, init) =>
    doFetch(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), authorization: `Bearer ${opts.token}` } });

  return {
    async getDesired(): Promise<DesiredPresentation> {
      const res = await authFetch(`${base}/presenter/desired`, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`presenter: GET ${base}/presenter/desired failed with ${res.status}`);
      const body = (await res.json()) as { conductor?: unknown; workers?: unknown[]; config?: Record<string, unknown> };
      return {
        conductor: toAgentView(body.conductor, opts.workspaceId),
        workers: (Array.isArray(body.workers) ? body.workers : [])
          .map((w) => toAgentView(w, opts.workspaceId))
          .filter((w): w is NonNullable<typeof w> => !!w),
        config: (body.config ?? {}) as DesiredPresentation['config'],
      };
    },

    async putHandles(presenterId: string, handles: StoredHandle[]): Promise<void> {
      const res = await authFetch(`${base}/presenter/${encodeURIComponent(presenterId)}/handles`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handles }),
      });
      if (!res.ok) throw new Error(`presenter: PUT handles failed with ${res.status}`);
    },

    subscribe(handlers): EventSubscription {
      const url = `${base}/events`;
      const source: EventSourceLike = opts.eventSourceFactory
        ? opts.eventSourceFactory(url, { fetch: authFetch })
        : new EventSource(url, { fetch: authFetch });
      const relay = (raw: { data?: string }): void => {
        if (!raw?.data) return;
        try { handlers.onEvent(JSON.parse(raw.data) as WorkspaceEvent); }
        catch (err) { handlers.onError?.(err); }
      };
      for (const type of ['worker.spawned', 'worker.status', 'worker.retired', 'worker.stalled', 'presentation.updated']) {
        source.addEventListener(type, relay);
      }
      (source as { onerror?: (err: unknown) => void }).onerror = (err: unknown): void => handlers.onError?.(err);
      return { close: () => source.close() };
    },
  };
}
