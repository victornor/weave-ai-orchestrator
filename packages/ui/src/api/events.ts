import type { QueryClient } from '@tanstack/react-query';
import type { Decision, EventType, WorkspaceEvent } from '@agent-conductor/shared';
import { qk } from './keys';
import { BACKOFF, type ConnectionState, type ConnectionStatus } from './sseStream';

export type { ConnectionState, ConnectionStatus };

type Listener = (s: ConnectionStatus) => void;
type EventListener = (e: WorkspaceEvent) => void;

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
  /** Whether an earlier connection has already opened this session — the first `onopen` is a fresh
   *  mount, already covered by every query's own initial fetch; every one after it is a reconnect. */
  private everConnected = false;

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
      // Whatever caused the previous connection to end — a clean drop or one that stalled silently
      // and was never seen as an error — the decisions list may have moved on without us. Reconcile
      // it against the server rather than trusting whatever event replay already caught (VS-140).
      if (this.everConnected) void this.qc.invalidateQueries({ queryKey: qk.decisions(this.workspace) });
      this.everConnected = true;
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
    this.set({ lastSeq: Math.max(this.status.lastSeq ?? 0, evt.seq ?? 0), capturedAt: evt.createdAt ?? new Date().toISOString(), state: 'connected' });
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

/**
 * Applies a decision's current state to every cached decisions-list query directly from the event
 * payload — `decision.superseded`/`answered`/`expired` already carry the full row — so the view stops
 * showing a stale card the instant the event arrives, without waiting on the round trip the
 * `invalidateQueries` call below still kicks off as a backstop (VS-140).
 *
 * A list query's own requested `status` filter, read off its query key's params, decides whether the
 * updated decision still belongs in that particular cached array (Chat's `['open','answered']` query
 * keeps an answered card as the record of the conversation) or has to be removed from it (Needs You's
 * `status: 'open'` query, once the decision is no longer open).
 */
