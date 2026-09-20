import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type { RunEvent, RunTrace, RunSortDir, RunSortKey, TicketComment, Ticket, TicketStatus, Decision, DecisionAnswerInputs, Agent, Role, Run, Project, ProjectSyncState, UsageGrain, UsageWindow, Workspace, Incident, IncidentReporterKind, RoadmapItem, RoadmapBlock, Routine, RoutineFire, RoutineListItem, RoutineUsage, WorkerActivitySummary, Plan, PlanDraft, PlanOrigin, PlanSummary, ChannelThread } from '@weave-ai/shared';
import { dayKey } from '@weave-ai/render';
import { listOf, api, qs } from './client';
import { qk } from './keys';
import { useHookWs, useWs } from './context';
import type * as T from './types';
import { upgradePollInterval } from '../lib/upgrade';
import { moveProject } from '../lib/moveProject';
import { isClosedRefusal } from '../lib/decisionStaleness';

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
    thread: (r['thread'] as ChannelThread | null | undefined) ?? null,
    role: (r['role'] as Role | null | undefined) ?? null,
    project: (r['project'] as Project | null | undefined) ?? null,
    lastRun: (r['lastRun'] as Run | null | undefined) ?? null,
    usage: usage ? totals(usage['total'] ?? usage) : null,
    worktree: (r['worktree'] as T.WorkerDetail['worktree'] | undefined) ?? (agent.worktreePath ? { status: 'unknown', dirty: false, ahead: 0, behind: 0, path: agent.worktreePath } : null),
    scheduledWake: (r['scheduledWake'] as T.WorkerScheduledWake | undefined) ?? null,
    input: (r['input'] as T.WorkerDetail['input'] | undefined) ?? { midTurn: false },
    sessionResumable: Boolean(r['sessionResumable']),
    // VS-526: how many turns the current session has taken; 0 marks a fresh conversation.
    sessionTurns: typeof r['sessionTurns'] === 'number' ? r['sessionTurns'] : null,
    compacting: Boolean(r['compacting']),
    compactingError: (r['compactingError'] as string | null | undefined) ?? null,
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
    plugins: r['plugins'] as T.WorkspaceSummary['plugins'],
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
    attachments: listOf<T.TicketAttachment>(r['attachments'] ?? []),
    mergeQueue: {
      position: (((r['mergeQueue'] ?? {}) as Record<string, unknown>)['position'] as number | null | undefined) ?? null,
      concurrency: Number(((r['mergeQueue'] ?? {}) as Record<string, unknown>)['concurrency'] ?? 1),
    },
    plan: (r['plan'] as PlanOrigin | null | undefined) ?? null,
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

export function useRoutines(): UseQueryResult<RoutineListItem[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.routines(ws),
    queryFn: () => api.ws<{ items?: RoutineListItem[] } | RoutineListItem[]>(ws, '/routines').then((r) => listOf<RoutineListItem>(r, 'items')),
  });
}

/** Fan-out for the daemon-wide Scheduled page. Takes workspace ids; does not call `useWs()`. */
export function useRoutinesMany(ids: readonly string[]): UseQueryResult<RoutineListItem[]>[] {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.routines(id),
      queryFn: () => api.ws<{ items?: RoutineListItem[] } | RoutineListItem[]>(id, '/routines').then((r) => listOf<RoutineListItem>(r, 'items')),
    })),
  });
}

export function useRoutineUsage(id: string | null | undefined, window: RoutineUsage['window'] = '7d'): UseQueryResult<RoutineUsage> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.routineUsage(ws, id ?? '', window),
    queryFn: () => api.ws<RoutineUsage>(ws, `/routines/${id}/usage${qs({ window })}`),
    enabled: Boolean(id),
  });
}

/** Per-workspace usage; `ws` is an argument, not the route context. */
export function useRoutineUsageFor(ws: string, id: string | null | undefined, window: RoutineUsage['window'] = '7d'): UseQueryResult<RoutineUsage> {
  return useQuery({
    queryKey: qk.routineUsage(ws, id ?? '', window),
    queryFn: () => api.ws<RoutineUsage>(ws, `/routines/${id}/usage${qs({ window })}`),
    enabled: Boolean(ws && id),
  });
}

export function useRoutineFires(ws: string, id: string | null | undefined, enabled = true): UseQueryResult<RoutineFire[]> {
  return useQuery({
    queryKey: qk.routineFires(ws, id ?? ''),
    queryFn: () => api.ws<{ items?: RoutineFire[] } | RoutineFire[]>(ws, `/routines/${id}/fires`).then((r) => listOf<RoutineFire>(r, 'items')),
    enabled: Boolean(ws && id && enabled),
  });
}

type RoutineCreateBody = {
  name: string;
  trigger: { kind: 'schedule'; timezone?: string; daily?: { hour: number; minute: number }; everyMinutes?: number };
  instruction: string;
  action?: Routine['template']['action'];
  maxTicketsPerFire?: number;
  projectId?: string | null;
};

export function useCreateRoutine(): UseMutationResult<Routine, Error, RoutineCreateBody> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.ws<Routine>(ws, '/routines', { method: 'POST', body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.routines(ws) }); },
  });
}

export function useCreateRoutineAt(): UseMutationResult<Routine, Error, RoutineCreateBody & { ws: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ws, ...body }) => api.ws<Routine>(ws, '/routines', { method: 'POST', body }),
    onSuccess: (_row, { ws }) => { void qc.invalidateQueries({ queryKey: qk.routines(ws) }); },
  });
}

export function usePatchRoutine(): UseMutationResult<Routine, Error, { id: string; patch: Record<string, unknown> }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => api.ws<Routine>(ws, `/routines/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: (_row, { id }) => {
      void qc.invalidateQueries({ queryKey: qk.routines(ws) });
      void qc.invalidateQueries({ queryKey: qk.routine(ws, id) });
    },
  });
}

export function usePatchRoutineAt(): UseMutationResult<Routine, Error, { ws: string; id: string; patch: Record<string, unknown> }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ws, id, patch }) => api.ws<Routine>(ws, `/routines/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: (_row, { ws, id }) => {
      void qc.invalidateQueries({ queryKey: qk.routines(ws) });
      void qc.invalidateQueries({ queryKey: qk.routine(ws, id) });
      void qc.invalidateQueries({ queryKey: qk.routineFires(ws, id) });
    },
  });
}

export function useRemoveRoutine(): UseMutationResult<unknown, Error, { id: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.ws(ws, `/routines/${id}`, { method: 'DELETE' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.routines(ws) }); },
  });
}

export function useRemoveRoutineAt(): UseMutationResult<unknown, Error, { ws: string; id: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ws, id }) => api.ws(ws, `/routines/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, { ws }) => { void qc.invalidateQueries({ queryKey: qk.routines(ws) }); },
  });
}

export interface RoadmapPatchBody {
  title?: string;
  notes?: string;
  status?: RoadmapItem['status'];
  position?: number;
  ticketId?: string | null;
}

/** A project's roadmap items, in order. Disabled until a project is known. */
export function useRoadmap(projectId: string | null | undefined, wsOverride?: string): UseQueryResult<RoadmapItem[]> {
  const ws = useHookWs(wsOverride);
  return useQuery({
    queryKey: qk.roadmap(ws, projectId ?? ''),
    queryFn: () => api.ws<{ items?: RoadmapItem[] } | RoadmapItem[]>(ws, `/projects/${projectId}/roadmap`).then((r) => listOf<RoadmapItem>(r, 'items')),
    enabled: Boolean(projectId),
  });
}

/** A project's roadmap blocks, each with its pending tickets, in order (VS-478). */
export function useRoadmapBlocks(projectId: string | null | undefined, wsOverride?: string): UseQueryResult<RoadmapBlock[]> {
  const ws = useHookWs(wsOverride);
  return useQuery({
    queryKey: qk.roadmapBlocks(ws, projectId ?? ''),
    queryFn: () => api.ws<{ blocks?: RoadmapBlock[] } | RoadmapBlock[]>(ws, `/projects/${projectId}/roadmap/blocks`).then((r) => listOf<RoadmapBlock>(r, 'blocks')),
    enabled: Boolean(projectId),
  });
}

/**
 * The titles of every block across the given projects, merged into one `blockId → title` map
 * (VS-549). A chat thread spans projects, so the block marker on a sent message resolves from this
 * rather than a per-project hook. Each project is queried under the same `roadmapBlocks` key the
 * composer and the roadmap screens use, so the cache entry is shared and no extra request is made
 * for a project already loaded.
 */
export function useRoadmapBlockTitles(projectIds: readonly string[]): ReadonlyMap<string, string> {
  const ws = useHookWs();
  const results = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: qk.roadmapBlocks(ws, projectId),
      queryFn: () => api.ws<{ blocks?: RoadmapBlock[] } | RoadmapBlock[]>(ws, `/projects/${projectId}/roadmap/blocks`).then((r) => listOf<RoadmapBlock>(r, 'blocks')),
    })),
  });
  return useMemo(() => {
    const titles = new Map<string, string>();
    for (const r of results) for (const b of r.data ?? []) titles.set(b.id, b.title);
    return titles;
  }, [results]);
}

export function useCreateRoadmapItem(): UseMutationResult<RoadmapItem, Error, { projectId: string; title: string; notes?: string; status?: RoadmapItem['status']; ticketId?: string | null }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.ws<RoadmapItem>(ws, `/projects/${body.projectId}/roadmap`, { method: 'POST', body }),
    onSuccess: (_row, { projectId }) => {
      void qc.invalidateQueries({ queryKey: qk.roadmapRoot(ws) });
      void qc.invalidateQueries({ queryKey: qk.roadmap(ws, projectId) });
    },
  });
}

export function usePatchRoadmapItem(): UseMutationResult<RoadmapItem, Error, { projectId: string; itemId: string; patch: RoadmapPatchBody }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, itemId, patch }) => api.ws<RoadmapItem>(ws, `/projects/${projectId}/roadmap/${itemId}`, { method: 'PATCH', body: patch }),
    onSuccess: (_row, { projectId }) => {
      void qc.invalidateQueries({ queryKey: qk.roadmapRoot(ws) });
      void qc.invalidateQueries({ queryKey: qk.roadmap(ws, projectId) });
    },
  });
}

export function useRemoveRoadmapItem(): UseMutationResult<unknown, Error, { projectId: string; itemId: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, itemId }) => api.ws(ws, `/projects/${projectId}/roadmap/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_d, { projectId }) => {
      void qc.invalidateQueries({ queryKey: qk.roadmapRoot(ws) });
      void qc.invalidateQueries({ queryKey: qk.roadmap(ws, projectId) });
    },
  });
}

