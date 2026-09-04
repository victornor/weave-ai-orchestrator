import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type { RunEvent, TicketComment, Ticket, Decision, Agent, Role, Run, Project, UsageGrain, UsageWindow } from '@agent-conductor/shared';
import { listOf, api, qs } from './client';
import { qk } from './keys';
import { useWs } from './context';
import type * as T from './types';

/* ---------------------------------------------------------------- daemon */

export function useHealth(): UseQueryResult<T.Health> {
  return useQuery({ queryKey: qk.health(), queryFn: () => api.root<T.Health>('/health'), retry: false, staleTime: 30_000 });
}

export function useMe(enabled = true): UseQueryResult<T.AuthMe> {
  return useQuery({ queryKey: qk.me(), queryFn: () => api.root<T.AuthMe>('/auth/me'), enabled, retry: false });
}

export function useWorkspaces(): UseQueryResult<T.Workspace[]> {
  return useQuery({ queryKey: qk.workspaces(), queryFn: () => api.root<T.Workspace[]>('/workspaces') });
}

export function useRuntimes(): UseQueryResult<T.RuntimeInfo[]> {
  return useQuery({ queryKey: qk.runtimes(), queryFn: () => api.root<T.RuntimeInfo[]>('/runtimes'), staleTime: 60_000 });
}

export function useRuntimeModels(runtimeId: string | null | undefined): UseQueryResult<T.RuntimeModel[]> {
  return useQuery({
    queryKey: qk.runtimeModels(runtimeId ?? ''),
    queryFn: () =>
      api.root<Array<string | T.RuntimeModel> | { models: Array<string | T.RuntimeModel> }>(`/runtimes/${runtimeId}/models`).then((r) => {
        const list = listOf<string | T.RuntimeModel>(r, 'models');
        return list.map((m) => (typeof m === 'string' ? { id: m, label: m } : m));
      }),
    enabled: Boolean(runtimeId),
    staleTime: 300_000,
  });
}

/** First-run and "new workspace": scaffold on the daemon host and register it. */
export function useInitWorkspace(): UseMutationResult<{ id: string; path: string }, Error, { id: string; name: string; ticketPrefix: string; path?: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.root<{ id: string; path: string }>('/workspaces/init', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workspaces() });
      void qc.invalidateQueries({ queryKey: qk.health() });
    },
  });
}

export function useAuthSessions(): UseQueryResult<T.AuthSession[]> {
  return useQuery({ queryKey: qk.sessions(), queryFn: () => api.root<T.AuthSession[] | { sessions: T.AuthSession[] }>('/auth/sessions').then((r) => listOf(r, 'sessions')) });
}

/* ------------------------------------------------------------- workspace */

export function useWorkspaceSummary(): UseQueryResult<T.WorkspaceSummary> {
  const ws = useWs();
  return useQuery({ queryKey: qk.workspace(ws), queryFn: () => api.ws<T.WorkspaceSummary>(ws, '') });
}

export function useBriefing(): UseQueryResult<T.Briefing> {
  const ws = useWs();
  return useQuery({ queryKey: qk.briefing(ws), queryFn: () => api.ws<T.Briefing>(ws, '/briefing') });
}

export function useProjects(): UseQueryResult<Project[]> {
  const ws = useWs();
  return useQuery({ queryKey: qk.projects(ws), queryFn: () => api.ws<Project[]>(ws, '/projects') });
}

export function useAddProject(): UseMutationResult<Project, Error, { url: string; id?: string; runtime?: string; maxWorkers?: number; setupCommand?: string; autoMerge?: boolean }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.ws<Project>(ws, '/projects', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.projects(ws) }),
  });
}