function patchDecisionCaches(qc: QueryClient, ws: string, next: Decision | null | undefined): void {
  if (!next?.id) return;
  for (const query of qc.getQueryCache().findAll({ queryKey: qk.decisions(ws) })) {
    const key = query.queryKey as readonly unknown[];
    const params = key[key.length - 1];
    // `qk.decision(ws, id)` ends in a string id, not a params object — skip it here; it is patched below.
    if (!params || typeof params !== 'object' || Array.isArray(params)) continue;
    const old = query.state.data as Decision[] | undefined;
    if (!old?.some((d) => d.id === next.id)) continue;
    const status = (params as { status?: string | string[] }).status;
    const statuses = status === undefined ? null : Array.isArray(status) ? status : [status];
    const stillMatches = statuses === null || statuses.includes(next.status);
    qc.setQueryData<Decision[]>(query.queryKey, stillMatches ? old.map((d) => (d.id === next.id ? next : d)) : old.filter((d) => d.id !== next.id));
  }
  qc.setQueryData<Decision>(qk.decision(ws, next.id), (old) => (old ? next : old));
}

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
      // The default branch or the repository itself can change (VS-96).
      inv(qk.historyRoot(ws));
      // A fetch or a sync check just ran against this project (VS-131) — its cached sync state is stale.
      inv(qk.projectSync(ws, id));
      break;
    case 'role.hired':
    case 'role.activated':
    case 'role.updated':
    case 'role.paused':
    case 'role.resumed':
    case 'role.retired':
      inv(qk.roles(ws));
      inv(qk.role(ws, id));
      // Hiring is a changelog kind of its own; the other five record nothing it reads.
      if (evt.type === 'role.hired') inv(qk.changelogRoot(ws));
      break;
    case 'worker.spawned':
    case 'worker.status':
    case 'worker.retired':
    case 'worker.stalled':
    case 'worker.relaunched':
      inv(qk.workers(ws));
      inv(qk.worker(ws, id));
      inv(qk.briefing(ws));
      // A worker's worktree branch is what the History section's ref coverage reads (VS-96); only
      // spawning and retiring change which branches exist, not a mid-life status change.
      if (evt.type === 'worker.spawned' || evt.type === 'worker.retired') inv(qk.historyRoot(ws));
      break;
    case 'ticket.created':
    case 'ticket.updated':
    case 'ticket.assigned':
    case 'ticket.status':
    case 'ticket.merged':
      inv(qk.tickets(ws));
      inv(qk.ticket(ws, id));
      inv(qk.briefing(ws));
      // The changelog is derived from activity rows these events write, and until VS-95 nothing
      // here made it stale — the Changelog view and the project overview both showed whatever they
      // fetched on mount. `ticket.updated` and `ticket.assigned` record nothing the changelog reads.
      if (evt.type !== 'ticket.updated' && evt.type !== 'ticket.assigned') inv(qk.changelogRoot(ws));
      // Entering or leaving the queue is a status change, so this is the event that moves it.
      if (evt.type === 'ticket.status' || evt.type === 'ticket.merged') inv(qk.mergeQueueRoot(ws));
      // A merge or a status change is what the daemon drops its forge cache on, so this is when the
      // overview's Pull requests section has something new to read (VS-97).
      if (evt.type === 'ticket.status' || evt.type === 'ticket.merged') inv(qk.pullRequestsRoot(ws));
      // A ticket landing or changing status can change which branches the History section covers
      // (a finished ticket's branch drops out of ref coverage) — VS-96.
      if (evt.type === 'ticket.status' || evt.type === 'ticket.merged') inv(qk.historyRoot(ws));
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
      // A recorded pull request is a changelog entry of its own (`pr_opened`).
      inv(qk.changelogRoot(ws));
      // It is also the pull request the overview's section is waiting for (VS-97).
      inv(qk.pullRequestsRoot(ws));
      // A recorded `branch` work product can add a ref the History section covers (VS-96).
      inv(qk.historyRoot(ws));
      break;
    case 'decision.answered':
    case 'decision.expired':
    case 'decision.superseded':
      patchDecisionCaches(qc, ws, evt.payload as Decision);
      inv(qk.decisions(ws));
      inv(qk.decision(ws, id));
      inv(qk.briefing(ws));
      inv(qk.workspaces());
      break;
    case 'decision.created':
      inv(qk.decisions(ws));
      inv(qk.decision(ws, id));
      inv(qk.briefing(ws));
      // The sidebar badges every workspace from the workspace list, which carries this workspace's
      // Needs-you count too; without this it would wait out the refetch interval for its own events.
      inv(qk.workspaces());
      break;
    case 'run.started':
    case 'run.finished': {
      inv(qk.runs(ws));
      inv(qk.run(ws, id));
      inv(qk.workers(ws));
      // The conductor detail carries its last run, and that run's usage is what the chat header's
      // context meter is computed from — without this it would only move on a remount.
      inv(qk.conductor(ws));
      // The ticket's own list of turns is keyed under the ticket, not under runs, so it would
      // otherwise learn about a turn starting or ending only on a remount — and a live transcript
      // that never hears the turn ended goes on waiting for a stream that has closed.
      const ticketId = (evt.payload as { ticketId?: string | null } | null)?.ticketId;
      if (ticketId) inv(qk.ticketRuns(ws, ticketId));
      break;
    }
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
    case 'knowledge_usage.recorded': {
      inv(qk.knowledgeUsageRoot(ws));
      // Not nested under that root (same trap `qk.ticketUsage` never got fixed for): invalidate the
      // ticket's own key explicitly so its knowledge tab does not wait out a remount.
      const ticketId = (evt.payload as { ticketId?: string | null } | null)?.ticketId;
      if (ticketId) inv(qk.ticketKnowledgeUsage(ws, ticketId));
      break;
    }
    case 'routine.created':
    case 'routine.updated':
    case 'routine.removed':
    case 'routine.fired':
      inv(qk.routines(ws));
      inv(qk.routine(ws, id));
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