// ---------- plans (VS-398) ----------

export interface PlanDraftPatchBody {
  title?: string;
  /** VS-622: set the collapsed card's short summary; null or blank clears it back to the description fallback. */
  summary?: string | null;
  description?: string;
  kind?: PlanDraft['kind'];
  priority?: PlanDraft['priority'];
  targetRoleId?: string | null;
  suggestedTier?: PlanDraft['suggestedTier'];
  tierOverride?: PlanDraft['tierOverride'];
  blockedBy?: string[];
  position?: number;
}

/** A draft enriched (VS-517) with its dispatched ticket's live status and, once terminal, its report — present only once a draft has a `createdTicketId`. */
export type DispatchedPlanDraft = PlanDraft & { blockedBy: string[]; ticketStatus?: TicketStatus; report?: string | null };

/** A plan and its ordered drafts, each carrying `blockedBy`. Disabled until both ids are known (the modal calls `useStartOrResumePlan` first). */
export function usePlan(projectId: string | null | undefined, planId: string | null | undefined): UseQueryResult<{ plan: Plan; drafts: DispatchedPlanDraft[] }> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.plan(ws, planId ?? ''),
    queryFn: () => api.ws<{ plan: Plan; drafts: DispatchedPlanDraft[] }>(ws, `/projects/${projectId}/plans/${planId}`),
    enabled: Boolean(projectId) && Boolean(planId),
  });
}

/** Opens the Plan modal: resumes the project's `drafting` plan if one exists, else starts a fresh one (and its planner) immediately. The planner's `runtimeId` is returned so the modal can resolve its model's context window for the turn summary (VS-442). */
export function useStartOrResumePlan(): UseMutationResult<{ plan: Plan; agent: { id: string; status: string; runtimeId: string } }, Error, { projectId: string; title?: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, title }) => api.ws(ws, `/projects/${projectId}/plans/start`, { method: 'POST', body: title ? { title } : {} }),
    onSuccess: ({ plan }) => {
      void qc.invalidateQueries({ queryKey: qk.plan(ws, plan.id) });
      void qc.invalidateQueries({ queryKey: qk.plans(ws, plan.projectId) });
    },
  });
}

/** VS-477: a project's drafting plans as tab summaries (id, title, titleSource, status, draftCount), newest first. */
export function usePlans(projectId: string | null | undefined): UseQueryResult<{ plans: PlanSummary[] }> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.plans(ws, projectId ?? ''),
    queryFn: () => api.ws<{ plans: PlanSummary[] }>(ws, `/projects/${projectId}/plans?status=drafting`),
    enabled: Boolean(projectId),
  });
}

/**
 * VS-556: the weaver chat's workspace-wide plan tab strip. There is no workspace-wide plans
 * endpoint, so this fans one `usePlans`-shaped query out per project and flattens the results,
 * keeping each project's plans together. A project that is loading or failed contributes no tabs
 * rather than failing the strip.
 */
export function usePlansMany(projectIds: readonly string[]): { plans: PlanSummary[]; isLoading: boolean } {
  const ws = useWs();
  const results = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: qk.plans(ws, projectId),
      queryFn: () => api.ws<{ plans: PlanSummary[] }>(ws, `/projects/${projectId}/plans?status=drafting`),
      enabled: Boolean(projectId),
    })),
  });
  return {
    plans: results.flatMap((r) => r.data?.plans ?? []),
    isLoading: results.some((r) => r.isLoading),
  };
}

/**
 * VS-550: every ticket in the workspace created from a plan draft, keyed by ticket id — the plan it
 * came from and whether it was an early dispatch. One workspace read for the whole board; a ticket
 * with no plan is simply absent from the map.
 */
export function usePlanOrigins(): UseQueryResult<Map<string, PlanOrigin>> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.planOrigins(ws),
    queryFn: () => api.ws<{ origins: PlanOrigin[] }>(ws, '/plan-origins').then((r) => new Map(r.origins.map((o) => [o.ticketId, o]))),
  });
}

/** VS-622: a plan's own published artifacts — the source the `/w/:ws/plans/:planId/artifacts/:key` reader resolves a key against. */
export function usePlanArtifacts(planId: string | null | undefined): UseQueryResult<T.PlanArtifactSummary[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.planArtifacts(ws, planId ?? ''),
    queryFn: () => api.ws<unknown>(ws, `/plans/${planId}/artifacts`).then((r) => listOf<T.PlanArtifactSummary>(r)),
    enabled: Boolean(planId),
  });
}

export function usePlanArtifactRevisions(planId: string | null | undefined, key: string): UseQueryResult<T.DocumentRevision[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.planArtifactRevisions(ws, planId ?? '', key),
    queryFn: () => api.ws<Array<{ revision: number; authorKind: string; createdAt: string }>>(ws, `/plans/${planId}/artifacts/${key}/revisions`)
      .then((rows) => rows.map((r) => ({ ...r, reason: null }))),
    enabled: Boolean(planId) && Boolean(key),
  });
}

/** VS-477: create a fresh drafting plan (with its own thread and planner) alongside any the project already has; the modal focuses the new tab. */
export function useCreatePlan(): UseMutationResult<{ plan: Plan; agent: { id: string; status: string; runtimeId: string } }, Error, { projectId: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId }) => api.ws(ws, `/projects/${projectId}/plans`, { method: 'POST', body: {} }),
    onSuccess: ({ plan }) => {
      void qc.invalidateQueries({ queryKey: qk.plan(ws, plan.id) });
      void qc.invalidateQueries({ queryKey: qk.plans(ws, plan.projectId) });
    },
  });
}

/**
 * VS-477: focus a plan tab — ensure its planner is live (resuming it if it was retired) and sweep
 * the project's other planners that have gone idle. Returns the planner's `runtimeId` so the modal
 * can resolve its model's context window for the turn summary (VS-442).
 */
export function useActivatePlan(): UseMutationResult<{ plan: Plan; agent: { id: string; status: string; runtimeId: string } }, Error, { projectId: string; planId: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, planId }) => api.ws(ws, `/projects/${projectId}/plans/${planId}/activate`, { method: 'POST', body: {} }),
    onSuccess: (_d, { planId }) => { void qc.invalidateQueries({ queryKey: qk.plan(ws, planId) }); },
  });
}

/** VS-477: captain's rename of a plan tab; stored as human, so an auto-generated title never overwrites it. */
export function useRenamePlan(): UseMutationResult<Plan, Error, { projectId: string; planId: string; title: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, planId, title }) => api.ws<Plan>(ws, `/projects/${projectId}/plans/${planId}`, { method: 'PATCH', body: { title } }),
    onSuccess: (_d, { planId, projectId }) => {
      void qc.invalidateQueries({ queryKey: qk.plan(ws, planId) });
      void qc.invalidateQueries({ queryKey: qk.plans(ws, projectId) });
    },
  });
}

/** Captain's own direct edit of a draft — adding, removing and reordering drafts otherwise belong to the planner's own tools; this covers editing a field (including a tier override) and reordering via `position`. */
export function usePatchPlanDraft(): UseMutationResult<PlanDraft, Error, { projectId: string; planId: string; draftId: string; patch: PlanDraftPatchBody }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, planId, draftId, patch }) => api.ws<PlanDraft>(ws, `/projects/${projectId}/plans/${planId}/drafts/${draftId}`, { method: 'PATCH', body: patch }),
    onSuccess: (_d, { planId }) => { void qc.invalidateQueries({ queryKey: qk.plan(ws, planId) }); },
  });
}

export function useRemovePlanDraft(): UseMutationResult<unknown, Error, { projectId: string; planId: string; draftId: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, planId, draftId }) => api.ws(ws, `/projects/${projectId}/plans/${planId}/drafts/${draftId}`, { method: 'DELETE' }),
    onSuccess: (_d, { planId }) => { void qc.invalidateQueries({ queryKey: qk.plan(ws, planId) }); },
  });
}

