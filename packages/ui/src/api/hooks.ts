import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type { RunEvent, RunTrace, TicketComment, Ticket, Decision, DecisionAnswerInputs, Agent, Role, Run, Project, UsageGrain, UsageWindow, Workspace } from '@agent-conductor/shared';
import { dayKey } from '@agent-conductor/render';
import { listOf, api, qs } from './client';
import { qk } from './keys';
import { useWs } from './context';
import type * as T from './types';
import { upgradePollInterval } from '../lib/upgrade';

/* ------------------------------------------------------------- shapes
 * The daemon answers in the shapes documented in docs/API.md (flat rows, `{ items, total }` pages,
 * `{ worker, ... }` details). The pages were built against slightly richer view models; these
 * adapters bridge the two so a route never crashes on a field the daemon does not send.
 */
type CostStatus = T.UsageTotals['costStatus'];

function totals(v: unknown): T.UsageTotals {
  const r = (v ?? {}) as Record<string, unknown>;
  const num = (k: string): number => (typeof r[k] === 'number' ? (r[k] as number) : 0);
  const costCents = typeof r['costCents'] === 'number' ? (r['costCents'] as number) : null;
  return {
    tokensIn: num('tokensIn'), tokensOut: num('tokensOut'), tokensCached: num('tokensCached'), runs: num('runs'),
    workerTurns: num('workerTurns') || num('runs'), durationMs: num('durationMs'), costCents,
    costStatus: (r['costStatus'] as CostStatus | undefined) ?? ((costCents == null ? 'unknown' : 'estimated') as CostStatus),
  };
}

function usageSeries(v: unknown): T.UsageSeries {
  const r = (v ?? {}) as Record<string, unknown>;
  if (Array.isArray(r['series'])) return r as unknown as T.UsageSeries;
  const range = (r['range'] ?? {}) as Record<string, string>;
  const points = listOf<Record<string, unknown>>(r['points'] ?? []);
  return {
    scope: String(r['scope'] ?? 'workspace'),
    window: (range['window'] ?? 'week') as UsageWindow,
    grain: (range['grain'] ?? 'day') as UsageGrain,
    start: range['start'] ?? '', end: range['end'] ?? '',
    series: points.map((p) => ({ ...totals(p), bucket: String(p['bucket'] ?? '') })),
    total: totals(r['total']),
    previous: r['previous'] ? totals(r['previous']) : undefined,
    reportedShare: typeof r['costReportedShare'] === 'number' ? (r['costReportedShare'] as number) : (r['reportedShare'] as number | undefined),
    billingMix: r['billingMix'] as T.UsageSeries['billingMix'],
  } as T.UsageSeries;
}

function topRow(v: unknown): T.UsageTopRow {
  const r = (v ?? {}) as Record<string, unknown>;
  const t = totals(r);
  return {
    key: String(r['key'] ?? ''), label: String(r['label'] ?? r['key'] ?? ''), sublabel: (r['sublabel'] as string | null | undefined) ?? null,
    tokens: typeof r['tokens'] === 'number' ? (r['tokens'] as number) : t.tokensIn + t.tokensOut,
    costCents: t.costCents, costStatus: t.costStatus, share: r['share'] as number | undefined,
  };
}

function workerDetail(v: unknown): T.WorkerDetail {
  const r = (v ?? {}) as Record<string, unknown>;
  const agent = (r['agent'] ?? r['worker'] ?? (r['id'] ? r : null)) as Agent | null;
  if (!agent) throw new Error('worker detail without an agent');
  const usage = r['usage'] as Record<string, unknown> | null | undefined;
  return {
    agent,
    ticket: (r['ticket'] as Ticket | null | undefined) ?? null,
    role: (r['role'] as Role | null | undefined) ?? null,
    project: (r['project'] as Project | null | undefined) ?? null,
    lastRun: (r['lastRun'] as Run | null | undefined) ?? null,
    usage: usage ? totals(usage['total'] ?? usage) : null,
    worktree: (r['worktree'] as T.WorkerDetail['worktree'] | undefined) ?? (agent.worktreePath ? { status: 'unknown', dirty: false, ahead: 0, behind: 0, path: agent.worktreePath } : null),
    input: (r['input'] as T.WorkerDetail['input'] | undefined) ?? { midTurn: false },
    sessionResumable: Boolean(r['sessionResumable']),
  };
}

