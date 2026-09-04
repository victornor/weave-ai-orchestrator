import type { QueryClient } from '@tanstack/react-query';
import type { EventType, WorkspaceEvent } from '@openconductor/shared';
import { qk } from './keys';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'unreachable';

export interface ConnectionStatus {
  state: ConnectionState;
  /** ISO time of the last event or successful open — the "showing the state from 09:38" stamp. */
  capturedAt: string | null;
  lastSeq: number;
  attempts: number;
}

type Listener = (s: ConnectionStatus) => void;
type EventListener = (e: WorkspaceEvent) => void;

const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000];

/**
 * SSE subscription to `GET /api/w/:ws/events?after=<seq>` with backoff and
 * replay. Every event both invalidates the queries it can affect and is
 * re-broadcast to component-level listeners (live transcripts, toasts).
 */
export class EventStream {
  private es: EventSource | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private eventListeners = new Set<EventListener>();
  private status: ConnectionStatus = { state: 'connecting', capturedAt: null, lastSeq: 0, attempts: 0 };
  private stopped = false;

  constructor(
    private readonly workspace: string,
    private readonly qc: QueryClient,
  ) {}

  getStatus(): ConnectionStatus {
    return this.status;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onEvent(fn: EventListener): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  start(): void {
    this.stopped = false;
    this.open();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }
  }

  stop(): void {
    this.stopped = true;
    this.es?.close();
    this.es = null;
    if (this.timer) clearTimeout(this.timer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
  }

  private onOnline = (): void => {
    if (this.status.state === 'offline') this.open();
  };

  private onOffline = (): void => {
    this.set({ state: 'offline' });
  };

  private set(patch: Partial<ConnectionStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  private open(): void {
    if (this.stopped) return;
    this.es?.close();
    const after = this.status.lastSeq ? `?after=${this.status.lastSeq}` : '';
    const es = new EventSource(`/api/w/${encodeURIComponent(this.workspace)}/events${after}`, { withCredentials: true });
    this.es = es;

    es.onopen = () => {
      this.set({ state: 'connected', attempts: 0, capturedAt: new Date().toISOString() });
    };
    es.onerror = () => {
      es.close();
      if (this.stopped) return;
      const attempts = this.status.attempts + 1;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      this.set({ state: offline ? 'offline' : attempts > BACKOFF.length ? 'offline' : 'reconnecting', attempts });
      const delay = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)] ?? 15000;
      this.timer = setTimeout(() => this.open(), delay);
    };
    es.onmessage = (m) => this.handle(m);
    // The daemon sends `event: <type>`; a named-event listener is required
    // because onmessage only receives unnamed frames.
    for (const type of TRACKED) es.addEventListener(type, (m) => this.handle(m as MessageEvent));
  }

  private handle(m: MessageEvent<string>): void {
    let evt: WorkspaceEvent;
    try {
      evt = JSON.parse(m.data) as WorkspaceEvent;
    } catch {
      return;
    }
    this.set({ lastSeq: Math.max(this.status.lastSeq, evt.seq ?? 0), capturedAt: evt.createdAt ?? new Date().toISOString(), state: 'connected' });
    invalidateFor(this.qc, this.workspace, evt);
    for (const l of this.eventListeners) l(evt);
  }
}

/** Event types we attach named listeners for. */
const TRACKED: EventType[] = [
  'workspace.updated',
  'project.added',
  'project.updated',
  'project.removed',
  'role.hired',
  'role.activated',
  'role.updated',
  'role.paused',
  'role.resumed',
  'role.retired',
  'worker.spawned',
  'worker.status',
  'worker.retired',
  'worker.stalled',
  'worker.relaunched',
  'ticket.created',
  'ticket.updated',
  'ticket.assigned',
  'ticket.status',
  'ticket.comment',
  'ticket.document',
  'ticket.work_product',
  'ticket.merged',
  'decision.created',
  'decision.answered',
  'decision.expired',
  'decision.superseded',
  'wake.queued',
  'wake.skipped',
  'run.started',
  'run.event',
  'run.finished',
  'thread.message',
  'knowledge.updated',
  'knowledge.curated',
  'spec.indexed',
  'usage.recorded',
  'auth.login',
  'auth.logout',
  'auth.revoked',
  'presentation.updated',
];

/** Map one event onto the query keys it makes stale. */
export function invalidateFor(qc: QueryClient, ws: string, evt: WorkspaceEvent): void {
  const inv = (key: readonly unknown[]) => void qc.invalidateQueries({ queryKey: key });
  const id = evt.entityId;

  switch (evt.type) {
    case 'workspace.updated':
      inv(qk.workspace(ws));
      break;
    case 'project.added':
    case 'project.updated':
    case 'project.removed':
      inv(qk.projects(ws));
      break;
    case 'role.hired':
    case 'role.activated':
    case 'role.updated':
    case 'role.paused':
    case 'role.resumed':
    case 'role.retired':
      inv(qk.roles(ws));
      inv(qk.role(ws, id));
      break;
    case 'worker.spawned':
    case 'worker.status':
    case 'worker.retired':
    case 'worker.stalled':
    case 'worker.relaunched':
      inv(qk.workers(ws));
      inv(qk.worker(ws, id));
      inv(qk.briefing(ws));
      break;
    case 'ticket.created':
    case 'ticket.updated':
    case 'ticket.assigned':
    case 'ticket.status':
    case 'ticket.merged':
      inv(qk.tickets(ws));
      inv(qk.ticket(ws, id));
      inv(qk.briefing(ws));
      break;
    case 'ticket.comment':
      inv(qk.ticketComments(ws, id));
      inv(qk.ticket(ws, id));
      break;
    case 'ticket.document':
      inv(qk.ticket(ws, id));
      inv(qk.ticketDocuments(ws, id));
      break;
    case 'ticket.work_product':
      inv(qk.ticketWorkProducts(ws, id));
      break;
    case 'decision.created':
    case 'decision.answered':
    case 'decision.expired':
    case 'decision.superseded':
      inv(qk.decisions(ws));
      inv(qk.decision(ws, id));
      inv(qk.briefing(ws));
      break;
    case 'run.started':
    case 'run.finished':
      inv(qk.runs(ws));
      inv(qk.run(ws, id));
      inv(qk.workers(ws));
      break;
    case 'run.event':
      inv(qk.runEvents(ws, id));
      break;
    case 'thread.message':
      inv(qk.threads(ws));
      inv(qk.threadMessages(ws, (evt.payload as { threadId?: string } | null)?.threadId ?? id));
      break;
    case 'knowledge.updated':
    case 'knowledge.curated':
      inv(qk.knowledge(ws));
      break;
    case 'spec.indexed':
      inv(qk.specsRoot(ws));
      break;
    case 'usage.recorded':
      inv(qk.usageRoot(ws));
      break;
    case 'presentation.updated':
      inv(qk.presentation(ws));
      break;
    case 'auth.login':
    case 'auth.logout':
    case 'auth.revoked':
      inv(qk.sessions());
      break;
    default:
      break;
  }
}