/** VS-517: captain starts a scout draft running right now, before the plan is submitted — the only draft kind this ever applies to. */
export function useDispatchPlanDraft(): UseMutationResult<PlanDraft, Error, { projectId: string; planId: string; draftId: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, planId, draftId }) => api.ws<PlanDraft>(ws, `/projects/${projectId}/plans/${planId}/drafts/${draftId}/dispatch`, { method: 'POST' }),
    onSuccess: (_d, { planId }) => { void qc.invalidateQueries({ queryKey: qk.plan(ws, planId) }); },
  });
}

export function useSubmitPlan(): UseMutationResult<Plan, Error, { projectId: string; planId: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, planId }) => api.ws<Plan>(ws, `/projects/${projectId}/plans/${planId}/submit`, { method: 'POST' }),
    onSuccess: (_d, { planId, projectId }) => {
      void qc.invalidateQueries({ queryKey: qk.plan(ws, planId) });
      void qc.invalidateQueries({ queryKey: qk.plans(ws, projectId) });
    },
  });
}

export function useDiscardPlan(): UseMutationResult<Plan, Error, { projectId: string; planId: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, planId }) => api.ws<Plan>(ws, `/projects/${projectId}/plans/${planId}/discard`, { method: 'POST' }),
    onSuccess: (_d, { planId, projectId }) => {
      void qc.invalidateQueries({ queryKey: qk.plan(ws, planId) });
      void qc.invalidateQueries({ queryKey: qk.plans(ws, projectId) });
    },
  });
}

export function useIncidents(reporter?: IncidentReporterKind): UseQueryResult<{ items: Incident[]; total: number }> {
  return useQuery({
    queryKey: qk.incidents(reporter),
    queryFn: () => api.root<{ items: Incident[]; total: number }>(`/incidents${qs({ reporter })}`),
    refetchOnWindowFocus: true,
  });
}

export function useRuntimes(): UseQueryResult<T.RuntimeInfo[]> {
  return useQuery({ queryKey: qk.runtimes(), queryFn: () => api.root<T.RuntimeInfo[]>('/runtimes'), staleTime: 60_000 });
}

export function useRuntimeModels(runtimeId: string | null | undefined, workspace?: string): UseQueryResult<T.RuntimeModel[]> {
  return useQuery({
    queryKey: qk.runtimeModels(runtimeId ?? '', workspace),
    queryFn: () =>
      api.root<Array<string | T.RuntimeModel> | { models: Array<string | T.RuntimeModel> }>(`/runtimes/${runtimeId}/models${qs({ workspace })}`).then((r) => {
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

export function useTranscription(): UseQueryResult<T.TranscriptionStatus> {
  return useQuery({
    queryKey: qk.daemonTranscription(),
    queryFn: () => api.root<T.TranscriptionStatus>('/daemon/transcription'),
    retry: false,
    staleTime: 30_000,
  });
}

export function useDaemonModels(): UseQueryResult<T.DaemonModels> {
  return useQuery({
    queryKey: qk.daemonModels(),
    queryFn: () => api.root<T.DaemonModels>('/daemon/models'),
    retry: false,
  });
}

export function useSetDaemonModels(): UseMutationResult<T.DaemonModels, Error, Partial<T.DaemonModels>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.root<T.DaemonModels>('/daemon/models', { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(qk.daemonModels(), data);
      void qc.invalidateQueries({ queryKey: ['w'] });
    },
  });
}

export function useDaemonHostTools(): UseQueryResult<T.DaemonHostTools> {
  return useQuery({
    queryKey: qk.daemonHostTools(),
    queryFn: () => api.root<T.DaemonHostTools>('/daemon/host-tools'),
    retry: false,
  });
}

export function useSetDaemonHostTools(): UseMutationResult<T.DaemonHostTools, Error, { paths: string[] }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.root<T.DaemonHostTools>('/daemon/host-tools', { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(qk.daemonHostTools(), data);
      void qc.invalidateQueries({ queryKey: qk.health() });
    },
  });
}

export function useSetTranscription(): UseMutationResult<T.TranscriptionStatus, Error, { backend: 'chrome' | 'voxtype'; model?: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.root<T.TranscriptionStatus>('/daemon/transcription', { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(qk.daemonTranscription(), data);
      void qc.invalidateQueries({ queryKey: qk.health() });
    },
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

export function useWorkspaceSummary(wsOverride?: string): UseQueryResult<T.WorkspaceSummary> {
  const ws = useHookWs(wsOverride);
  return useQuery({ queryKey: qk.workspace(ws), queryFn: () => api.ws<unknown>(ws, '').then(summary), enabled: Boolean(ws) });
}

export function useBriefing(): UseQueryResult<T.Briefing> {
  const ws = useWs();
  return useQuery({ queryKey: qk.briefing(ws), queryFn: () => api.ws<T.Briefing>(ws, '/briefing') });
}

export function useProjects(wsOverride?: string): UseQueryResult<Project[]> {
  const ws = useHookWs(wsOverride);
  return useQuery({ queryKey: qk.projects(ws), queryFn: () => api.ws<Project[]>(ws, '/projects'), enabled: Boolean(ws) });
}

export interface WorkspaceProjectsState {
  status: 'pending' | 'error' | 'success';
  projects: Project[];
}

/**
 * A workspace's projects are fetched, and kept, only for the ids passed in — the active workspace
 * plus whichever groups the sidebar has expanded (VS-128). An id dropped from `ids` stops being
 * refetched but its cached result is not discarded, so re-adding it (re-expanding the group) is
 * instant.
 */
export function useWorkspaceProjects(ids: readonly string[]): Record<string, WorkspaceProjectsState> {
  const results = useQueries({
    // `staleTime: Infinity` is what "keep them" means here: TanStack Query refetches an inactive
    // query as soon as it gains an observer again unless told the data is still fresh, and a
    // collapsed-then-re-expanded group re-adds its id to `ids`, which is exactly that.
    queries: ids.map((id) => ({ queryKey: qk.projects(id), queryFn: () => api.ws<Project[]>(id, '/projects'), staleTime: Infinity })),
  });
  return useMemo(() => {
    const map: Record<string, WorkspaceProjectsState> = {};
    ids.forEach((id, i) => {
      const r = results[i];
      map[id] = { status: r?.isError ? 'error' : r?.isSuccess ? 'success' : 'pending', projects: r?.data ?? [] };
    });
    return map;
  }, [ids, results]);
}

/**
 * Every listed workspace's own loaded plugins with a page (VS-385), for the V2 rail's data-driven
 * plugin section — mirroring `useWorkspaceProjects`'s shape exactly. Shares the same query key and
 * fetch as `useWorkspaceSummary()` (the plugin list is part of that same response), so a workspace
 * already summarized elsewhere costs nothing extra here.
 */
export function useWorkspacePlugins(ids: readonly string[]): Record<string, T.WorkspacePlugin[]> {
  const results = useQueries({
    queries: ids.map((id) => ({ queryKey: qk.workspace(id), queryFn: () => api.ws<unknown>(id, '').then(summary), staleTime: Infinity })),
  });
  return useMemo(() => {
    const map: Record<string, T.WorkspacePlugin[]> = {};
    ids.forEach((id, i) => {
      const plugins = results[i]?.data?.plugins ?? [];
      map[id] = plugins.filter((p) => p.loaded && p.hasPage);
    });
    return map;
  }, [ids, results]);
}

export function useAddProject(): UseMutationResult<Project, Error, { url: string; id?: string; runtime?: string; maxWorkers?: number; setupCommand?: string; policies?: { autoMergeDefault?: boolean; visualPlanArtifact?: boolean }; knowledgeRepo?: { enabled: boolean }; openspec?: { enabled: boolean } }> {
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
    // A project PATCH replaces `policies` wholesale, so two edits made before a refetch lands would
    // both be computed from the same stale row and the second would drop the first (VS-303). Advance
    // the cached row on success, and roll it back on error so a rejected edit does not linger.
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.projects(ws) });
      const prev = qc.getQueryData<Project[]>(qk.projects(ws));
      if (prev) qc.setQueryData(qk.projects(ws), prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(qk.projects(ws), ctx.prev); },
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.projects(ws) }),
  });
}