function summary(v: unknown): T.WorkspaceSummary {
  const r = (v ?? {}) as Record<string, unknown>;
  if (r['workspace'] && typeof r['workspace'] === 'object') return r as unknown as T.WorkspaceSummary;
  const cfg = (r['config'] ?? {}) as Record<string, unknown>;
  const id = String(r['id'] ?? cfg['id'] ?? '');
  return {
    workspace: {
      id, slug: id, name: String(r['name'] ?? cfg['name'] ?? id), ticketPrefix: String(r['ticketPrefix'] ?? cfg['ticketPrefix'] ?? ''),
      status: String(r['status'] ?? 'active') as Workspace['status'], rootPath: String(r['rootPath'] ?? r['root'] ?? ''),
      createdAt: '', updatedAt: '',
    },
    config: cfg,
    counts: r['counts'] as T.WorkspaceSummary['counts'],
  };
}

function ticketDetail(v: unknown): T.TicketDetail {
  const r = (v ?? {}) as Record<string, unknown>;
  const spec = r['openspecState'] as Record<string, unknown> | null | undefined;
  const docs = listOf<Record<string, unknown>>(r['documents'] ?? []);
  return {
    ticket: r['ticket'] as Ticket,
    project: (r['project'] as Project | null | undefined) ?? null,
    worker: (r['worker'] as Agent | null | undefined) ?? null,
    role: (r['role'] as Role | null | undefined) ?? null,
    blockers: listOf<Ticket>(r['blockers'] ?? []),
    children: listOf<Ticket>(r['children'] ?? []),
    documents: docs.map((d) => ({ key: String(d['key'] ?? ''), revision: Number(d['revision'] ?? 0), updatedAt: String(d['updatedAt'] ?? d['createdAt'] ?? ''), title: d['title'] as string | undefined })),
    workProducts: listOf<T.WorkProduct>(r['workProducts'] ?? []),
    mergeQueue: {
      position: (((r['mergeQueue'] ?? {}) as Record<string, unknown>)['position'] as number | null | undefined) ?? null,
      concurrency: Number(((r['mergeQueue'] ?? {}) as Record<string, unknown>)['concurrency'] ?? 1),
    },
    openspecState: spec
      ? {
          changeName: (spec['changeName'] as string | null) ?? null,
          state: (spec['state'] as string | null | undefined) ?? (spec['archived'] ? 'archived' : (spec['applyState'] as string | null | undefined) ?? (spec['planningComplete'] ? 'planned' : 'proposing')),
          tasks: listOf<{ text: string; done: boolean }>(spec['tasks'] ?? []),
          validated: spec['validated'] as boolean | undefined ?? (typeof spec['validation'] === 'object' && spec['validation'] !== null ? Boolean((spec['validation'] as Record<string, unknown>)['ok']) : undefined),
        }
      : null,
    usage: r['usage'] ? totals((r['usage'] as Record<string, unknown>)['total'] ?? r['usage']) : undefined,
  };
}

function runDetail(v: unknown): T.RunDetail {
  const r = (v ?? {}) as Record<string, unknown>;
  if (r['run'] && typeof r['run'] === 'object') { const d = r as unknown as Partial<T.RunDetail>; return { run: d.run as Run, agent: d.agent ?? null, ticket: d.ticket ?? null, phases: d.phases ?? [], usage: d.usage ?? null }; }
  const run = r as unknown as Run;
  return { run, agent: null, ticket: null, phases: [], usage: run.usage ? totals(run.usage) : null };
}


/* ---------------------------------------------------------------- daemon */

export function useHealth(): UseQueryResult<T.Health> {
  return useQuery({ queryKey: qk.health(), queryFn: () => api.root<T.Health>('/health'), retry: false, staleTime: 30_000 });
}

export function useMe(enabled = true): UseQueryResult<T.AuthMe> {
  return useQuery({ queryKey: qk.me(), queryFn: () => api.root<T.AuthMe>('/auth/me'), enabled, retry: false });
}

/**
 * Every workspace, with its Needs-you count. The sidebar badges all of them at once, so this is
 * refetched on an interval: the active workspace's own badge comes from its live decisions query,
 * and this covers the others without an event stream each.
 */