export function usePatchProject(): UseMutationResult<Project, Error, { id: string; patch: Record<string, unknown> }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => api.ws<Project>(ws, `/projects/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.projects(ws) }),
  });
}

export function usePatchConfig(): UseMutationResult<unknown, Error, Record<string, unknown>> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch) => api.ws(ws, '/config', { method: 'PATCH', body: patch }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.workspace(ws) }),
  });
}

/* ----------------------------------------------------------------- roles */

export function useRoles(project?: string): UseQueryResult<Role[]> {
  const ws = useWs();
  return useQuery({ queryKey: [...qk.roles(ws), project ?? ''], queryFn: () => api.ws<Role[]>(ws, `/roles${qs({ project })}`) });
}

export function useRole(id: string): UseQueryResult<T.RoleDetail> {
  const ws = useWs();
  return useQuery({ queryKey: qk.role(ws, id), queryFn: () => api.ws<T.RoleDetail>(ws, `/roles/${id}`), enabled: Boolean(id) });
}

export function useRoleAction(): UseMutationResult<unknown, Error, { id: string; action: 'pause' | 'resume' | 'retire'; reason: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reason }) => api.ws(ws, `/roles/${id}/${action}`, { method: 'POST', body: { reason } }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: qk.roles(ws) });
      void qc.invalidateQueries({ queryKey: qk.role(ws, v.id) });
    },
  });
}

export function useUpdateRole(): UseMutationResult<unknown, Error, { id: string; patch: Record<string, unknown>; reason: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch, reason }) => api.ws(ws, `/roles/${id}`, { method: 'PATCH', body: { patch, reason } }),
    onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: qk.role(ws, v.id) }),
  });
}

export function usePutCharter(): UseMutationResult<unknown, Error, { id: string; charter: string; reason: string; applyToRunning?: boolean }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.ws(ws, `/roles/${id}/charter`, { method: 'PUT', body }),
    onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: qk.role(ws, v.id) }),
  });
}

export function useRollbackCharter(): UseMutationResult<unknown, Error, { id: string; revision: number }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, revision }) => api.ws(ws, `/roles/${id}/rollback`, { method: 'POST', body: { revision } }),
    onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: qk.role(ws, v.id) }),
  });
}

/* --------------------------------------------------------------- workers */

export function useWorkers(params: { status?: string; project?: string; role?: string; includeRetired?: boolean } = {}): UseQueryResult<Agent[]> {
  const ws = useWs();
  return useQuery({ queryKey: [...qk.workers(ws), params], queryFn: () => api.ws<Agent[]>(ws, `/workers${qs(params)}`) });
}

export function useWorker(id: string): UseQueryResult<T.WorkerDetail> {
  const ws = useWs();
  return useQuery({ queryKey: qk.worker(ws, id), queryFn: () => api.ws<T.WorkerDetail>(ws, `/workers/${id}`), enabled: Boolean(id) });
}

export function useWorkerBrief(id: string): UseQueryResult<{ brief: string }> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.workerBrief(ws, id),
    queryFn: () => api.ws<{ brief: string } | string>(ws, `/workers/${id}/brief`).then((r) => (typeof r === 'string' ? { brief: r } : r)),
    enabled: Boolean(id),
  });
}

export function useWorkerAction(): UseMutationResult<unknown, Error, { id: string; action: 'relaunch' | 'cancel' | 'pause' | 'resume'; note?: string; reason?: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, note, reason }) =>
      api.ws(ws, `/workers/${id}/${action}`, { method: 'POST', body: action === 'relaunch' ? { note: note ?? '' } : action === 'cancel' ? { reason: reason ?? '' } : {} }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: qk.worker(ws, v.id) });
      void qc.invalidateQueries({ queryKey: qk.workers(ws) });
    },
  });
}

export function useConductor(): UseQueryResult<T.WorkerDetail> {
  const ws = useWs();
  return useQuery({ queryKey: qk.conductor(ws), queryFn: () => api.ws<T.WorkerDetail>(ws, '/conductor') });
}

export function usePatchConductor(): UseMutationResult<unknown, Error, { runtime?: string; model?: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.ws(ws, '/conductor', { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.conductor(ws) }),
  });
}

/* --------------------------------------------------------------- tickets */

export interface TicketQuery extends Record<string, string | number | boolean | undefined> {
  project?: string;
  status?: string;
  kind?: string;
  role?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function useTickets(params: TicketQuery = {}): UseQueryResult<Ticket[]> {
  const ws = useWs();
  return useQuery({
    queryKey: [...qk.tickets(ws), params],
    queryFn: () => api.ws<Ticket[] | { tickets: Ticket[] }>(ws, `/tickets${qs(params)}`).then((r) => listOf(r, 'tickets')),
  });
}

export function useTicket(id: string): UseQueryResult<T.TicketDetail> {
  const ws = useWs();
  return useQuery({ queryKey: qk.ticket(ws, id), queryFn: () => api.ws<T.TicketDetail>(ws, `/tickets/${id}`), enabled: Boolean(id) });
}

export function useCreateTicket(): UseMutationResult<Ticket, Error, Record<string, unknown>> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.ws<Ticket>(ws, '/tickets', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.tickets(ws) }),
  });
}

export function usePatchTicket(): UseMutationResult<Ticket, Error, { id: string; patch: Partial<Pick<Ticket, 'title' | 'description' | 'priority' | 'autoMerge'>> }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => api.ws<Ticket>(ws, `/tickets/${id}`, { method: 'PATCH', body: patch }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.ticket(ws, id) });
      const prev = qc.getQueryData<T.TicketDetail>(qk.ticket(ws, id));
      if (prev) qc.setQueryData(qk.ticket(ws, id), { ...prev, ticket: { ...prev.ticket, ...patch } });
      return { prev };
    },
    onError: (_e, v, ctx) => {
      const c = ctx as { prev?: T.TicketDetail } | undefined;
      if (c?.prev) qc.setQueryData(qk.ticket(ws, v.id), c.prev);
    },
    onSettled: (_d, _e, v) => void qc.invalidateQueries({ queryKey: qk.ticket(ws, v.id) }),
  });
}

export function useTransitionTicket(): UseMutationResult<Ticket, Error, { id: string; to: string; note?: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, to, note }) => api.ws<Ticket>(ws, `/tickets/${id}/transition`, { method: 'POST', body: { to, note } }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: qk.ticket(ws, v.id) });
      void qc.invalidateQueries({ queryKey: qk.tickets(ws) });
    },
  });
}

export function useTicketComments(id: string): UseQueryResult<TicketComment[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.ticketComments(ws, id),
    queryFn: () => api.ws<TicketComment[] | { comments: TicketComment[] }>(ws, `/tickets/${id}/comments`).then((r) => listOf(r, 'comments')),
    enabled: Boolean(id),
  });
}

export function usePostComment(): UseMutationResult<TicketComment, Error, { id: string; body: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => api.ws<TicketComment>(ws, `/tickets/${id}/comments`, { method: 'POST', body: { body } }),
    onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: qk.ticketComments(ws, v.id) }),
  });
}

export function useTicketDocument(id: string, key: string, revision?: number): UseQueryResult<T.TicketDocument> {
  const ws = useWs();
  return useQuery({
    queryKey: [...qk.ticketDocument(ws, id, key), revision ?? 'head'],
    queryFn: () => api.ws<T.TicketDocument>(ws, `/tickets/${id}/documents/${key}${qs({ revision })}`),
    enabled: Boolean(id && key),
  });
}

export function useTicketDocumentRevisions(id: string, key: string): UseQueryResult<T.DocumentRevision[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.ticketDocumentRevisions(ws, id, key),
    queryFn: () =>
      api.ws<T.DocumentRevision[] | { revisions: T.DocumentRevision[] }>(ws, `/tickets/${id}/documents/${key}/revisions`).then((r) => listOf(r, 'revisions')),
    enabled: Boolean(id && key),
  });
}

export function useTicketWorkProducts(id: string): UseQueryResult<T.WorkProduct[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.ticketWorkProducts(ws, id),
    queryFn: () => api.ws<T.WorkProduct[] | { workProducts: T.WorkProduct[] }>(ws, `/tickets/${id}/work-products`).then((r) => listOf(r, 'workProducts')),
    enabled: Boolean(id),
  });
}

export function useTicketRuns(id: string): UseQueryResult<Run[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.ticketRuns(ws, id),
    queryFn: () => api.ws<Run[] | { runs: Run[] }>(ws, `/tickets/${id}/runs`).then((r) => listOf(r, 'runs')),
    enabled: Boolean(id),
  });
}

export function useTicketUsage(id: string): UseQueryResult<{ total: T.UsageTotals; subtree?: T.UsageTotals; turns?: Array<{ runId: string; startedAt: string; tokens: number; costCents: number | null }> }> {
  const ws = useWs();
  return useQuery({ queryKey: qk.ticketUsage(ws, id), queryFn: () => api.ws(ws, `/tickets/${id}/usage`), enabled: Boolean(id) });
}

/* ------------------------------------------------------------- decisions */

export function useDecisions(params: { status?: string; owner?: string } = { status: 'open', owner: 'human' }): UseQueryResult<Decision[]> {
  const ws = useWs();
  return useQuery({
    queryKey: [...qk.decisions(ws), params],
    queryFn: () => api.ws<Decision[] | { decisions: Decision[] }>(ws, `/decisions${qs(params)}`).then((r) => listOf(r, 'decisions')),
  });
}

export function useAnswerDecision(): UseMutationResult<unknown, Error, { id: string; key?: string; text?: string; remember?: boolean }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.ws(ws, `/decisions/${id}/answer`, { method: 'POST', body }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: qk.decisions(ws) });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.decisions(ws) });
      void qc.invalidateQueries({ queryKey: qk.briefing(ws) });
    },
  });
}

/* ------------------------------------------------------------------ runs */

export function useRuns(params: { agent?: string; ticket?: string; status?: string; limit?: number; offset?: number } = {}): UseQueryResult<Run[]> {
  const ws = useWs();
  return useQuery({
    queryKey: [...qk.runs(ws), params],
    queryFn: () => api.ws<Run[] | { runs: Run[] }>(ws, `/runs${qs(params)}`).then((r) => listOf(r, 'runs')),
  });
}

export function useRun(id: string): UseQueryResult<T.RunDetail> {
  const ws = useWs();
  return useQuery({ queryKey: qk.run(ws, id), queryFn: () => api.ws<T.RunDetail>(ws, `/runs/${id}`), enabled: Boolean(id) });
}

export function useRunEvents(id: string, after = 0): UseQueryResult<RunEvent[]> {
  const ws = useWs();
  return useQuery({
    queryKey: [...qk.runEvents(ws, id), after],
    queryFn: () => api.ws<RunEvent[] | { events: RunEvent[] }>(ws, `/runs/${id}/events${qs({ after, limit: 500 })}`).then((r) => listOf(r, 'events')),
    enabled: Boolean(id),
  });
}

/* ------------------------------------------------------- knowledge/specs */

export function useKnowledgeIndex(): UseQueryResult<T.KnowledgeIndex> {
  const ws = useWs();
  return useQuery({ queryKey: qk.knowledge(ws), queryFn: () => api.ws<T.KnowledgeIndex>(ws, '/knowledge') });
}

export function useKnowledgeDoc(scope: string, project?: string): UseQueryResult<T.KnowledgeDoc> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.knowledgeScope(ws, scope, project),
    queryFn: () => api.ws<T.KnowledgeDoc>(ws, `/knowledge/${scope}${qs({ project })}`),
    enabled: Boolean(scope),
  });
}

export function useKnowledgeRevisions(scope: string, project?: string): UseQueryResult<T.KnowledgeRevision[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.knowledgeRevisions(ws, scope, project),
    queryFn: () =>
      api.ws<T.KnowledgeRevision[] | { revisions: T.KnowledgeRevision[] }>(ws, `/knowledge/${scope}/revisions${qs({ project })}`).then((r) => listOf(r, 'revisions')),
    enabled: Boolean(scope),
  });
}

export function useKnowledgeMutation(): UseMutationResult<unknown, Error, { scope: string; project?: string; op: 'put' | 'revert' | 'curate'; body?: string; revision?: number }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ scope, project, op, body, revision }) => {
      if (op === 'put') return api.ws(ws, `/knowledge/${scope}${qs({ project })}`, { method: 'PUT', body: { body } });
      if (op === 'revert') return api.ws(ws, `/knowledge/${scope}/revert${qs({ project })}`, { method: 'POST', body: { revision } });
      return api.ws(ws, `/knowledge/${scope}/curate${qs({ project })}`, { method: 'POST', body: {} });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.knowledge(ws) }),
  });
}

export function useSearch(q: string, project?: string): UseQueryResult<T.SearchHit[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.search(ws, q, project),
    queryFn: () => api.ws<T.SearchHit[] | { hits: T.SearchHit[] }>(ws, `/search${qs({ q, project })}`).then((r) => listOf(r, 'hits')),
    enabled: q.trim().length > 1,
  });
}

export function useCapabilities(project: string): UseQueryResult<T.CapabilitySummary[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.specs(ws, project),
    queryFn: () => api.ws<T.CapabilitySummary[] | { capabilities: T.CapabilitySummary[] }>(ws, `/specs/${project}`).then((r) => listOf(r, 'capabilities')),
    enabled: Boolean(project),
  });
}

export function useCapability(project: string, capability: string): UseQueryResult<T.CapabilityDetail> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.capability(ws, project, capability),
    queryFn: () => api.ws<T.CapabilityDetail>(ws, `/specs/${project}/capabilities/${capability}`),
    enabled: Boolean(project && capability),
  });
}

export function useSpecChanges(project: string, state?: string): UseQueryResult<T.SpecChangeSummary[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.changes(ws, project, state),
    queryFn: () => api.ws<T.SpecChangeSummary[] | { changes: T.SpecChangeSummary[] }>(ws, `/specs/${project}/changes${qs({ state })}`).then((r) => listOf(r, 'changes')),
    enabled: Boolean(project),
  });
}

export function useSpecChange(project: string, name: string): UseQueryResult<T.SpecChangeDetail> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.change(ws, project, name),
    queryFn: () => api.ws<T.SpecChangeDetail>(ws, `/specs/${project}/changes/${name}`),
    enabled: Boolean(project && name),
  });
}

export function useSpecGraph(project: string): UseQueryResult<T.SpecGraph> {
  const ws = useWs();
  return useQuery({ queryKey: qk.specGraph(ws, project), queryFn: () => api.ws<T.SpecGraph>(ws, `/specs/${project}/graph`), enabled: Boolean(project) });
}

/* ----------------------------------------------------------------- usage */

export interface UsageParams extends Record<string, string | undefined> {
  scope?: string;
  window?: UsageWindow;
  grain?: UsageGrain;
  start?: string;
  end?: string;
}

export function useUsage(params: UsageParams): UseQueryResult<T.UsageSeries> {
  const ws = useWs();
  return useQuery({ queryKey: qk.usage(ws, params), queryFn: () => api.ws<T.UsageSeries>(ws, `/usage${qs(params)}`) });
}

export function useUsageTop(params: UsageParams & { by: 'model' | 'ticket' | 'role' | 'worker' | 'project' }): UseQueryResult<T.UsageTopRow[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.usageTop(ws, params),
    queryFn: () => api.ws<T.UsageTopRow[] | { rows: T.UsageTopRow[] }>(ws, `/usage/top${qs(params)}`).then((r) => listOf(r, 'rows')),
  });
}

export function useUsageModels(params: UsageParams): UseQueryResult<T.UsageModelRow[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.usageModels(ws, params),
    queryFn: () => api.ws<T.UsageModelRow[] | { models: T.UsageModelRow[] }>(ws, `/usage/models${qs(params)}`).then((r) => listOf(r, 'models')),
  });
}

/* --------------------------------------------------------------- threads */

export function useThreads(): UseQueryResult<T.ThreadSummary[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.threads(ws),
    queryFn: () => api.ws<T.ThreadSummary[] | { threads: T.ThreadSummary[] }>(ws, '/threads?channel=web').then((r) => listOf(r, 'threads')),
  });
}

export function useCreateThread(): UseMutationResult<T.ThreadSummary, Error, { label?: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.ws<T.ThreadSummary>(ws, '/threads', { method: 'POST', body: { channel: 'web', ...body } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.threads(ws) }),
  });
}

export function useThreadMessages(id: string | null): UseQueryResult<T.ThreadMessage[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.threadMessages(ws, id ?? ''),
    queryFn: () =>
      api.ws<T.ThreadMessage[] | T.ThreadMessagesPage>(ws, `/threads/${id}/messages${qs({ limit: 200 })}`).then((r) => listOf(r, 'messages')),
    enabled: Boolean(id),
  });
}

export function usePostThreadMessage(): UseMutationResult<unknown, Error, { threadId: string; body: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, body }) => api.ws(ws, `/threads/${threadId}/messages`, { method: 'POST', body: { body } }),
    onSettled: (_d, _e, v) => void qc.invalidateQueries({ queryKey: qk.threadMessages(ws, v.threadId) }),
  });
}

/* ---------------------------------------------------------- presentation */

export function usePresentation(): UseQueryResult<T.PresentationConfig> {
  const ws = useWs();
  return useQuery({ queryKey: qk.presentation(ws), queryFn: () => api.ws<T.PresentationConfig>(ws, '/presentation') });
}

export function usePutPresentation(): UseMutationResult<unknown, Error, Record<string, unknown>> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.ws(ws, '/presentation', { method: 'PUT', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.presentation(ws) }),
  });
}