export function useRemoveProject(): UseMutationResult<unknown, Error, { id: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.ws(ws, `/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.projects(ws) }),
  });
}

/**
 * Add the project on `destWs` (existing POST, 202) then archive it here. Does not wait for the
 * dest clone. Slug clash and dest-add failure leave the source untouched.
 */
export function useMoveProject(): UseMutationResult<void, Error, { destWs: string; project: Project }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ destWs, project }) => moveProject({
      project,
      listDestProjects: () => api.ws<Project[]>(destWs, '/projects'),
      addToDest: (body) => api.ws(destWs, '/projects', { method: 'POST', body }),
      archiveSource: () => api.ws(ws, `/projects/${project.id}`, { method: 'DELETE' }),
    }),
    onSuccess: (_void, { destWs }) => {
      void qc.invalidateQueries({ queryKey: qk.projects(ws) });
      void qc.invalidateQueries({ queryKey: qk.projects(destWs) });
    },
  });
}

export interface ProjectSync { syncState: ProjectSyncState; behindBy: number | null }

/**
 * How a project's clone compares to its remote (VS-131). `staleTime: 60_000` is the one place this
 * check is throttled: opening the overview re-renders freely within that window without triggering
 * another `git fetch` — see design.md's cost accounting.
 */
export function useProjectSync(id: string): UseQueryResult<ProjectSync> {
  const ws = useWs();
  return useQuery({ queryKey: qk.projectSync(ws, id), queryFn: () => api.ws<ProjectSync>(ws, `/projects/${id}/sync`), staleTime: 60_000 });
}

/** Land-then-promote (VS-568, VS-584): what a project's landing branch would promote, and how. */
export interface ProjectPromotion {
  applicable: boolean; landing: string; defaultBranch: string; ahead: number; behind: number;
  /** VS-584: the honest content — the tree diff `default...landing`. Empty when already shipped. */
  changedFiles: number; additions: number; deletions: number;
  /** VS-584: the strategy resolved from policy and forge, and the promotion in flight (if any). */
  strategy: 'pull-request' | 'direct-push';
  promotion: {
    state: 'open' | 'pending' | 'held' | 'merged'; prUrl: string | null; mergeMethod: string | null;
    heldReason: string | null; updatedAt: string;
  } | null;
  tickets: Array<{ id: string; identifier: string; title: string }>;
  canPromote: boolean; heldReason: string | null; notes: string[];
}

export function useProjectPromotion(id: string): UseQueryResult<ProjectPromotion> {
  const ws = useWs();
  return useQuery({ queryKey: qk.projectPromotion(ws, id), queryFn: () => api.ws<ProjectPromotion>(ws, `/projects/${id}/promotion`), staleTime: 60_000 });
}

/** Raises the project's promotion approval for the human; the daemon pushes only after it is answered. */
export function useRequestPromotion(id: string): UseMutationResult<Decision, Error, void> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.ws<Decision>(ws, `/projects/${id}/promotion`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projectPromotion(ws, id) });
      void qc.invalidateQueries({ queryKey: ['w', ws, 'decisions'] });
    },
  });
}

/** The existing fetch-and-fast-forward (VS-131), now with a UI entry point: resolves `behind`, reports rather than resolving `diverged`. */
export function useProjectFetch(id: string): UseMutationResult<{ head: string; fastForwarded: boolean }, Error, void> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.ws<{ head: string; fastForwarded: boolean }>(ws, `/projects/${id}/fetch`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projectSync(ws, id) });
      void qc.invalidateQueries({ queryKey: qk.projects(ws) });
    },
  });
}

export interface RepoInfo { private: boolean }

/**
 * VS-359: ask the forge whether a repository is public before enabling the knowledge-repo opt-in.
 * One identifier at a time — a project id for an existing row, or a git URL for the creation form.
 * `null` means the forge could not say; the caller shows no warning and proceeds.
 */
export function useRepoInfo(): UseMutationResult<RepoInfo | null, Error, { id?: string; url?: string }> {
  const ws = useWs();
  return useMutation({
    mutationFn: ({ id, url }) => url
      ? api.ws<RepoInfo | null>(ws, `/projects/repo-info?url=${encodeURIComponent(url)}`)
      : api.ws<RepoInfo | null>(ws, `/projects/${id}/repo-info`),
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

export function useRoles(project?: string, wsOverride?: string): UseQueryResult<Role[]> {
  const ws = useHookWs(wsOverride);
  return useQuery({ queryKey: [...qk.roles(ws), project ?? ''], queryFn: () => api.ws<Role[]>(ws, `/roles${qs({ project })}`), enabled: Boolean(ws) });
}

export function useRolesMany(ids: readonly string[]): UseQueryResult<Role[]>[] {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: [...qk.roles(id), ''],
      queryFn: () => api.ws<Role[]>(id, '/roles'),
    })),
  });
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
      void qc.invalidateQueries({ queryKey: qk.roles(ws) });   // the Roles list renders maxWorkers too
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

/** `GET /workers` marks which ticket is an interactive session (VS-101), carries the worker's own
 *  pending scheduled wakeup (VS-317), and the live activity summary (VS-328) — all joined
 *  server-side, none part of `Agent` itself. VS-554 adds the active session's last completed turn
 *  context size. */
export type WorkerListItem = Agent & {
  interactiveSession: boolean;
  scheduledWake: T.WorkerScheduledWake | null;
  activity?: WorkerActivitySummary['activity'];
  tests?: WorkerActivitySummary['tests'];
  lastContextTokens?: number | null;
};

export function useWorkers(params: { status?: string; kind?: string; project?: string; role?: string; includeRetired?: boolean } = {}, wsOverride?: string): UseQueryResult<WorkerListItem[]> {
  const ws = useHookWs(wsOverride);
  return useQuery({ queryKey: [...qk.workers(ws), params], queryFn: () => api.ws<WorkerListItem[]>(ws, `/workers${qs(params)}`), enabled: Boolean(ws) });
}

/**
 * VS-525: a project's (or the whole workspace's) persistent-session agents, so a role's chat can
 * show whether its conversation already exists before it is opened. Reads the same list route with
 * `kind=session`; the default worker list is untouched.
 */
export function useSessions(project?: string, wsOverride?: string): UseQueryResult<WorkerListItem[]> {
  return useWorkers({ kind: 'session', ...(project ? { project } : {}) }, wsOverride);
}

export function useWorkersMany(
  ids: readonly string[],
  params: { status?: string; kind?: string; project?: string; role?: string; includeRetired?: boolean } = {},
): UseQueryResult<WorkerListItem[]>[] {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: [...qk.workers(id), params],
      queryFn: () => api.ws<WorkerListItem[]>(id, `/workers${qs(params)}`),
    })),
  });
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

/**
 * The resume command a worker would offer right now, without taking it (VS-249): read-only, so it
 * can be polled from the worker page or a decision card without committing to a hold.
 */
export function useHandoverCommand(id: string, enabled = true): UseQueryResult<T.HandoverCommandResult> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.workerHandoverCommand(ws, id),
    queryFn: () => api.ws<T.HandoverCommandResult>(ws, `/workers/${id}/handover-command`),
    enabled: Boolean(id) && enabled,
  });
}

/** Take a worker's session for a human's own terminal (VS-249). */
export function useStartHandover(): UseMutationResult<T.HandoverCommandResult, Error, { id: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.ws<T.HandoverCommandResult>(ws, `/workers/${id}/handover`, { method: 'POST' }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: qk.worker(ws, v.id) });
      void qc.invalidateQueries({ queryKey: qk.workers(ws) });
    },
  });
}

/** Give a held session back (VS-249); requires a note describing what happened. */
export function useEndHandover(): UseMutationResult<T.HandoverEndResult, Error, { id: string; note: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }) => api.ws<T.HandoverEndResult>(ws, `/workers/${id}/handback`, { method: 'POST', body: { note } }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: qk.worker(ws, v.id) });
      void qc.invalidateQueries({ queryKey: qk.workers(ws) });
    },
  });
}

/**
 * Explicit-workspace variants of the two above (VS-249), for a surface that is not itself scoped to
 * one workspace — a decision card raised for a worker, shown from a cross-workspace view like Needs
 * you, carries its own `ws` as a prop rather than reading the route's active workspace.
 */
export function useHandoverCommandFor(ws: string, id: string, enabled = true): UseQueryResult<T.HandoverCommandResult> {
  return useQuery({
    queryKey: qk.workerHandoverCommand(ws, id),
    queryFn: () => api.ws<T.HandoverCommandResult>(ws, `/workers/${id}/handover-command`),
    enabled: Boolean(ws) && Boolean(id) && enabled,
  });
}
export function useStartHandoverFor(): UseMutationResult<T.HandoverCommandResult, Error, { ws: string; id: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ws, id }) => api.ws<T.HandoverCommandResult>(ws, `/workers/${id}/handover`, { method: 'POST' }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: qk.worker(v.ws, v.id) });
      void qc.invalidateQueries({ queryKey: qk.workers(v.ws) });
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

/**
 * VS-495: a role's persistent, no-ticket session — idempotent, returns the role's existing live
 * session and its thread if it already has one rather than creating a second. VS-526: `workerModelId`
 * is the catalog option the session runs on; omit it for the workspace's workers setting.
 *
 * VS-581: `wsOverride` names the session's own workspace. The V2 shell's rail sits above the
 * workspace provider and spans every workspace, so a role row under a non-current workspace must
 * pass it; a surface inside a provider omits it.
 *
 * VS-617: `options.onOpened` runs from the mutation's own `onSuccess`, which fires whether or not
 * the calling component is still mounted. A caller that must navigate to the session has to use it
 * (or `mutateAsync`) rather than a per-call callback passed to `mutate`, because TanStack drops
 * those once the observer unmounts — which is what the phone More sheet does to a role row.
 */
export function usePersistentSession(
  wsOverride?: string,
  options?: { onOpened?: (agent: Agent) => void },
): UseMutationResult<{ agent: Agent; thread: ChannelThread }, Error, { projectId: string; roleId: string; workerModelId?: string | null }> {
  const ws = useHookWs(wsOverride);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.ws<{ agent: Agent; thread: ChannelThread }>(ws, '/workers/persistent-session', { method: 'POST', body }),
    onSuccess: ({ agent }) => {
      void qc.invalidateQueries({ queryKey: qk.workers(ws) });
      options?.onOpened?.(agent);
    },
  });
}

/**
 * VS-526: change (or clear) the worker option a persistent session runs on. The caller must have
 * shown the human what the change does to the conversation first — a change that moves the session
 * to a different runtime retires it and starts a fresh conversation on the next turn.
 */
export function useSetSessionOption(id: string): UseMutationResult<Agent, Error, { workerModelId: string | null }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.ws<Agent>(ws, `/workers/${id}/session-option`, { method: 'POST', body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.worker(ws, id) }); void qc.invalidateQueries({ queryKey: qk.workers(ws) }); },
  });
}

/**
 * VS-495: start an out-of-band compaction of any agent's session by id — `useCompactWeaver` calls
 * the weaver's own dedicated route; this is the same underlying service (`compactSession`, already
 * generic over any agent) for every other kind, worker or persistent session alike.
 */
export function useCompactWorker(id: string): UseMutationResult<{ started: boolean; runtime: string }, Error, void> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.ws<{ started: boolean; runtime: string }>(ws, `/workers/${id}/compact`, { method: 'POST' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.worker(ws, id) }); },
  });
}

export function useWeaver(wsOverride?: string): UseQueryResult<T.WorkerDetail> {
  const ws = useHookWs(wsOverride);
  return useQuery({ queryKey: qk.weaver(ws), queryFn: () => api.ws<unknown>(ws, '/weaver').then(workerDetail), enabled: Boolean(ws) });
}

/** Start an out-of-band compaction of the weaver's session; the `session.compaction` frame reports it finishing. */
export function useCompactWeaver(): UseMutationResult<{ started: boolean; runtime: string }, Error, void> {
  const ws = useHookWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.ws<{ started: boolean; runtime: string }>(ws, '/weaver/compact', { method: 'POST' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.weaver(ws) }); },
  });
}

export function useWeaverMany(ids: readonly string[]): UseQueryResult<T.WorkerDetail>[] {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.weaver(id),
      queryFn: () => api.ws<unknown>(id, '/weaver').then(workerDetail),
    })),
  });
}

/** The workspace's two model settings: the whole of model selection (VS-77). */
export function useModels(): UseQueryResult<T.WorkspaceModels> {
  const ws = useWs();
  return useQuery({ queryKey: qk.models(ws), queryFn: () => api.ws<T.WorkspaceModels>(ws, '/models') });
}

/**
 * `useModels` where a workspace may not be in context at all — the daemon settings page is reached
 * without one (VS-230). Without a workspace the query is disabled and answers no data, so a caller
 * seeding a daemon overlay from "this workspace's" setting falls back to its runtime default
 * instead of throwing.
 */
export function useModelsOptional(): UseQueryResult<T.WorkspaceModels | undefined> {
  const ws = useHookWs();
  return useQuery({ queryKey: qk.models(ws), queryFn: () => api.ws<T.WorkspaceModels>(ws, '/models'), enabled: ws !== '' });
}

/** `useModels` for several workspaces at once (VS-217); the shared query key dedupes the two. */
export function useModelsMany(ids: readonly string[]): UseQueryResult<T.WorkspaceModels>[] {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.models(id),
      queryFn: () => api.ws<T.WorkspaceModels>(id, '/models'),
    })),
  });
}

/**
 * `PUT /models` changes only the controls the body names (VS-356): a value overrides, `null` clears
 * back to inherit, omission keeps. The response is the sourced view, cached in place of the read.
 */
export function useSetModels(): UseMutationResult<T.WorkspaceModels, Error, T.WorkspaceModelsPut> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.ws<T.WorkspaceModels>(ws, '/models', { method: 'PUT', body }),
    onSuccess: (next) => {
      qc.setQueryData(qk.models(ws), next);
      void qc.invalidateQueries({ queryKey: qk.weaver(ws) });
    },
  });
}

/* ------------------------------------------------------- providers (VS-610) */

/** This workspace's `weave`-runtime providers, with their secret state, plus the preset catalogue. */
export function useProviders(): UseQueryResult<T.ProvidersPayload> {
  const ws = useWs();
  return useQuery({ queryKey: qk.providers(ws), queryFn: () => api.ws<T.ProvidersPayload>(ws, '/providers') });
}

/** Create or replace a provider profile; the body is the profile, `id` names the config key. */
export function useSaveProvider(): UseMutationResult<T.ProviderView, Error, { id: string; profile: T.ProviderProfile }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, profile }) => api.ws<T.ProviderView>(ws, `/providers/${encodeURIComponent(id)}`, { method: 'PUT', body: profile }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.providers(ws) }),
  });
}

export function useDeleteProvider(): UseMutationResult<{ ok: boolean }, Error, string> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.ws<{ ok: boolean }>(ws, `/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.providers(ws) }),
  });
}