export function useWorkspaces(): UseQueryResult<T.WorkspaceListItem[]> {
  return useQuery({ queryKey: qk.workspaces(), queryFn: () => api.root<T.WorkspaceListItem[]>('/workspaces'), refetchInterval: 60_000 });
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

/* ---- daemon updates and the deferred upgrade (PLAN §20) ---- */

/**
 * Is the release source ahead of the running daemon? Cached daemon-side, so polling it is cheap; a
 * refresh resolves the source again. A failed check is data, not an error state: the hook still
 * resolves, with `error` set on the payload.
 */
export function useDaemonUpdate(): UseQueryResult<T.UpdateStatus> {
  return useQuery({
    queryKey: qk.daemonUpdate(),
    queryFn: () => api.root<T.UpdateStatus>('/daemon/update'),
    retry: false,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useRefreshDaemonUpdate(): UseMutationResult<T.UpdateStatus, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.root<T.UpdateStatus>('/daemon/update?refresh=1'),
    onSuccess: (status) => { qc.setQueryData(qk.daemonUpdate(), status); },
  });
}

/**
 * The upgrade record. Polled while it is in flight — the daemon restarts partway through, so the poll
 * failing is expected and is also how the client notices it is back. Once terminal, polling stops.
 */
export function useDaemonUpgrade(): UseQueryResult<T.UpgradeStatusResponse> {
  return useQuery({
    queryKey: qk.daemonUpgrade(),
    queryFn: () => api.root<T.UpgradeStatusResponse>('/daemon/upgrade'),
    retry: false,
    refetchInterval: (query) => upgradePollInterval(query.state.data?.upgrade?.state),
  });
}

export function useRequestUpgrade(): UseMutationResult<T.Upgrade, Error, { ref?: string; source?: string; test?: boolean } | void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.root<T.Upgrade>('/daemon/upgrade', { method: 'POST', body: body ?? {} }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.daemonUpgrade() }); },
  });
}

export function useCancelUpgrade(): UseMutationResult<T.Upgrade, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.root<T.Upgrade>('/daemon/upgrade/cancel', { method: 'POST', body: {} }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.daemonUpgrade() });
      void qc.invalidateQueries({ queryKey: qk.daemonUpdate() });
    },
  });
}

export function useAuthSessions(): UseQueryResult<T.AuthSession[]> {
  return useQuery({ queryKey: qk.sessions(), queryFn: () => api.root<T.AuthSession[] | { sessions: T.AuthSession[] }>('/auth/sessions').then((r) => listOf(r, 'sessions')) });
}

/* ------------------------------------------------------------- workspace */

export function useWorkspaceSummary(): UseQueryResult<T.WorkspaceSummary> {
  const ws = useWs();
  return useQuery({ queryKey: qk.workspace(ws), queryFn: () => api.ws<unknown>(ws, '').then(summary) });
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
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: qk.role(ws, v.id) });
      void qc.invalidateQueries({ queryKey: qk.roles(ws) });   // the Team list renders maxWorkers too
    },
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

/** `GET /workers` marks which ticket is an interactive session (VS-101) — joined server-side, not part of `Agent` itself. */
export type WorkerListItem = Agent & { interactiveSession: boolean };

export function useWorkers(params: { status?: string; project?: string; role?: string; includeRetired?: boolean } = {}): UseQueryResult<WorkerListItem[]> {
  const ws = useWs();
  return useQuery({ queryKey: [...qk.workers(ws), params], queryFn: () => api.ws<WorkerListItem[]>(ws, `/workers${qs(params)}`) });
}

export function useWorker(id: string): UseQueryResult<T.WorkerDetail> {
  const ws = useWs();
  return useQuery({ queryKey: qk.worker(ws, id), queryFn: () => api.ws<unknown>(ws, `/workers/${id}`).then(workerDetail), enabled: Boolean(id) });
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

/** Steer a worker (VS-99): posts the ticket comment server-side and attempts mid-turn delivery when `live`. */
export function useWorkerMessage(): UseMutationResult<T.WorkerMessageOutcome, Error, { id: string; ticketId: string; body: string; live?: boolean }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body, live }) => api.ws<T.WorkerMessageOutcome>(ws, `/workers/${id}/message`, { method: 'POST', body: { body, live } }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: qk.worker(ws, v.id) });
      void qc.invalidateQueries({ queryKey: qk.ticketComments(ws, v.ticketId) });
    },
  });
}

/**
 * Start an interactive session (VS-101): always against a ticket, either an existing one or one
 * created in this same call. The session's agent is that ticket's worker, provisioned exactly as
 * `spawn` provisions any worker's.
 */
export function useStartSession(): UseMutationResult<Agent, Error, { ticketId: string } | { projectId: string; roleId: string; kind: string; title: string; description?: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.ws<Agent>(ws, '/workers/start-session', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.workers(ws) }),
  });
}

export function useConductor(): UseQueryResult<T.WorkerDetail> {
  const ws = useWs();
  return useQuery({ queryKey: qk.conductor(ws), queryFn: () => api.ws<unknown>(ws, '/conductor').then(workerDetail) });
}

/** The workspace's two model settings: the whole of model selection (VS-77). */
export function useModels(): UseQueryResult<T.WorkspaceModels> {
  const ws = useWs();
  return useQuery({ queryKey: qk.models(ws), queryFn: () => api.ws<T.WorkspaceModels>(ws, '/models') });
}

/**
 * `PUT /models` replaces both settings, so the whole block goes back every time — a partial body
 * would drop the setting that was not being changed.
 */
