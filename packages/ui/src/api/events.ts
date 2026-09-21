import type { QueryClient } from '@tanstack/react-query';
import type { Decision, EphemeralEventType, EventType, WorkspaceEvent } from '@weave-ai/shared';
import { qk } from './keys';
import { BACKOFF, documentIsHidden, SseWatchdog, type ConnectionState, type ConnectionStatus } from './sseStream';

export type { ConnectionState, ConnectionStatus };

type Listener = (s: ConnectionStatus) => void;
type EventListener = (e: WorkspaceEvent) => void;

/**
 * VS-641: what a reconnect must re-read. Durable events replay from `?after=<seq>`, but ephemeral
 * frames (`worker.activity`, `run.event`, `run.delta`, `session.compaction`) are never persisted and
 * a resume position the server no longer holds replays nothing — so live counts and worker rows
 * converge from these authoritative reads instead. Fired only on an actual reconnect; a query that
 * was never fetched is a no-op.
 */
export function resync(qc: QueryClient, workspace: string): void {
  const inv = (key: readonly unknown[]) => void qc.invalidateQueries({ queryKey: key });
  inv(qk.workers(workspace));
  inv(qk.tickets(workspace));
  inv(qk.briefing(workspace));
  inv(qk.runs(workspace));
  inv(qk.decisions(workspace));
  inv(qk.workspaces());
}

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
  private status: ConnectionStatus = { state: 'connecting', capturedAt: null, lastFrameAt: null, lastSeq: 0, attempts: 0 };
  private stopped = false;
  /** Background tab (VS-227): EventSource is closed so HTTP/1.1 slots stay free for REST. */
  private hidden = false;
  private listening = false;
  /** Whether an earlier connection has already opened this session — the first onopen is a fresh
   * mount; every one after it is a reconnect. */
  private everConnected = false;
  /** VS-641: silence watchdog. `onDead` reconnects; `onWake` is a slept machine. */
  private readonly watchdog = new SseWatchdog({
    onStale: () => this.set({ state: 'stale', lastFrameAt: this.watchdog.lastFrameAt }),
    onAlive: () => this.set({ state: 'connected', lastFrameAt: Date.now() }),
    onDead: () => {
      this.es?.close();
      this.es = null;
      if (this.stopped || this.hidden) return;
      this.set({ state: 'reconnecting', lastFrameAt: this.watchdog.lastFrameAt });
      this.open();
    },
    onWake: () => {
      if (this.stopped || this.hidden) return;
      this.set({ state: 'reconnecting' });
      this.open();
    },
  });

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
    if (typeof window !== 'undefined' && !this.listening) {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
      document.addEventListener('visibilitychange', this.onVisibility);
      this.listening = true;
    }
    if (documentIsHidden()) {
      this.hidden = true;
      this.set({ state: 'hidden' });
      return;
    }
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.hidden = false;
    this.watchdog.stop();
    this.es?.close();
    this.es = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.listening = false;
    }
  }

  /** Reconnects at once, resetting the backoff, whatever the current delay or state. */
  retryNow(): void {
    if (this.stopped || this.hidden) return;
    this.status = { ...this.status, attempts: 0 };
    this.set({ state: 'connecting' });
    this.open();
  }

  private onOnline = (): void => {
    if (this.stopped || this.hidden) return;
    // Trust nothing about the old socket (VS-641): open fresh and let onopen re-sync.
    this.set({ state: 'reconnecting' });
    this.open();
  };

  private onOffline = (): void => {
    this.watchdog.stop();
    this.set({ state: 'offline' });
  };

  private onVisibility = (): void => {
    if (documentIsHidden()) {
      this.pauseForHidden();
      return;
    }
    if (!this.hidden || this.stopped) return;
    this.hidden = false;
    this.open();
  };

  private pauseForHidden(): void {
    this.hidden = true;
    this.watchdog.stop();
    this.es?.close();
    this.es = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.set({ state: 'hidden' });
  }

  private set(patch: Partial<ConnectionStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  private open(): void {
    if (this.stopped || this.hidden) return;
    this.es?.close();
    const after = this.status.lastSeq ? `?after=${this.status.lastSeq}` : '';
    const es = new EventSource(`/api/w/${encodeURIComponent(this.workspace)}/events${after}`, { withCredentials: true });
    this.es = es;
    if (this.status.state === 'hidden') this.set({ state: 'connecting' });

    es.onopen = () => {
      this.set({ state: 'connected', attempts: 0, capturedAt: new Date().toISOString(), lastFrameAt: Date.now() });
      this.watchdog.start();
      // VS-641: whatever the previous connection missed — a clean drop, a silent stall, a slept
      // machine — the reads this stream keeps fresh are refetched rather than trusting replay
      // alone (a missed ephemeral frame, a cursor the server no longer holds). Supersedes VS-140's
      // decisions-only reconcile; `resync` covers decisions among the rest.
      if (this.everConnected) resync(this.qc, this.workspace);
      this.everConnected = true;
    };
    es.onerror = () => {
      this.watchdog.stop();
      es.close();
      if (this.stopped || this.hidden) return;
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
    // The keepalive (VS-641) is a named event, unlike an SSE comment, so a silent stream is visible.
    es.addEventListener('heartbeat', () => this.watchdog.touch());
  }

  private handle(m: MessageEvent<string>): void {
    this.watchdog.touch();
    let evt: WorkspaceEvent;
    try {
      evt = JSON.parse(m.data) as WorkspaceEvent;
    } catch {
      return;
    }
    // A live-only frame (seq 0: `worker.activity`, `run.event`) no longer moves the cursor, so it
    // must not re-notify status listeners on every frame — a busy turn would otherwise re-render
    // every connection-status subscriber many times a second (VS-417).
    const patch: Partial<ConnectionStatus> = {};
    if (evt.seq > 0) {
      patch.lastSeq = Math.max(this.status.lastSeq ?? 0, evt.seq);
      patch.capturedAt = evt.createdAt ?? new Date().toISOString();
    }
    if (this.status.state !== 'connected') patch.state = 'connected';
    if (Object.keys(patch).length > 0) this.set(patch);
    invalidateFor(this.qc, this.workspace, evt);
    for (const l of this.eventListeners) l(evt);
  }
}

/** One daemon-wide SSE stream for global pages. Its Last-Event-ID is an opaque cursor map produced
 * by the server; unlike EventStream, no single workspace sequence can represent its position. */
export class GlobalEventStream {
  private es: EventSource | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private eventListeners = new Set<EventListener>();
  private status: ConnectionStatus = { state: 'connecting', capturedAt: null, lastFrameAt: null, attempts: 0 };
  private stopped = false;
  private hidden = false;
  private listening = false;
  private cursor = '';
  /** Whether an earlier connection has already opened — every later onopen is a reconnect. */
  private everConnected = false;
  /** Workspaces this connection has seen an event for, so a reconnect can re-sync each of them. */
  private readonly seen = new Set<string>();
  /** VS-641: silence watchdog. `onDead` reconnects; `onWake` is a slept machine. */
  private readonly watchdog = new SseWatchdog({
    onStale: () => this.set({ state: 'stale', lastFrameAt: this.watchdog.lastFrameAt }),
    onAlive: () => this.set({ state: 'connected', lastFrameAt: Date.now() }),
    onDead: () => {
      this.es?.close();
      this.es = null;
      if (this.stopped || this.hidden) return;
      this.set({ state: 'reconnecting', lastFrameAt: this.watchdog.lastFrameAt });
      this.open();
    },
    onWake: () => {
      if (this.stopped || this.hidden) return;
      this.set({ state: 'reconnecting' });
      this.open();
    },
  });

  constructor(private readonly qc: QueryClient) {}

  getStatus(): ConnectionStatus { return this.status; }
  subscribe(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onEvent(fn: EventListener): () => void { this.eventListeners.add(fn); return () => this.eventListeners.delete(fn); }

  start(): void {
    this.stopped = false;
    if (typeof window !== 'undefined' && !this.listening) {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
      document.addEventListener('visibilitychange', this.onVisibility);
      this.listening = true;
    }
    if (documentIsHidden()) {
      this.hidden = true;
      this.set({ state: 'hidden' });
      return;
    }
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.hidden = false;
    this.watchdog.stop();
    this.es?.close();
    this.es = null;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.listening = false;
    }
  }

  retryNow(): void {
    if (this.stopped || this.hidden) return;
    this.status = { ...this.status, attempts: 0 };
    this.set({ state: 'connecting' });
    this.open();
  }

  private onOnline = (): void => {
    if (this.stopped || this.hidden) return;
    // Trust nothing about the old socket (VS-641): open fresh and let onopen re-sync.
    this.set({ state: 'reconnecting' });
    this.open();
  };
  private onOffline = (): void => { this.watchdog.stop(); this.set({ state: 'offline' }); };
  private onVisibility = (): void => {
    if (documentIsHidden()) { this.pauseForHidden(); return; }
    if (!this.hidden || this.stopped) return;
    this.hidden = false;
    this.open();
  };
  private pauseForHidden(): void {
    this.hidden = true;
    this.watchdog.stop();
    this.es?.close();
    this.es = null;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.set({ state: 'hidden' });
  }
  private set(patch: Partial<ConnectionStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }
  private open(): void {
    if (this.stopped || this.hidden) return;
    this.es?.close();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const after = this.cursor ? `?after=${encodeURIComponent(this.cursor)}` : '';
    const source = new EventSource(`/api/events${after}`, { withCredentials: true });
    this.es = source;
    if (this.status.state === 'hidden') this.set({ state: 'connecting' });
    source.onopen = () => {
      this.set({ state: 'connected', attempts: 0, capturedAt: new Date().toISOString(), lastFrameAt: Date.now() });
      this.watchdog.start();
      // VS-641: re-read what the missed window could not replay, per workspace this stream saw.
      if (this.everConnected) { for (const ws of this.seen) resync(this.qc, ws); }
      this.everConnected = true;
    };
    source.onmessage = (m) => this.handle(m as MessageEvent<string>);
    for (const type of TRACKED) source.addEventListener(type, (m) => this.handle(m as MessageEvent<string>));
    source.addEventListener('heartbeat', () => this.watchdog.touch());
    source.onerror = () => {
      this.watchdog.stop();
      source.close();
      if (this.stopped || this.hidden) return;
      const attempts = this.status.attempts + 1;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      this.set({ state: offline ? 'offline' : attempts > BACKOFF.length ? 'offline' : 'reconnecting', attempts });
      const delay = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)] ?? 15000;
      this.timer = setTimeout(() => this.open(), delay);
    };
  }
  private handle(m: MessageEvent<string>): void {
    this.watchdog.touch();
    let evt: WorkspaceEvent;
    try { evt = JSON.parse(m.data) as WorkspaceEvent; } catch { return; }
    this.seen.add(evt.workspaceId);
    if (evt.seq > 0 && m.lastEventId) this.cursor = m.lastEventId;
    const patch: Partial<ConnectionStatus> = { capturedAt: evt.createdAt ?? new Date().toISOString() };
    if (this.status.state !== 'connected') patch.state = 'connected';
    this.set(patch);
    invalidateFor(this.qc, evt.workspaceId, evt);
    for (const listener of this.eventListeners) listener(evt);
  }
}