/** Set or replace the provider's key; only a status comes back, never the value. */
export function useSetProviderSecret(): UseMutationResult<{ ok: boolean; configured: boolean; secretName: string }, Error, { id: string; value: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }) => api.ws<{ ok: boolean; configured: boolean; secretName: string }>(ws, `/providers/${encodeURIComponent(id)}/secret`, { method: 'POST', body: { value } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.providers(ws) }),
  });
}

export function useClearProviderSecret(): UseMutationResult<{ ok: boolean; configured: boolean; secretName: string | null }, Error, string> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.ws<{ ok: boolean; configured: boolean; secretName: string | null }>(ws, `/providers/${encodeURIComponent(id)}/secret`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.providers(ws) }),
  });
}

/** Run the on-demand probe; the request itself is the side effect, so nothing is cached. */
export function useTestProvider(): UseMutationResult<T.ProviderTestReport, Error, { id: string; model?: string }> {
  const ws = useWs();
  return useMutation({
    mutationFn: ({ id, model }) => api.ws<T.ProviderTestReport>(ws, `/providers/${encodeURIComponent(id)}/test`, { method: 'POST', body: model ? { model } : {} }),
  });
}

/* ------------------------------------------------------ MCP servers (VS-621) */

/** This workspace's MCP servers, each with the names it references and whether those are set. */
export function useMcpServers(): UseQueryResult<T.McpServersPayload> {
  const ws = useWs();
  return useQuery({ queryKey: qk.mcpServers(ws), queryFn: () => api.ws<T.McpServersPayload>(ws, '/mcp') });
}

/** Create or replace an MCP server definition; the body is the definition, `name` is the config key. */
export function useSaveMcpServer(): UseMutationResult<T.McpServerView, Error, { name: string; config: Omit<T.McpServer, 'headers' | 'args' | 'env' | 'listTimeoutMs' | 'callTimeoutMs' | 'readOnly'> & Partial<T.McpServer> }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, config }) => api.ws<T.McpServerView>(ws, `/mcp/${encodeURIComponent(name)}`, { method: 'PUT', body: config }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.mcpServers(ws) }),
  });
}

export function useDeleteMcpServer(): UseMutationResult<{ ok: boolean }, Error, string> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name) => api.ws<{ ok: boolean }>(ws, `/mcp/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.mcpServers(ws) }),
  });
}

/** Connect to a saved server and list its tools; the request is the side effect, so nothing is cached. */
export function useTestMcpServer(): UseMutationResult<T.McpTestReport, Error, string> {
  const ws = useWs();
  return useMutation({ mutationFn: (name) => api.ws<T.McpTestReport>(ws, `/mcp/${encodeURIComponent(name)}/test`, { method: 'POST' }) });
}

/** Set or replace a secret a server references; only a status comes back, never the value. */
export function useSetMcpSecret(): UseMutationResult<{ ok: boolean; name: string; configured: boolean }, Error, { name: string; value: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, value }) => api.ws<{ ok: boolean; name: string; configured: boolean }>(ws, `/mcp/secrets/${encodeURIComponent(name)}`, { method: 'POST', body: { value } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.mcpServers(ws) }),
  });
}

export function useClearMcpSecret(): UseMutationResult<{ ok: boolean; name: string; configured: boolean }, Error, string> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name) => api.ws<{ ok: boolean; name: string; configured: boolean }>(ws, `/mcp/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.mcpServers(ws) }),
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
  /** `label` omits `description` so chat dispatch labels stay a small JSON payload (VS-227). */
  fields?: 'label';
}

export function useTickets(params: TicketQuery = {}, opts: { enabled?: boolean; ws?: string } = {}): UseQueryResult<Ticket[]> {
  const ws = useHookWs(opts.ws);
  return useQuery({
    queryKey: [...qk.tickets(ws), params],
    queryFn: () => api.ws<Ticket[] | { tickets: Ticket[] }>(ws, `/tickets${qs(params)}`).then((r) => listOf(r, 'tickets')),
    enabled: (opts.enabled ?? true) && Boolean(ws),
  });
}

export function useTicketsMany(ids: readonly string[], params: TicketQuery = {}): UseQueryResult<Ticket[]>[] {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: [...qk.tickets(id), params],
      queryFn: () => api.ws<Ticket[] | { tickets: Ticket[] }>(id, `/tickets${qs(params)}`).then((r) => listOf(r, 'tickets')),
    })),
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