export function useSetModels(): UseMutationResult<T.WorkspaceModels, Error, T.WorkspaceModels> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.ws<T.WorkspaceModels>(ws, '/models', { method: 'PUT', body }),
    onSuccess: (next) => {
      qc.setQueryData(qk.models(ws), next);
      void qc.invalidateQueries({ queryKey: qk.conductor(ws) });
    },
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
  includeTerminal?: boolean;
  /** `finished` orders by when a ticket reached done or cancelled, not by when it was filed. */
  sort?: 'number' | 'finished';
}

export function useTickets(params: TicketQuery = {}, opts: { enabled?: boolean } = {}): UseQueryResult<Ticket[]> {
  const ws = useWs();
  return useQuery({
    queryKey: [...qk.tickets(ws), params],
    queryFn: () => api.ws<Ticket[] | { tickets: Ticket[] }>(ws, `/tickets${qs(params)}`).then((r) => listOf(r, 'tickets')),
    enabled: opts.enabled ?? true,
  });
}

export function useTicket(id: string): UseQueryResult<T.TicketDetail> {
  const ws = useWs();
  return useQuery({ queryKey: qk.ticket(ws, id), queryFn: () => api.ws<unknown>(ws, `/tickets/${id}`).then(ticketDetail).then(async (d) => {
        // The daemon's detail carries ids; the page shows names. Two cheap lookups, tolerated if they fail.
        if (!d.project && d.ticket.projectId) d.project = await api.ws<Project>(ws, `/projects/${d.ticket.projectId}`).catch(() => null);
        if (!d.role && d.ticket.assigneeRoleId) d.role = await api.ws<{ role: Role }>(ws, `/roles/${d.ticket.assigneeRoleId}`).then((r) => r.role ?? null).catch(() => null);
        return d;
      }), enabled: Boolean(id) });
}

/** A project's merge queue: what is landing now and who is waiting, in order (PLAN §11.4). */
export function useMergeQueue(projectId: string | null | undefined): UseQueryResult<T.MergeQueue> {
  const ws = useWs();
  return useQuery({ queryKey: qk.mergeQueue(ws, projectId ?? ''), queryFn: () => api.ws<T.MergeQueue>(ws, `/projects/${projectId ?? ''}/merge-queue`), enabled: Boolean(projectId) });
}

/**
 * A project's pull requests (VS-97). The daemon caches the forge behind this, and `invalidateFor`
 * re-reads it on the ticket events the daemon drops that cache on, so there is nothing to poll.
 */
export function usePullRequests(projectId: string | null | undefined): UseQueryResult<T.ProjectPullRequests> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.pullRequests(ws, projectId ?? ''),
    queryFn: () => api.ws<T.ProjectPullRequests>(ws, `/projects/${encodeURIComponent(projectId ?? '')}/pull-requests`),
    enabled: Boolean(projectId),
  });
}

/** One pull request with its description, its changed files and its checks. */
export function usePullRequest(projectId: string | null | undefined, number: number | null): UseQueryResult<T.PullRequestDetailResult> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.pullRequest(ws, projectId ?? '', number ?? 0),
    queryFn: () => api.ws<T.PullRequestDetailResult>(ws, `/projects/${encodeURIComponent(projectId ?? '')}/pull-requests/${number ?? 0}`),
    enabled: Boolean(projectId) && number !== null,
  });
}

const HISTORY_PAGE_SIZE = 30;

export interface ProjectHistory {
  refs: T.ProjectRef[] | undefined;
  commits: T.HistoryCommit[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
}

/**
 * The project's commit graph (VS-96), a page at a time. `GET /projects/:id/history` answers
 * newest-first already and hands back the cursor for the page after it, exactly like the changelog
 * (`useChangelog`) — no page needs reversing, and `refs` is only ever read from the first page: the
 * ref list a cursor was resolved against does not change while paging through it.
 */
export function useProjectHistory(projectId: string | null | undefined): ProjectHistory {
  const ws = useWs();
  const q = useInfiniteQuery({
    queryKey: qk.history(ws, projectId ?? ''),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.ws<T.HistoryPage>(ws, `/projects/${encodeURIComponent(projectId ?? '')}/history${qs({ limit: HISTORY_PAGE_SIZE, cursor: pageParam })}`),
    getNextPageParam: (page) => page.cursor ?? undefined,
    enabled: Boolean(projectId),
  });

  const commits = useMemo(() => (q.data ? q.data.pages.flatMap((p) => p.commits) : undefined), [q.data]);
  const refs = q.data?.pages[0]?.refs;
  const { hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = q;

  return {
    refs, commits,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void refetch(),
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    loadMore: () => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage(); },
  };
}

/** One commit's full message and changed files. */
export function useCommit(projectId: string | null | undefined, sha: string | null): UseQueryResult<T.CommitDetail> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.commit(ws, projectId ?? '', sha ?? ''),
    queryFn: () => api.ws<T.CommitDetail>(ws, `/projects/${encodeURIComponent(projectId ?? '')}/commits/${encodeURIComponent(sha ?? '')}`),
    enabled: Boolean(projectId) && Boolean(sha),
  });
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