/** Event types we attach named listeners for. Ephemeral frames have no outbox row but still arrive
 *  as named SSE events, so they must be listed here to reach component listeners at all. */
const TRACKED: (EventType | EphemeralEventType)[] = [
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
  // VS-368: the daemon broadcasts the per-worker activity summary as an ephemeral `worker.activity`
  // frame (VS-328), but this list omitted it, so the listener V1's board already registers never
  // fired and no V2 card could update live. It is forwarded to component listeners and invalidates
  // no query (the frame is applied by the listener).
  'worker.activity',
  // An out-of-band compaction starting/finishing on the weaver's session; drives the chat banner and
  // the composer's queued note without a query refetch.
  'session.compaction',
  'ticket.created',
  'ticket.updated',
  'ticket.assigned',
  'ticket.status',
  'ticket.comment',
  'ticket.document',
  'ticket.work_product',
  'ticket.attachment',
  'ticket.merged',
  'decision.created',
  'decision.answered',
  'decision.expired',
  'decision.superseded',
  'decision.updated',
  'wake.queued',
  'wake.skipped',
  'run.started',
  'run.event',
  'run.delta',
  'run.finished',
  'roadmap.created',
  'roadmap.updated',
  'roadmap.removed',
  'roadmap.block.created',
  'roadmap.block.updated',
  'roadmap.block.removed',
  'thread.message',
  'knowledge.updated',
  'knowledge.curated',
  'spec.indexed',
  'usage.recorded',
  'auth.login',
  'auth.logout',
  'auth.revoked',
  'presentation.updated',
  'weaver_artifact.published',
  // VS-334: a plugin's own event, forwarded to a plugin page only by the postMessage bridge
  // (lib/pluginBridge.ts) — never invalidates a query itself, since no core cache key is keyed on it.
  'plugin.event',
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
      // VS-550: a ticket created from a plan draft (dispatch or submission) picks up its origin here.
      if (evt.type === 'ticket.created') inv(qk.planOrigins(ws));
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
      // An artifact publish/republish is what makes it appear (or move to the top of) the document
      // explorer's Artifacts entry, live, with no reload (VS-270).
      inv(qk.artifactsRoot(ws));
      break;
    case 'ticket.attachment':
      inv(qk.ticket(ws, id));
      break;
    case 'decision.answered':
    case 'decision.expired':
    case 'decision.superseded':
    case 'decision.updated':
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
      // The global run detail is keyed above any workspace (VS-386), so it needs its own invalidation
      // when a turn starts or finishes.
      inv(qk.runGlobal(id));
      inv(qk.workers(ws));
      // The conductor detail carries its last run, and that run's usage is what the chat header's
      // context meter is computed from — without this it would only move on a remount.
      inv(qk.weaver(ws));
      // The ticket's own list of turns is keyed under the ticket, not under runs, so it would
      // otherwise learn about a turn starting or ending only on a remount — and a live transcript
      // that never hears the turn ended goes on waiting for a stream that has closed.
      const ticketId = (evt.payload as { ticketId?: string | null } | null)?.ticketId;
      if (ticketId) inv(qk.ticketRuns(ws, ticketId));
      break;
    }
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
      inv(qk.routineFires(ws, id));
      break;
    case 'roadmap.created':
    case 'roadmap.updated':
    case 'roadmap.removed':
    case 'roadmap.block.created':
    case 'roadmap.block.updated':
    case 'roadmap.block.removed': {
      // The payload carries the project so a section can be refreshed without knowing the item's
      // project from the event's entity id (which is the item id). `roadmapBlocks` is nested under
      // `roadmap`, so invalidating the latter reaches it too.
      const projectId = (evt.payload as { projectId?: string } | null)?.projectId;
      inv(qk.roadmapRoot(ws));
      if (projectId) inv(qk.roadmap(ws, projectId));
      break;
    }
    case 'presentation.updated':
      inv(qk.presentation(ws));
      break;
    case 'auth.login':
    case 'auth.logout':
    case 'auth.revoked':
      inv(qk.sessions());
      break;
    case 'weaver_artifact.published':
      // Makes a newly published (or republished) weaver artifact appear, or move to the top, of the
      // explorer's workspace-level entry with no reload — the ticket-artifact equivalent of the
      // `ticket.work_product` case above, but for a store that carries no ticket id at all.
      inv(qk.weaverArtifactsRoot(ws));
      break;
    default:
      break;
  }
}