/**
 * One ticket's detail from an explicit workspace, for a V2 card that may render outside a workspace
 * route (global Needs you). Mirrors `useTicketWorkProducts`'s ws override and skips `useTicket`'s
 * project/role lookups, which the card does not use.
 */
export function useTicketFor(ws: string | undefined, id: string, enabled = true): UseQueryResult<T.TicketDetail> {
  const w = useHookWs(ws);
  return useQuery({
    queryKey: qk.ticket(w, id),
    queryFn: () => api.ws<unknown>(w, `/tickets/${id}`).then(ticketDetail),
    enabled: enabled && Boolean(id) && Boolean(w),
  });
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

/** A pull request's changed-file manifest (VS-107) — the cheap read a file tree opens from, no hunks. */
export function usePullRequestDiffFiles(projectId: string | null | undefined, number: number | null): UseQueryResult<T.PullRequestDiffFilesResult> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.pullRequestDiffFiles(ws, projectId ?? '', number ?? 0),
    queryFn: () => api.ws<T.PullRequestDiffFilesResult>(ws, `/projects/${encodeURIComponent(projectId ?? '')}/pull-requests/${number ?? 0}/diff`),
    enabled: Boolean(projectId) && number !== null,
  });
}

/** One file's hunks — requested only once that file is opened, the client-side half of per-file loading. */
export function usePullRequestDiffFile(projectId: string | null | undefined, number: number | null, path: string | null): UseQueryResult<T.PullRequestDiffFileResult> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.pullRequestDiffFile(ws, projectId ?? '', number ?? 0, path ?? ''),
    queryFn: () => api.ws<T.PullRequestDiffFileResult>(ws, `/projects/${encodeURIComponent(projectId ?? '')}/pull-requests/${number ?? 0}/diff/file?path=${encodeURIComponent(path ?? '')}`),
    enabled: Boolean(projectId) && number !== null && path !== null,
  });
}