export function useRetryTicket(): UseMutationResult<Ticket, Error, { id: string; note?: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }) => api.ws<Ticket>(ws, `/tickets/${id}/retry`, { method: 'POST', body: note ? { note } : {} }),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: qk.ticket(ws, v.id) }); void qc.invalidateQueries({ queryKey: qk.tickets(ws) }); },
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

export function useDecisions(
  params: { status?: string | string[]; owner?: string; limit?: number } = { status: 'open', owner: 'human' },
): UseQueryResult<Decision[]> {
  const ws = useWs();
  // The route reads `status` as a comma-separated list, so several statuses cost no route work.
  const status = Array.isArray(params.status) ? params.status.join(',') : params.status;
  return useQuery({
    queryKey: [...qk.decisions(ws), params],
    queryFn: () =>
      api.ws<Decision[] | { decisions: Decision[] }>(ws, `/decisions${qs({ ...params, status })}`).then((r) => listOf(r, 'decisions')),
  });
}

export function useAnswerDecision(): UseMutationResult<unknown, Error, { id: string; key?: string; text?: string; remember?: boolean; inputs?: DecisionAnswerInputs }> {
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
  return useQuery({ queryKey: qk.run(ws, id), queryFn: () => api.ws<unknown>(ws, `/runs/${id}`).then(runDetail), enabled: Boolean(id) });
}

export function useRunEvents(id: string, after = 0): UseQueryResult<RunEvent[]> {
  const ws = useWs();
  return useQuery({
    queryKey: [...qk.runEvents(ws, id), after],
    queryFn: () => api.ws<RunEvent[] | { events: RunEvent[] }>(ws, `/runs/${id}/events${qs({ after, limit: 500 })}`).then((r) => listOf(r, 'events')),
    enabled: Boolean(id),
  });
}

/**
 * What a set of turns did, without their transcripts (VS-74).
 *
 * `ids` are the runs the caller already knows it needs — the ones behind the messages on screen —
 * and `agent`/`since` adds that agent's other turns in the same window, which is the only way a
 * turn that produced no message is heard about at all. The ids are sorted into the key so that the
 * same set in a different order is the same query rather than a second fetch.
 */
export function useRunTraces({ ids, agent, since }: { ids: readonly string[]; agent?: string | null; since?: string | null }): UseQueryResult<RunTrace[]> {
  const ws = useWs();
  const params = useMemo(
    () => ({ ids: [...new Set(ids)].sort().join(','), agent: agent ?? undefined, since: since ?? undefined }),
    [ids, agent, since],
  );
  return useQuery({
    queryKey: qk.runTraces(ws, params),
    queryFn: () => api.ws<RunTrace[] | { traces: RunTrace[] }>(ws, `/runs/traces${qs(params)}`).then((r) => listOf(r, 'traces')),
    enabled: Boolean(params.ids || params.agent),
  });
}

/* ------------------------------------------------------- knowledge/specs */

export function useKnowledgeIndex(): UseQueryResult<T.KnowledgeIndex> {
  const ws = useWs();
  return useQuery({ queryKey: qk.knowledge(ws), queryFn: () => api.ws<unknown>(ws, '/knowledge').then((r) => (Array.isArray(r) ? { files: r as T.KnowledgeIndex['files'], warnings: [] } : (r as T.KnowledgeIndex))) });
}

export function useKnowledgeDocs(project?: string): UseQueryResult<T.KnowledgeDocSummary[]> {
  const ws = useWs();
  return useQuery({ queryKey: [...qk.knowledge(ws), 'docs', project ?? ''], queryFn: () => api.ws<unknown>(ws, `/knowledge/docs${qs({ project })}`).then((r) => listOf<T.KnowledgeDocSummary>(r)) });
}

export function useKnowledgeDocDetail(scope: string | null, slug: string | null, project?: string): UseQueryResult<T.KnowledgeDocDetail> {
  const ws = useWs();
  return useQuery({
    queryKey: [...qk.knowledge(ws), 'doc', scope ?? '', slug ?? '', project ?? ''],
    queryFn: () => api.ws<T.KnowledgeDocDetail>(ws, `/knowledge/docs/${encodeURIComponent(scope!)}/${encodeURIComponent(slug!)}${qs({ project })}`),
    enabled: Boolean(scope && slug),
  });
}

