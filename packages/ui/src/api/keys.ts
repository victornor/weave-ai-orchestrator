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
  incidents: (reporter?: string) => ['incidents', reporter ?? 'all'] as const,
  runtimeModels: (id: string) => ['runtimes', id, 'models'] as const,

  workspace: (ws: string) => ['w', ws] as const,
  briefing: (ws: string) => ['w', ws, 'briefing'] as const,
  projects: (ws: string) => ['w', ws, 'projects'] as const,
  project: (ws: string, id: string) => ['w', ws, 'projects', id] as const,
  /** How a project's clone compares to its remote (VS-131) — its own key so a `project.updated` invalidation of `qk.projects` doesn't force a re-check on every render. */
  projectSync: (ws: string, id: string) => ['w', ws, 'projects', id, 'sync'] as const,
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
  conductor: (ws: string) => ['w', ws, 'conductor'] as const,
  models: (ws: string) => ['w', ws, 'models'] as const,

  tickets: (ws: string) => ['w', ws, 'tickets'] as const,
  ticket: (ws: string, id: string) => ['w', ws, 'tickets', id] as const,
  ticketComments: (ws: string, id: string) => ['w', ws, 'tickets', id, 'comments'] as const,
  ticketDocuments: (ws: string, id: string) => ['w', ws, 'tickets', id, 'documents'] as const,
  ticketDocument: (ws: string, id: string, key: string) => ['w', ws, 'tickets', id, 'documents', key] as const,
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
  runEvents: (ws: string, id: string) => ['w', ws, 'runs', id, 'events'] as const,
  /** Run trace summaries for a set of runs; under `runs`, so `run.started`/`run.finished` already refresh them. */
  runTraces: (ws: string, params: Record<string, unknown>) => ['w', ws, 'runs', 'traces', params] as const,

  knowledge: (ws: string) => ['w', ws, 'knowledge'] as const,
  knowledgeScope: (ws: string, scope: string, project?: string) => ['w', ws, 'knowledge', scope, project ?? ''] as const,
  knowledgeRevisions: (ws: string, scope: string, project?: string) => ['w', ws, 'knowledge', scope, project ?? '', 'revisions'] as const,
  search: (ws: string, q: string, project?: string) => ['w', ws, 'search', q, project ?? ''] as const,

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

  presentation: (ws: string) => ['w', ws, 'presentation'] as const,
  presentationSurfaces: (ws: string) => ['w', ws, 'presentation', 'surfaces'] as const,
  telegramToken: (ws: string) => ['w', ws, 'channels', 'telegram', 'token'] as const,
  telegramPending: (ws: string) => ['w', ws, 'channels', 'telegram', 'pending'] as const,
} as const;