/** A collapsed region's content, read on demand when the reader expands it. */
export function usePullRequestDiffContext(
  projectId: string | null | undefined, number: number | null, path: string | null, range: { start: number; end: number } | null,
): UseQueryResult<T.PullRequestDiffContextResult> {
  const ws = useWs();
  return useQuery({
    queryKey: [...qk.pullRequestDiffFile(ws, projectId ?? '', number ?? 0, path ?? ''), 'context', range?.start ?? 0, range?.end ?? 0] as const,
    queryFn: () => api.ws<T.PullRequestDiffContextResult>(
      ws, `/projects/${encodeURIComponent(projectId ?? '')}/pull-requests/${number ?? 0}/diff/file/context?path=${encodeURIComponent(path ?? '')}&start=${range?.start ?? 0}&end=${range?.end ?? 0}`,
    ),
    enabled: Boolean(projectId) && number !== null && path !== null && range !== null,
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
  const ws = useHookWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, to, note }) => {
      if (!ws) return Promise.reject(new Error('no workspace'));
      return api.ws<Ticket>(ws, `/tickets/${id}/transition`, { method: 'POST', body: { to, note } });
    },
    onSuccess: (_d, v) => {
      if (!ws) return;
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

/** Cancel a ticket (VS-346): the V2 ticket header's action. Existing endpoint, previously CLI-only. */
export function useCancelTicket(): UseMutationResult<Ticket, Error, { id: string; reason: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) => api.ws<Ticket>(ws, `/tickets/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: qk.ticket(ws, v.id) }); void qc.invalidateQueries({ queryKey: qk.tickets(ws) }); },
  });
}

/** Discard a ticket's unlanded work (VS-346). The daemon gates it on a discard approval: 202 with
 * `discarded: false` and a `decisionId` when one had to be raised, `discarded: true` once approved. */
export function useDiscardTicket(): UseMutationResult<T.DiscardResult, Error, { id: string; reason?: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) => api.ws<T.DiscardResult>(ws, `/tickets/${id}/discard`, { method: 'POST', body: { force: true, ...(reason ? { reason } : {}) } }),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: qk.ticket(ws, v.id) }); void qc.invalidateQueries({ queryKey: qk.tickets(ws) }); },
  });
}

/** Reassign a ticket to a role (VS-346). */
export function useAssignTicket(): UseMutationResult<Ticket, Error, { id: string; roleId: string; workerModelId?: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, roleId, workerModelId }) => api.ws<Ticket>(ws, `/tickets/${id}/assign`, { method: 'POST', body: workerModelId ? { roleId, workerModelId } : { roleId } }),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: qk.ticket(ws, v.id) }); void qc.invalidateQueries({ queryKey: qk.tickets(ws) }); },
  });
}

/** Replace a ticket's blockers (VS-346): `blockedBy` is the full list of ticket ids. */
export function useSetTicketBlockers(): UseMutationResult<Ticket, Error, { id: string; blockedBy: string[] }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, blockedBy }) => api.ws<Ticket>(ws, `/tickets/${id}/blockers`, { method: 'PUT', body: { blockedBy } }),
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

export function useTicketDocument(id: string, key: string, revision?: number, wsOverride?: string): UseQueryResult<T.TicketDocument> {
  const ws = useHookWs(wsOverride);
  return useQuery({
    queryKey: [...qk.ticketDocument(ws, id, key), revision ?? 'head'],
    queryFn: () => api.ws<T.TicketDocument>(ws, `/tickets/${id}/documents/${key}${qs({ revision })}`),
    enabled: Boolean(id && key),
  });
}

/** One of a ticket's documents by its id (VS-224) — how a decision's document target is followed. */
export function useTicketDocumentById(id: string, documentId: string, revision?: number, wsOverride?: string): UseQueryResult<T.TicketDocumentById> {
  const ws = useHookWs(wsOverride);
  return useQuery({
    queryKey: [...qk.ticketDocumentById(ws, id, documentId), revision ?? 'head'],
    queryFn: () => api.ws<T.TicketDocumentById>(ws, `/tickets/${id}/documents/by-id/${documentId}${qs({ revision })}`),
    enabled: Boolean(id && documentId),
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

export function useTicketWorkProducts(id: string, wsOverride?: string): UseQueryResult<T.WorkProduct[]> {
  // VS-345: a V2 decision card may render outside a workspace route (global Needs you), so it names
  // the ticket's workspace explicitly; V1 callers pass none and keep using the provider's.
  const ws = useHookWs(wsOverride);
  return useQuery({
    queryKey: qk.ticketWorkProducts(ws, id),
    queryFn: () => api.ws<T.WorkProduct[] | { workProducts: T.WorkProduct[] }>(ws, `/tickets/${id}/work-products`).then((r) => listOf(r, 'workProducts')),
    enabled: Boolean(id) && Boolean(ws),
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

/** A ticket's knowledge context (VS-110): hub tokens plus distinct documents, summed over its own runs and its subtree. */
export function useTicketKnowledgeUsage(id: string): UseQueryResult<T.KnowledgeContextUsage> {
  const ws = useWs();
  return useQuery({ queryKey: qk.ticketKnowledgeUsage(ws, id), queryFn: () => api.ws<T.KnowledgeContextUsage>(ws, `/tickets/${id}/knowledge-usage`), enabled: Boolean(id) });
}

/* ------------------------------------------------------------- decisions */

export function useDecisions(
  params: { status?: string | string[]; owner?: string; limit?: number } = { status: 'open', owner: 'human' },
  wsOverride?: string,
): UseQueryResult<Decision[]> {
  const ws = useHookWs(wsOverride);
  // The route reads `status` as a comma-separated list, so several statuses cost no route work.
  const status = Array.isArray(params.status) ? params.status.join(',') : params.status;
  return useQuery({
    queryKey: [...qk.decisions(ws), params],
    queryFn: () =>
      api.ws<Decision[] | { decisions: Decision[] }>(ws, `/decisions${qs({ ...params, status })}`).then((r) => listOf(r, 'decisions')),
    enabled: Boolean(ws),
  });
}

export function useDecisionsMany(
  ids: readonly string[],
  params: { status?: string | string[]; owner?: string; limit?: number } = { status: 'open', owner: 'human' },
): UseQueryResult<Decision[]>[] {
  const status = Array.isArray(params.status) ? params.status.join(',') : params.status;
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: [...qk.decisions(id), params],
      queryFn: () =>
        api.ws<Decision[] | { decisions: Decision[] }>(id, `/decisions${qs({ ...params, status })}`).then((r) => listOf(r, 'decisions')),
    })),
  });
}

/**
 * Every cached decisions *list* query, with the status set it was fetched for (VS-369). A list key
 * is `[...qk.decisions(ws), params]`; the decision-detail key `qk.decision(ws, id)` ends in a string
 * id and is skipped by the params check, exactly as `api/events.ts`'s `patchDecisionCaches` does.
 */
function decisionsLists(qc: QueryClient): Array<{ key: readonly unknown[]; statuses: readonly string[] | null }> {
  const out: Array<{ key: readonly unknown[]; statuses: readonly string[] | null }> = [];
  for (const q of qc.getQueryCache().findAll()) {
    const key = q.queryKey;
    if (!Array.isArray(key) || key.length < 3 || key[0] !== 'w' || key[2] !== 'decisions') continue;
    const params = key[key.length - 1];
    if (!params || typeof params !== 'object' || Array.isArray(params)) continue;
    const status = (params as { status?: string | readonly string[] }).status;
    out.push({ key, statuses: status === undefined ? null : Array.isArray(status) ? status : [status] });
  }
  return out;
}

export function useAnswerDecision(): UseMutationResult<unknown, Error, { id: string; ws?: string; key?: string; text?: string; remember?: boolean; inputs?: DecisionAnswerInputs; overrideHold?: boolean; overrideReason?: string }> {
  const ctxWs = useHookWs();
  const qc = useQueryClient();
  // VS-369: one POST per decision while it is in flight, so a double click cannot answer twice.
  const inFlight = useRef(new Set<string>());
  return useMutation({
    mutationFn: ({ id, ws: wsArg, ...body }) => {
      if (inFlight.current.has(id)) return Promise.resolve(undefined);
      inFlight.current.add(id);
      const ws = wsArg ?? ctxWs;
      return api.ws(ws, `/decisions/${id}/answer`, { method: 'POST', body }).finally(() => { inFlight.current.delete(id); });
    },
    onMutate: async (v) => {
      const ws = v.ws ?? ctxWs;
      // A list refetch already running would put the card back after we remove it, so stop those first.
      const keys = ws ? [qk.decisions(ws)] : decisionsLists(qc).map((l) => l.key);
      await Promise.all(keys.map((key) => qc.cancelQueries({ queryKey: key })));
      const snapshots: Array<{ key: readonly unknown[]; data: Decision[] }> = [];
      for (const { key, statuses } of decisionsLists(qc)) {
        const data = qc.getQueryData<Decision[]>(key);
        if (!data?.some((d) => d.id === v.id)) continue;
        snapshots.push({ key, data });
        // A list that keeps answered decisions (V1 chat's `['open', 'answered']` timeline) is the
        // record of the conversation, not a to-do list: leave it and let the refetch reconcile it.
        if (statuses === null || statuses.includes('answered')) continue;
        qc.setQueryData<Decision[]>(key, data.filter((d) => d.id !== v.id));
      }
      return { snapshots };
    },
    onError: (e, _v, ctx) => {
      // A closed decision is not a failed answer: it was answered/superseded/expired elsewhere, so it
      // stays gone and the refetch below reveals any replacement. Every other failure restores the card.
      if (isClosedRefusal(e) || !ctx) return;
      for (const { key, data } of ctx.snapshots) qc.setQueryData(key, data);
    },
    onSettled: (_d, _e, v) => {
      const ws = v.ws ?? ctxWs;
      const keys = ws ? [qk.decisions(ws)] : decisionsLists(qc).map((l) => l.key);
      for (const key of keys) void qc.invalidateQueries({ queryKey: key });
      if (ws) void qc.invalidateQueries({ queryKey: qk.briefing(ws) });
      void qc.invalidateQueries({ queryKey: qk.workspaces() });
    },
  });
}

/* ------------------------------------------------------------------ runs */

/** The runs list's filter and ordering query (VS-410), shared by every runs hook. */
export type RunQueryParams = {
  agent?: string;
  ticket?: string;
  status?: string;
  sort?: RunSortKey;
  dir?: RunSortDir;
  limit?: number;
  offset?: number;
};

export function useRuns(params: RunQueryParams = {}, wsOverride?: string): UseQueryResult<Run[]> {
  const ws = useHookWs(wsOverride);
  return useQuery({
    queryKey: [...qk.runs(ws), params],
    queryFn: () => api.ws<Run[] | { runs: Run[] }>(ws, `/runs${qs(params)}`).then((r) => listOf(r, 'runs')),
    enabled: Boolean(ws),
  });
}

export function useRunsMany(
  ids: readonly string[],
  params: RunQueryParams = {},
): UseQueryResult<Run[]>[] {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: [...qk.runs(id), params],
      queryFn: () => api.ws<Run[] | { runs: Run[] }>(id, `/runs${qs(params)}`).then((r) => listOf(r, 'runs')),
    })),
  });
}

/**
 * One page of runs per workspace, keeping the server's own `total` (VS-350). The Runs screen fans
 * these out and merges by recency, so it can offer a real load-more rather than guessing from a
 * full page. The key stays under `qk.runs(id)` so a runs invalidation still refreshes it.
 */
export function useRunPagesMany(ids: readonly string[], params: RunQueryParams = {}): UseQueryResult<{ runs: Run[]; total: number }>[] {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: [...qk.runs(id), 'page', params],
      queryFn: () =>
        api.ws<Run[] | { items?: Run[]; runs?: Run[]; total?: number }>(id, `/runs${qs(params)}`).then((r) => {
          const runs = listOf<Run>(r, 'runs');
          const total = !Array.isArray(r) && typeof r?.total === 'number' ? r.total : runs.length;
          return { runs, total };
        }),
    })),
  });
}

export function useRun(id: string): UseQueryResult<T.RunDetail> {
  const ws = useWs();
  return useQuery({ queryKey: qk.run(ws, id), queryFn: () => api.ws<unknown>(ws, `/runs/${id}`).then(runDetail), enabled: Boolean(id) });
}

/**
 * One run by id alone, for the global `/runs/$runId` route (VS-386). The run's own workspace is
 * resolved daemon-side, so the screen needs no `WorkspaceProvider` and does not assume which
 * workspace is first. Run started/finished events invalidate this key alongside `qk.run`.
 */
export function useRunGlobal(id: string): UseQueryResult<T.RunDetail> {
  return useQuery({ queryKey: qk.runGlobal(id), queryFn: () => api.root<unknown>(`/runs/${id}`).then(runDetail), enabled: Boolean(id) });
}

/** Events per page for `useRunEvents`; `newest` reads this many from the end of the run (VS-332). */
export const RUN_EVENT_PAGE = 500;

/**
 * A run's events. The default reads the head page (`?after=&limit=`); `newest` reads the last
 * {@link RUN_EVENT_PAGE} events instead, so a finished run whose ending matters does not render only
 * its opening (VS-332).
 */
export function useRunEvents(id: string, after = 0, wsOverride?: string, opts: { newest?: boolean } = {}): UseQueryResult<RunEvent[]> {
  const ws = useHookWs(wsOverride);
  const newest = opts.newest ?? false;
  return useQuery({
    queryKey: [...qk.runEvents(ws, id), newest ? 'tail' : 'head', ...(newest ? [] : [after])],
    queryFn: () => api.ws<RunEvent[] | { events: RunEvent[] }>(ws, `/runs/${id}/events${qs(newest ? { tail: RUN_EVENT_PAGE } : { after, limit: RUN_EVENT_PAGE })}`).then((r) => listOf(r, 'events')),
    enabled: Boolean(id) && Boolean(ws),
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
    enabled: Boolean(params.ids || (params.agent && params.since)),
  });
}

/* ------------------------------------------------------- knowledge/specs */

function knowledgeIndexOf(r: unknown): T.KnowledgeIndex {
  return Array.isArray(r) ? { files: r as T.KnowledgeIndex['files'], warnings: [] } : (r as T.KnowledgeIndex);
}

export function useKnowledgeIndex(wsOverride?: string): UseQueryResult<T.KnowledgeIndex> {
  const ws = useHookWs(wsOverride);
  return useQuery({ queryKey: qk.knowledge(ws), queryFn: () => api.ws<unknown>(ws, '/knowledge').then(knowledgeIndexOf), enabled: Boolean(ws) });
}

export function useKnowledgeIndexMany(ids: readonly string[]): UseQueryResult<T.KnowledgeIndex>[] {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.knowledge(id),
      queryFn: () => api.ws<unknown>(id, '/knowledge').then(knowledgeIndexOf),
    })),
  });
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

/** Every published artifact across the project's tickets (VS-270), for the document explorer's
 * Artifacts entry. `qk.artifacts` is its own root, not nested under `qk.knowledge` — see keys.ts. */
export function useProjectArtifacts(project?: string): UseQueryResult<T.TicketArtifactSummary[]> {
  const ws = useWs();
  return useQuery({ queryKey: qk.artifacts(ws, project), queryFn: () => api.ws<unknown>(ws, `/knowledge/artifacts${qs({ project })}`).then((r) => listOf<T.TicketArtifactSummary>(r)) });
}

/** A weaver's workspace-scoped artifacts (VS-297) — the explorer's workspace-level peer section to
 * `useProjectArtifacts` above, and the source the standalone `/w/:ws/artifacts/:key` page reads from. */
export function useWorkspaceArtifacts(): UseQueryResult<T.WeaverArtifactSummary[]> {
  const ws = useWs();
  return useQuery({ queryKey: qk.weaverArtifacts(ws), queryFn: () => api.ws<unknown>(ws, '/artifacts').then((r) => listOf<T.WeaverArtifactSummary>(r)) });
}

export function useWorkspaceArtifactRevisions(key: string): UseQueryResult<T.DocumentRevision[]> {
  const ws = useWs();
  return useQuery({
    queryKey: [...qk.weaverArtifactsRoot(ws), key, 'revisions'],
    queryFn: () => api.ws<Array<{ revision: number; authorKind: string; createdAt: string }>>(ws, `/artifacts/${key}/revisions`)
      .then((rows) => rows.map((r) => ({ ...r, reason: null }))),
    enabled: Boolean(key),
  });
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

/** Move an existing document to a different folder (or the scope root when `folder` is omitted) — VS-265. */
export function useKnowledgeMoveDoc(): UseMutationResult<{ path: string }, Error, { scope: string; slug: string; project?: string; folder?: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ scope, slug, project, folder }) =>
      api.ws<{ path: string }>(ws, `/knowledge/docs/${encodeURIComponent(scope)}/${encodeURIComponent(slug)}/move${qs({ project })}`, { method: 'POST', body: { folder } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.knowledge(ws) }),
  });
}

/** The dated archive files a scope has accumulated, most recent first — read-only (VS-265). */
export function useKnowledgeArchive(scope: string | null, project?: string): UseQueryResult<T.KnowledgeArchiveEntry[]> {
  const ws = useWs();
  return useQuery({
    queryKey: [...qk.knowledge(ws), 'archive', scope ?? '', project ?? ''],
    queryFn: () => api.ws<unknown>(ws, `/knowledge/${scope}/archive${qs({ project })}`).then((r) => listOf<T.KnowledgeArchiveEntry>(r)),
    enabled: Boolean(scope),
  });
}

export function useKnowledgeArchiveFile(scope: string | null, path: string | null, project?: string): UseQueryResult<T.KnowledgeArchiveFile> {
  const ws = useWs();
  return useQuery({
    queryKey: [...qk.knowledge(ws), 'archive-file', scope ?? '', path ?? '', project ?? ''],
    queryFn: () => api.ws<T.KnowledgeArchiveFile>(ws, `/knowledge/${scope}/archive/${path}${qs({ project })}`),
    enabled: Boolean(scope && path),
  });
}

/** One archive listing per requested (scope, project) root, in the same order — for the explorer's several roots at once. */
export function useKnowledgeArchiveMany(roots: readonly { scope: string; project?: string }[]): UseQueryResult<T.KnowledgeArchiveEntry[]>[] {
  const ws = useWs();
  return useQueries({
    queries: roots.map((r) => ({
      queryKey: [...qk.knowledge(ws), 'archive', r.scope, r.project ?? ''],
      queryFn: () => api.ws<unknown>(ws, `/knowledge/${r.scope}/archive${qs({ project: r.project })}`).then((res) => listOf<T.KnowledgeArchiveEntry>(res)),
    })),
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

export interface KnowledgeUsageParams extends Record<string, string | undefined> {
  project?: string;
  window?: UsageWindow;
}

/** Average knowledge tokens per run for a project and window (VS-110) — separate from `/usage`'s cost figure. */
export function useKnowledgeUsageSummary(params: KnowledgeUsageParams): UseQueryResult<T.KnowledgeUsageSummary> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.knowledgeUsageSummary(ws, params),
    queryFn: () => api.ws<T.KnowledgeUsageSummary>(ws, `/knowledge/usage/summary${qs(params)}`),
  });
}

/** The documents read most often in a project and window, most-read first. */
export function useKnowledgeUsageTop(params: KnowledgeUsageParams): UseQueryResult<T.KnowledgeDocumentUsage[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.knowledgeUsageTop(ws, params),
    queryFn: () => api.ws<T.KnowledgeDocumentUsage[]>(ws, `/knowledge/usage/top${qs(params)}`),
  });
}

/** Documents in the project's catalogue that no run read in the window — the point of measuring this at all. */
export function useKnowledgeUsageNeverRead(params: KnowledgeUsageParams): UseQueryResult<T.KnowledgeDocumentRef[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.knowledgeUsageNeverRead(ws, params),
    queryFn: () => api.ws<T.KnowledgeDocumentRef[]>(ws, `/knowledge/usage/never-read${qs(params)}`),
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
  error: Error | null;
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
    error: q.error,
    refetch: () => void refetch(),
    isLoadingOlder: isFetchingNextPage,
    hasOlder: hasNextPage,
    loadOlder: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
  };
}

export function usePostThreadMessage(): UseMutationResult<unknown, Error, { threadId: string; body: string; projectId?: string | null; blockId?: string | null; replyToMessageId?: string | null; files?: File[]; idempotencyKey?: string }> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, body, projectId, blockId, replyToMessageId, files, idempotencyKey }) => {
      // Attached files go as multipart/form-data, in the same request as the text (VS-133) — never
      // a separate upload step, so a failed send never leaves an orphaned upload behind.
      if (files?.length) {
        const form = new FormData();
        form.set('body', body);
        if (projectId) form.set('projectId', projectId);
        if (blockId) form.set('blockId', blockId);
        if (replyToMessageId) form.set('replyToMessageId', replyToMessageId);
        if (idempotencyKey) form.set('idempotencyKey', idempotencyKey);
        for (const f of files) form.append('files', f);
        return api.ws(ws, `/threads/${threadId}/messages`, { method: 'POST', raw: form });
      }
      return api.ws(ws, `/threads/${threadId}/messages`, { method: 'POST', body: { body, ...(projectId ? { projectId } : {}), ...(blockId ? { blockId } : {}), ...(replyToMessageId ? { replyToMessageId } : {}), ...(idempotencyKey ? { idempotencyKey } : {}) } });
    },
    onSettled: (_d, _e, v) => void qc.invalidateQueries({ queryKey: qk.threadMessages(ws, v.threadId) }),
  });
}

/** How long typing pauses before a search actually fires (VS-320) — short enough to feel live, long
 * enough that a fast typist does not fire one request per keystroke. */
const THREAD_SEARCH_DEBOUNCE_MS = 250;

/**
 * Full-text search over every message stored in a thread, not only the page loaded in
 * `useThreadMessages` (VS-320). Debounced client-side; an empty/whitespace query never reaches the
 * network and reports an empty result rather than "loading" or "no matches" — the empty state and
 * the no-match state are different things to the human, and only one of them is real here.
 */
export function useThreadSearch(threadId: string | null, query: string): { data: T.ThreadSearchResult[]; isLoading: boolean; isError: boolean } {
  const ws = useWs();
  // Starts empty regardless of `query`'s initial value, so a hook that ever mounted with a
  // non-empty query would still debounce that first value rather than firing it immediately.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), THREAD_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);
  const trimmed = debounced.trim();
  const enabled = Boolean(threadId) && trimmed.length > 0;
  const q = useQuery({
    queryKey: qk.threadSearch(ws, threadId ?? '', trimmed),
    queryFn: () => api.ws<T.ThreadSearchResult[]>(ws, `/threads/${threadId}/search${qs({ q: trimmed })}`),
    enabled,
  });
  return { data: enabled ? (q.data ?? []) : [], isLoading: enabled && q.isFetching, isError: enabled && q.isError };
}

/**
 * One bounded window of messages centered on `messageId`, oldest-first (VS-320) — for jumping to a
 * search result (or any known message id) outside the page `useThreadMessages` has loaded. A
 * one-shot query, not another `useInfiniteQuery`: the tailing hook's own result is never touched,
 * which is what lets the chat revert to it unchanged on "back to latest".
 */
export function useMessageContext(threadId: string | null, messageId: string | null): UseQueryResult<T.ThreadMessage[]> {
  const ws = useWs();
  return useQuery({
    queryKey: qk.threadContext(ws, threadId ?? '', messageId ?? ''),
    queryFn: () => api.ws<T.ThreadMessage[]>(ws, `/threads/${threadId}/messages${qs({ around: messageId })}`),
    enabled: Boolean(threadId) && Boolean(messageId),
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

// ---------------------------------------------------------------- channels

export function useTelegramTokenStatus(): UseQueryResult<T.TelegramTokenStatus> {
  const ws = useWs();
  return useQuery({ queryKey: qk.telegramToken(ws), queryFn: () => api.ws<T.TelegramTokenStatus>(ws, '/channels/telegram/token') });
}

export function useSetTelegramToken(): UseMutationResult<{ ok: true; botUsername: string | null }, Error, string> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token) => api.ws<{ ok: true; botUsername: string | null }>(ws, '/channels/telegram/token', { method: 'POST', body: { token } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.telegramToken(ws) }),
  });
}

export function useClearTelegramToken(): UseMutationResult<{ ok: true }, Error, void> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.ws<{ ok: true }>(ws, '/channels/telegram/token', { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.telegramToken(ws) }),
  });
}

/** VS-135: everyone who has messaged the bot while not on the allowlist — identity only, never their message. */
export function useTelegramPending(): UseQueryResult<{ pending: T.TelegramPendingUser[] }> {
  const ws = useWs();
  return useQuery({ queryKey: qk.telegramPending(ws), queryFn: () => api.ws<{ pending: T.TelegramPendingUser[] }>(ws, '/channels/telegram/pending') });
}

export function useApproveTelegramUser(): UseMutationResult<{ allowedUserIds: number[] }, Error, string> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (externalUserId) => api.ws<{ allowedUserIds: number[] }>(ws, `/channels/telegram/pending/${externalUserId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.telegramPending(ws) });
      void qc.invalidateQueries({ queryKey: qk.workspace(ws) });
    },
  });
}

export function useDisableTelegramAllowAll(): UseMutationResult<{ ok: true }, Error, void> {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.ws<{ ok: true }>(ws, '/channels/telegram/allow-all/disable', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.workspace(ws) }),
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