export function useKnowledgeGraph(project?: string): UseQueryResult<T.KnowledgeGraph> {
  const ws = useWs();
  return useQuery({ queryKey: [...qk.knowledge(ws), 'graph', project ?? ''], queryFn: () => api.ws<T.KnowledgeGraph>(ws, `/knowledge/graph${qs({ project })}`) });
}

/** The knowledge network's health (VS-102): nested under `qk.knowledge`, so a knowledge write already invalidates it. */
export function useKnowledgeHealth(project?: string): UseQueryResult<T.KnowledgeHealth> {
  const ws = useWs();
  return useQuery({ queryKey: [...qk.knowledge(ws), 'health', project ?? ''], queryFn: () => api.ws<T.KnowledgeHealth>(ws, `/knowledge/health${qs({ project })}`) });
}

export function useKnowledgeDocMutation(): UseMutationResult<unknown, Error, { scope: string; slug: string; project?: string; op: 'put' | 'delete'; body?: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ scope, slug, project, op, body }) =>
      api.ws(ws, `/knowledge/docs/${encodeURIComponent(scope)}/${encodeURIComponent(slug)}${qs({ project })}`, op === 'put' ? { method: 'PUT', body: { body } } : { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.knowledge(ws) }),
  });
}

export function useKnowledgeDoc(scope: string, project?: string): UseQueryResult<T.KnowledgeDoc> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.knowledgeScope(ws, scope, project),
    queryFn: () => api.ws<T.KnowledgeDoc>(ws, `/knowledge/${scope}${qs({ project })}`).then((d) => ({ ...d, scope: d.scope ?? scope })),
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
    queryFn: () => api.ws<unknown>(ws, `/search${qs({ q, project })}`).then((r) => listOf<T.SearchHit>(r, 'results')),
    enabled: q.trim().length > 1,
  });
}

export function useCapabilities(project: string): UseQueryResult<T.CapabilitySummary[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.specs(ws, project),
    queryFn: () => api.ws<T.CapabilitySummary[] | { capabilities: T.CapabilitySummary[] }>(ws, `/specs/${encodeURIComponent(project)}`).then((r) => listOf(r, 'capabilities')),
    enabled: Boolean(project),
  });
}

export function useCapability(project: string, capability: string): UseQueryResult<T.CapabilityDetail> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.capability(ws, project, capability),
    queryFn: () => api.ws<T.CapabilityDetail>(ws, `/specs/${encodeURIComponent(project)}/capabilities/${encodeURIComponent(capability)}`),
    enabled: Boolean(project && capability),
  });
}

export function useSpecChanges(project: string, state?: string): UseQueryResult<T.SpecChangeSummary[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.changes(ws, project, state),
    queryFn: () => api.ws<T.SpecChangeSummary[] | { changes: T.SpecChangeSummary[] }>(ws, `/specs/${encodeURIComponent(project)}/changes${qs({ state })}`).then((r) => listOf(r, 'changes')),
    enabled: Boolean(project),
  });
}

export function useSpecChange(project: string, name: string): UseQueryResult<T.SpecChangeDetail> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.change(ws, project, name),
    queryFn: () => api.ws<T.SpecChangeDetail>(ws, `/specs/${encodeURIComponent(project)}/changes/${encodeURIComponent(name)}`),
    enabled: Boolean(project && name),
  });
}

export function useSpecGraph(project: string): UseQueryResult<T.SpecGraph> {
  const ws = useWs();
  return useQuery({ queryKey: qk.specGraph(ws, project), queryFn: () => api.ws<T.SpecGraph>(ws, `/specs/${encodeURIComponent(project)}/graph`), enabled: Boolean(project) });
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
  return useQuery({ queryKey: qk.usage(ws, params), queryFn: () => api.ws<unknown>(ws, `/usage${qs(params)}`).then(usageSeries) });
}

export function useUsageTop(params: UsageParams & { by: 'model' | 'ticket' | 'role' | 'worker' | 'project' }): UseQueryResult<T.UsageTopRow[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.usageTop(ws, params),
    queryFn: () => api.ws<unknown>(ws, `/usage/top${qs(params)}`).then((r) => listOf<unknown>(r, 'rows').map(topRow)),
  });
}

export function useUsageModels(params: UsageParams): UseQueryResult<T.UsageModelRow[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.usageModels(ws, params),
    queryFn: () => api.ws<unknown>(ws, `/usage/models${qs(params)}`).then((r) => listOf<Record<string, unknown>>(r, 'models').map((m) => ({ ...topRow(m), model: String(m['model'] ?? m['key'] ?? ''), series: Array.isArray(m['series']) ? (m['series'] as Record<string, unknown>[]).map((p) => ({ ...totals(p), bucket: String(p['bucket'] ?? '') })) : undefined }))),
  });
}

