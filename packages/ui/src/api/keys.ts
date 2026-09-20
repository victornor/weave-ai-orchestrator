/** Query keys, one place so SSE invalidation and hooks cannot drift. */
export const qk = {
  health: () => ['health'] as const,
  me: () => ['me'] as const,
  sessions: () => ['sessions'] as const,
  workspaces: () => ['workspaces'] as const,
  runtimes: () => ['runtimes'] as const,
  daemonUpdate: () => ['daemon', 'update'] as const,
  daemonUpgrade: () => ['daemon', 'upgrade'] as const,
  daemonTranscription: () => ['daemon', 'transcription'] as const,
  daemonModels: () => ['daemon', 'models'] as const,
  daemonHostTools: () => ['daemon', 'host-tools'] as const,
  incidents: (reporter?: string) => ['incidents', reporter ?? 'all'] as const,
  runtimeModels: (id: string) => ['runtimes', id, 'models'] as const,

  workspace: (ws: string) => ['w', ws] as const,
  briefing: (ws: string) => ['w', ws, 'briefing'] as const,
  projects: (ws: string) => ['w', ws, 'projects'] as const,
  project: (ws: string, id: string) => ['w', ws, 'projects', id] as const,
  /** How a project's clone compares to its remote (VS-131) — its own key so a `project.updated` invalidation of `qk.projects` doesn't force a re-check on every render. */
  projectSync: (ws: string, id: string) => ['w', ws, 'projects', id, 'sync'] as const,
  projectPromotion: (ws: string, id: string) => ['w', ws, 'projects', id, 'promotion'] as const,
  /**
   * Deliberately not under `projects`: what a project's queue holds is decided by ticket events, and
   * nested there only `project.*` reached it — so the queue sat on whatever it fetched on mount.
   */
  mergeQueueRoot: (ws: string) => ['w', ws, 'merge-queue'] as const,
  mergeQueue: (ws: string, projectId: string) => ['w', ws, 'merge-queue', projectId] as const,
  roles: (ws: string) => ['w', ws, 'roles'] as const,
  role: (ws: string, id: string) => ['w', ws, 'roles', id] as const,
  workers: (ws: string) => ['w', ws, 'workers'] as const,
  worker: (ws: string, id: string) => ['w', ws, 'workers', id] as const,
  workerBrief: (ws: string, id: string) => ['w', ws, 'workers', id, 'brief'] as const,
  /** VS-249: the resume command a worker would offer, kept separate from `worker()` so polling it does not thrash the worker detail query. */
  workerHandoverCommand: (ws: string, id: string) => ['w', ws, 'workers', id, 'handover-command'] as const,
  weaver: (ws: string) => ['w', ws, 'weaver'] as const,
  models: (ws: string) => ['w', ws, 'models'] as const,
  providers: (ws: string) => ['w', ws, 'providers'] as const,

  tickets: (ws: string) => ['w', ws, 'tickets'] as const,
  ticket: (ws: string, id: string) => ['w', ws, 'tickets', id] as const,
  ticketComments: (ws: string, id: string) => ['w', ws, 'tickets', id, 'comments'] as const,
  ticketDocuments: (ws: string, id: string) => ['w', ws, 'tickets', id, 'documents'] as const,
  ticketDocument: (ws: string, id: string, key: string) => ['w', ws, 'tickets', id, 'documents', key] as const,
  ticketDocumentById: (ws: string, id: string, documentId: string) => ['w', ws, 'tickets', id, 'documents', 'by-id', documentId] as const,
  ticketDocumentRevisions: (ws: string, id: string, key: string) => ['w', ws, 'tickets', id, 'documents', key, 'revisions'] as const,
  ticketWorkProducts: (ws: string, id: string) => ['w', ws, 'tickets', id, 'work-products'] as const,
  ticketRuns: (ws: string, id: string) => ['w', ws, 'tickets', id, 'runs'] as const,
  ticketUsage: (ws: string, id: string) => ['w', ws, 'tickets', id, 'usage'] as const,
  /**
   * Not nested under `usageRoot` or `knowledgeUsageRoot` (VS-110): `qk.ticketUsage` above shows the
   * same trap held for it too, since `usage.recorded`'s prefix invalidation never reached a
   * `tickets/:id/...` key — `knowledge_usage.recorded` invalidates this key explicitly instead.
   */
  ticketKnowledgeUsage: (ws: string, id: string) => ['w', ws, 'tickets', id, 'knowledge-usage'] as const,

  decisions: (ws: string) => ['w', ws, 'decisions'] as const,
  decision: (ws: string, id: string) => ['w', ws, 'decisions', id] as const,

  runs: (ws: string) => ['w', ws, 'runs'] as const,
  run: (ws: string, id: string) => ['w', ws, 'runs', id] as const,
  /** The global run detail (VS-386): resolved across workspaces, so it is keyed above any one. */
  runGlobal: (id: string) => ['runs-global', id] as const,
  runEvents: (ws: string, id: string) => ['w', ws, 'runs', id, 'events'] as const,
  /** Run trace summaries for a set of runs; under `runs`, so `run.started`/`run.finished` already refresh them. */
  runTraces: (ws: string, params: Record<string, unknown>) => ['w', ws, 'runs', 'traces', params] as const,

  knowledge: (ws: string) => ['w', ws, 'knowledge'] as const,
  knowledgeScope: (ws: string, scope: string, project?: string) => ['w', ws, 'knowledge', scope, project ?? ''] as const,
  knowledgeRevisions: (ws: string, scope: string, project?: string) => ['w', ws, 'knowledge', scope, project ?? '', 'revisions'] as const,
  search: (ws: string, q: string, project?: string) => ['w', ws, 'search', q, project ?? ''] as const,

  /**
   * Deliberately not under `knowledge` (VS-270) — same trap `pullRequestsRoot`/`historyRoot` avoid
   * (VS-95/VS-97): an artifact publish is a ticket event (`ticket.work_product`), never a knowledge-
   * write event, so nesting this under `qk.knowledge` would leave it invalidated by nothing.
   */
  artifactsRoot: (ws: string) => ['w', ws, 'artifacts'] as const,
  artifacts: (ws: string, project?: string) => ['w', ws, 'artifacts', project ?? ''] as const,

  /** A weaver's workspace-scoped artifacts (VS-297) — a separate store and list from the ticket-scoped one above. */
  weaverArtifactsRoot: (ws: string) => ['w', ws, 'weaver-artifacts'] as const,
  weaverArtifacts: (ws: string) => ['w', ws, 'weaver-artifacts', 'list'] as const,

  changelogRoot: (ws: string) => ['w', ws, 'changelog'] as const,
  changelog: (ws: string, project?: string) => ['w', ws, 'changelog', 'entries', project ?? ''] as const,
  changelogHeatmap: (ws: string, project: string | undefined, tz: string) => ['w', ws, 'changelog', 'heatmap', project ?? '', tz] as const,

  specsRoot: (ws: string) => ['w', ws, 'specs'] as const,
  specs: (ws: string, project: string) => ['w', ws, 'specs', project] as const,
  capability: (ws: string, project: string, cap: string) => ['w', ws, 'specs', project, 'capabilities', cap] as const,
  changes: (ws: string, project: string, state?: string) => ['w', ws, 'specs', project, 'changes', state ?? ''] as const,
  change: (ws: string, project: string, name: string) => ['w', ws, 'specs', project, 'changes', 'one', name] as const,
  specGraph: (ws: string, project: string) => ['w', ws, 'specs', project, 'graph'] as const,

  usageRoot: (ws: string) => ['w', ws, 'usage'] as const,
  usage: (ws: string, params: Record<string, unknown>) => ['w', ws, 'usage', 'series', params] as const,
  usageTop: (ws: string, params: Record<string, unknown>) => ['w', ws, 'usage', 'top', params] as const,
  usageModels: (ws: string, params: Record<string, unknown>) => ['w', ws, 'usage', 'models', params] as const,
  usageAccounts: (ws: string) => ['w', ws, 'usage', 'accounts'] as const,
  usageCredentials: (ws: string) => ['w', ws, 'usage', 'credentials'] as const,

  knowledgeUsageRoot: (ws: string) => ['w', ws, 'knowledge-usage'] as const,
  knowledgeUsageSummary: (ws: string, params: Record<string, unknown>) => ['w', ws, 'knowledge-usage', 'summary', params] as const,
  knowledgeUsageTop: (ws: string, params: Record<string, unknown>) => ['w', ws, 'knowledge-usage', 'top', params] as const,
  knowledgeUsageNeverRead: (ws: string, params: Record<string, unknown>) => ['w', ws, 'knowledge-usage', 'never-read', params] as const,

  threads: (ws: string) => ['w', ws, 'threads'] as const,
  threadMessages: (ws: string, id: string) => ['w', ws, 'threads', id, 'messages'] as const,
  threadSearch: (ws: string, id: string, query: string) => ['w', ws, 'threads', id, 'search', query] as const,
  threadContext: (ws: string, id: string, messageId: string) => ['w', ws, 'threads', id, 'context', messageId] as const,

  // Its own root rather than a key under `projects` (VS-97): the events that make a pull request
  // list stale are ticket events, and nothing under `projects` is reached by one — the mistake
  // `qk.mergeQueue` made until VS-95.
  pullRequestsRoot: (ws: string) => ['w', ws, 'pull-requests'] as const,
  pullRequests: (ws: string, project: string) => ['w', ws, 'pull-requests', project] as const,
  pullRequest: (ws: string, project: string, number: number) => ['w', ws, 'pull-requests', project, 'one', number] as const,
  pullRequestDiffFiles: (ws: string, project: string, number: number) => ['w', ws, 'pull-requests', project, 'one', number, 'diff'] as const,
  pullRequestDiffFile: (ws: string, project: string, number: number, path: string) => ['w', ws, 'pull-requests', project, 'one', number, 'diff', path] as const,

  /** Deliberately not under `projects` — same trap VS-95 hit with the merge queue: nested there, no ticket or worker event would reach it. */
  historyRoot: (ws: string) => ['w', ws, 'history'] as const,
  history: (ws: string, project: string) => ['w', ws, 'history', project] as const,
  commit: (ws: string, project: string, sha: string) => ['w', ws, 'history', project, 'commits', sha] as const,

  /** Deliberately not under `projects` — scheduled tasks are workspace-scoped (VS-220). */
  routines: (ws: string) => ['w', ws, 'routines'] as const,
  routine: (ws: string, id: string) => ['w', ws, 'routines', id] as const,
  routineUsage: (ws: string, id: string, window: string) => ['w', ws, 'routines', id, 'usage', window] as const,
  routineFires: (ws: string, id: string) => ['w', ws, 'routines', id, 'fires'] as const,

  /** A project's roadmap (VS-397). Its own root so a `roadmap.*` event reaches it without being nested under `projects`. */
  roadmapRoot: (ws: string) => ['w', ws, 'roadmap'] as const,
  roadmap: (ws: string, projectId: string) => ['w', ws, 'roadmap', projectId] as const,
  /** A project's roadmap blocks (VS-478), nested under the roadmap key so one invalidation reaches both. */
  roadmapBlocks: (ws: string, projectId: string) => ['w', ws, 'roadmap', projectId, 'blocks'] as const,
  /** A captain-authored draft plan (VS-398). Its own root so a `plan.*` event reaches it without being nested under `projects`. */
  planRoot: (ws: string) => ['w', ws, 'plans'] as const,
  plan: (ws: string, planId: string) => ['w', ws, 'plans', planId] as const,
  /** VS-477: a project's drafting plans as tab summaries. Sits under `planRoot` so one `plan.*` invalidation reaches the tabs and the open plan alike. */
  plans: (ws: string, projectId: string) => ['w', ws, 'plans', 'project', projectId] as const,
  /** VS-550: every ticket created from a plan draft, keyed by ticket id — one workspace read for the Work board. */
  planOrigins: (ws: string) => ['w', ws, 'plans', 'origins'] as const,

  presentation: (ws: string) => ['w', ws, 'presentation'] as const,
  presentationSurfaces: (ws: string) => ['w', ws, 'presentation', 'surfaces'] as const,
  telegramToken: (ws: string) => ['w', ws, 'channels', 'telegram', 'token'] as const,
  telegramPending: (ws: string) => ['w', ws, 'channels', 'telegram', 'pending'] as const,
} as const;
