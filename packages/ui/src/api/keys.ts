/** Query keys, one place so SSE invalidation and hooks cannot drift. */
export const qk = {
  health: () => ['health'] as const,
  me: () => ['me'] as const,
  sessions: () => ['sessions'] as const,
  workspaces: () => ['workspaces'] as const,
  runtimes: () => ['runtimes'] as const,
  daemonUpdate: () => ['daemon', 'update'] as const,
  daemonUpgrade: () => ['daemon', 'upgrade'] as const,
  runtimeModels: (id: string) => ['runtimes', id, 'models'] as const,

  workspace: (ws: string) => ['w', ws] as const,
  briefing: (ws: string) => ['w', ws, 'briefing'] as const,
  projects: (ws: string) => ['w', ws, 'projects'] as const,
  project: (ws: string, id: string) => ['w', ws, 'projects', id] as const,
  mergeQueue: (ws: string, projectId: string) => ['w', ws, 'projects', projectId, 'merge-queue'] as const,
  roles: (ws: string) => ['w', ws, 'roles'] as const,
  role: (ws: string, id: string) => ['w', ws, 'roles', id] as const,
  workers: (ws: string) => ['w', ws, 'workers'] as const,
  worker: (ws: string, id: string) => ['w', ws, 'workers', id] as const,
  workerBrief: (ws: string, id: string) => ['w', ws, 'workers', id, 'brief'] as const,
  conductor: (ws: string) => ['w', ws, 'conductor'] as const,

  tickets: (ws: string) => ['w', ws, 'tickets'] as const,
  ticket: (ws: string, id: string) => ['w', ws, 'tickets', id] as const,
  ticketComments: (ws: string, id: string) => ['w', ws, 'tickets', id, 'comments'] as const,
  ticketDocuments: (ws: string, id: string) => ['w', ws, 'tickets', id, 'documents'] as const,
  ticketDocument: (ws: string, id: string, key: string) => ['w', ws, 'tickets', id, 'documents', key] as const,
  ticketDocumentRevisions: (ws: string, id: string, key: string) => ['w', ws, 'tickets', id, 'documents', key, 'revisions'] as const,
  ticketWorkProducts: (ws: string, id: string) => ['w', ws, 'tickets', id, 'work-products'] as const,
  ticketRuns: (ws: string, id: string) => ['w', ws, 'tickets', id, 'runs'] as const,
  ticketUsage: (ws: string, id: string) => ['w', ws, 'tickets', id, 'usage'] as const,

  decisions: (ws: string) => ['w', ws, 'decisions'] as const,
  decision: (ws: string, id: string) => ['w', ws, 'decisions', id] as const,

  runs: (ws: string) => ['w', ws, 'runs'] as const,
  run: (ws: string, id: string) => ['w', ws, 'runs', id] as const,
  runEvents: (ws: string, id: string) => ['w', ws, 'runs', id, 'events'] as const,

  knowledge: (ws: string) => ['w', ws, 'knowledge'] as const,
  knowledgeScope: (ws: string, scope: string, project?: string) => ['w', ws, 'knowledge', scope, project ?? ''] as const,
  knowledgeRevisions: (ws: string, scope: string, project?: string) => ['w', ws, 'knowledge', scope, project ?? '', 'revisions'] as const,
  search: (ws: string, q: string, project?: string) => ['w', ws, 'search', q, project ?? ''] as const,

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

  threads: (ws: string) => ['w', ws, 'threads'] as const,
  threadMessages: (ws: string, id: string) => ['w', ws, 'threads', id, 'messages'] as const,

  presentation: (ws: string) => ['w', ws, 'presentation'] as const,
} as const;