/**
 * The daemon's own refresh interval for the account snapshots (`ACCOUNTS_EVERY_MS` in the
 * supervisor). A view that wants the numbers to stay live polls at the same cadence: refetching
 * faster only re-reads a row nothing has rewritten.
 */
export const ACCOUNTS_REFRESH_MS = 5 * 60_000;

/**
 * The current runtime account snapshots: billing mode and plan limits, refreshed daemon-side.
 * `refetchIntervalMs` is opt-in per caller — a screen that shows the numbers live asks for the
 * poll, and one that reads them once on load does not pay for it.
 */
export function useUsageAccounts(options?: { refetchIntervalMs?: number }): UseQueryResult<T.UsageAccount[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.usageAccounts(ws),
    queryFn: () => api.ws<unknown>(ws, '/usage/accounts').then((r) => listOf<T.UsageAccount>(r, 'accounts')),
    refetchInterval: options?.refetchIntervalMs ?? false,
  });
}

/**
 * Sync the account snapshots now (VS-84). The answer already carries every runtime it was asked
 * about, so it is written straight into the `usageAccounts` cache: both the usage page and the chat
 * header read that key, and neither has to refetch to show the numbers that just came back.
 *
 * `runtimeId` omitted syncs every runtime the workspace spends on, and only those runtimes are
 * replaced in the cache — a sync of one runtime must not drop the others' snapshots from the page.
 */
export function useSyncUsageAccounts(): UseMutationResult<T.UsageAccountSync, Error, { runtimeId?: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => api.ws<T.UsageAccountSync>(ws, '/usage/accounts/refresh', { method: 'POST', body: vars }),
    onSuccess: (out) => {
      qc.setQueryData<T.UsageAccount[]>(qk.usageAccounts(ws), (prev) => {
        const fresh = new Map(out.accounts.map((a) => [a.runtimeId, a]));
        const kept = (prev ?? []).map((a) => fresh.get(a.runtimeId) ?? a);
        const added = out.accounts.filter((a) => !(prev ?? []).some((p) => p.runtimeId === a.runtimeId));
        return [...kept, ...added];
      });
    },
  });
}

/** Each runtime's credential state: valid with an expiry, or an expired login and what to run. */
export function useUsageCredentials(): UseQueryResult<T.UsageCredential[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.usageCredentials(ws),
    queryFn: () => api.ws<unknown>(ws, '/usage/credentials').then((r) => listOf<T.UsageCredential>(r, 'credentials')),
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

/**
 * One page of thread history. Small enough that opening a long thread costs one short request and
 * one short render; the pages before it are fetched only when the human scrolls back to them.
 */
export const THREAD_PAGE_SIZE = 30;

/** A thread's history, newest page first on the wire and oldest message first in `data`. */
export interface ThreadHistory {
  data: T.ThreadMessage[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  /** True while the page before the loaded history is in flight. */
  isLoadingOlder: boolean;
  /** False once a short page has come back: that page began the thread. */
  hasOlder: boolean;
  loadOlder: () => void;
}

export function useThreadMessages(id: string | null): ThreadHistory {
  const ws = useWs();
  // `GET /threads/:id/messages` pages backwards on `created_at <` and answers oldest-first within a
  // page, so the cursor for the page before one already loaded is that page's first message.
  const q = useInfiniteQuery({
    queryKey: qk.threadMessages(ws, id ?? ''),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api
        .ws<T.ThreadMessage[] | T.ThreadMessagesPage>(ws, `/threads/${id}/messages${qs({ limit: THREAD_PAGE_SIZE, before: pageParam })}`)
        .then((r) => listOf<T.ThreadMessage>(r, 'messages')),
    getNextPageParam: (page) => (page.length < THREAD_PAGE_SIZE ? undefined : page[0]?.createdAt),
    enabled: Boolean(id),
  });
  // Invalidation (a sent message, a `thread.message` event) refetches the loaded pages in order,
  // recomputing each cursor from the page before it, so a message arriving at the bottom shifts the
  // window without tearing a hole in it.
  const data = useMemo(() => (q.data ? [...q.data.pages].reverse().flat() : undefined), [q.data]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = q;
  return {
    data,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void refetch(),
    isLoadingOlder: isFetchingNextPage,
    hasOlder: hasNextPage,
    loadOlder: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
  };
}

export function usePostThreadMessage(): UseMutationResult<unknown, Error, { threadId: string; body: string; projectId?: string | null; replyToMessageId?: string | null }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, body, projectId, replyToMessageId }) =>
      api.ws(ws, `/threads/${threadId}/messages`, { method: 'POST', body: { body, ...(projectId ? { projectId } : {}), ...(replyToMessageId ? { replyToMessageId } : {}) } }),
    onSettled: (_d, _e, v) => void qc.invalidateQueries({ queryKey: qk.threadMessages(ws, v.threadId) }),
  });
}

/* ---------------------------------------------------------- presentation */

export function usePresentation(): UseQueryResult<T.PresentationConfig> {
  const ws = useWs();
  return useQuery({ queryKey: qk.presentation(ws), queryFn: () => api.ws<T.PresentationConfig>(ws, '/presentation') });
}

export function usePresentationSurfaces(): UseQueryResult<T.PresentationSurfaces> {
  const ws = useWs();
  return useQuery({ queryKey: qk.presentationSurfaces(ws), queryFn: () => api.ws<T.PresentationSurfaces>(ws, '/presentation/surfaces') });
}

/** `PUT /presentation` replaces the stored config wholesale — always send the whole object. */
export function usePutPresentation(): UseMutationResult<T.PresentationConfig, Error, T.PresentationConfig> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.ws<T.PresentationConfig>(ws, '/presentation', { method: 'PUT', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.presentation(ws) }),
  });
}

// ---------------------------------------------------------------- changelog

const CHANGELOG_PAGE_SIZE = 50;

/** The reader's own timezone: what decides which day an entry falls under, here and in the heatmap. */
export function readerTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}

export interface ChangelogHistory {
  data: T.ChangelogEntry[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /** False once the daemon has answered with no cursor: everything older is loaded. */
  hasOlder: boolean;
  isLoadingOlder: boolean;
  loadOlder: () => void;
  /** Load pages until `date` (a `YYYY-MM-DD` in the reader's timezone) is covered, or history runs out. */
  loadUntil: (date: string) => Promise<void>;
}

/**
 * The changelog, newest first, a page at a time. `GET /changelog` answers newest-first already and
 * hands back the cursor for the page after it, so unlike the thread history no page needs reversing.
 */
export function useChangelog(project?: string): ChangelogHistory {
  const ws = useWs();
  const tz = readerTimezone();
  const q = useInfiniteQuery({
    queryKey: qk.changelog(ws, project),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.ws<T.ChangelogPage>(ws, `/changelog${qs({ project, limit: CHANGELOG_PAGE_SIZE, before: pageParam })}`),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  const data = useMemo(() => (q.data ? q.data.pages.flatMap((p) => p.entries) : undefined), [q.data]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;

  return {
    data,
    isLoading: q.isLoading,
    isError: q.isError,
    hasOlder: hasNextPage,
    isLoadingOlder: isFetchingNextPage,
    loadOlder: () => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage(); },
    // Jumping to a day the reader can see on the heatmap but has not scrolled to yet: page until the
    // oldest loaded entry is at or before it, so the timeline has a separator to scroll to.
    loadUntil: async (date: string) => {
      for (let guard = 0; guard < 40; guard += 1) {
        const loaded = q.data ? q.data.pages.flatMap((p) => p.entries) : [];
        const oldest = loaded[loaded.length - 1];
        if (oldest && dayKey(oldest.at, tz) <= date) return;
        if (!q.hasNextPage) return;
        const r = await fetchNextPage();
        if (!r.hasNextPage) return;
      }
    },
  };
}

/** How many of the newest entries a bounded reader takes: two weeks of landings, with room over. */
const CHANGELOG_RECENT_LIMIT = 100;

/**
 * A bounded page of the newest changelog entries, for a surface that shows a few rather than pages
 * of them (the project overview's Activity and Recent landings). Keyed under `changelogRoot`, so
 * the ticket events that write changelog rows refresh it (VS-95).
 */
export function useChangelogRecent(project?: string, limit = CHANGELOG_RECENT_LIMIT): UseQueryResult<T.ChangelogPage> {
  const ws = useWs();
  return useQuery({
    queryKey: [...qk.changelog(ws, project), 'recent', limit] as const,
    queryFn: () => api.ws<T.ChangelogPage>(ws, `/changelog${qs({ project, limit })}`),
  });
}

export function useChangelogHeatmap(project?: string): UseQueryResult<T.ChangelogHeatmap> {
  const ws = useWs();
  const tz = readerTimezone();
  return useQuery({
    queryKey: qk.changelogHeatmap(ws, project, tz),
    queryFn: () => api.ws<T.ChangelogHeatmap>(ws, `/changelog/heatmap${qs({ project, tz })}`),
  });
}
