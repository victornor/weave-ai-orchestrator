/**
 * V2's run detail (web-v2/runs, VS-350, HANDOFF §12).
 *
 * State and turn outcome, a metadata table (agent, model, started, duration, tokens with context,
 * cost, trigger), the full tool trace, and the run's own plain-language account of how it ended. A
 * running detail follows the turn; a finished one stays still (VS-332).
 */
import { useParams } from '@tanstack/react-router';
import { isActiveRun } from '@weave-ai/shared';
import { contextStrip, firstRequest, resolveModel } from '@weave-ai/render';
import { useRunGlobal, useRuntimeModels, useWeaverMany, useWorkersMany } from '../api/hooks';
import { useRunEventStream } from '../api/runStream';
import { useGo } from '../app/link';
import { ErrorState } from '../components/States';
import { SkeletonRows } from '../components/Skeleton';
import { StatusGlyph } from '../components/StatusGlyph';
import { RunTranscript } from '../components/RunTranscript';
import { STATUS_TEXT } from '../lib/status';
import { modelOptionLabel } from '../lib/runtime';
import { ago, cents, duration, tokens } from '../lib/format';
import { V2Page } from './V2Page';
import { RUN_UI, turnEnded } from './RunsPage';

/** A plain-language trigger from the signals the run row actually carries (see design.md). */
export function runTrigger(run: { retryOfRunId: string | null; wakeupIds: readonly string[] }): string {
  if (run.retryOfRunId) return `Retry of ${run.retryOfRunId.slice(0, 8)}`;
  if (run.wakeupIds.length > 0) return `Started by a wake (${run.wakeupIds.length})`;
  return 'Started directly';
}

export function V2RunPage(): React.ReactElement {
  const { runId } = useParams({ strict: false }) as { runId?: string };
  return (
    <V2Page title="Run" subtitle={runId}>
      <RunBody runId={runId ?? ''} />
    </V2Page>
  );
}

export function RunBody({ runId }: { runId: string }): React.ReactElement {
  const go = useGo();
  // The global route has no WorkspaceProvider; the run's own workspace comes back with the run, so
  // the stream and the worker-name lookup take it explicitly (VS-386).
  const detail = useRunGlobal(runId);
  const live = isActiveRun(detail.data?.run.status);
  const ws = detail.data?.run.workspaceId ?? '';
  const { events } = useRunEventStream(runId, { live, ws });

  const workers = useWorkersMany(ws ? [ws] : [], { includeRetired: true });
  const weavers = useWeaverMany(ws ? [ws] : []);
  const runtimeModels = useRuntimeModels(detail.data?.run.runtimeId ?? null);

  if (detail.isLoading) {
    return (
      <div className="p-5">
        <SkeletonRows rows={6} />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return <ErrorState code="RUN_NOT_FOUND" message="That run is not in the database." />;
  }

  const run = detail.data.run;
  // The agent is a worker or the workspace's weaver; an unresolved one reads as a neutral label,
  // never a sliced id (VS-403).
  const worker = workers[0]?.data?.find((w) => w.id === run.agentId);
  const weaver = weavers[0]?.data?.agent;
  const agentName = worker?.name ?? (weaver?.id === run.agentId ? weaver.name : 'Unknown agent');
  const resolved = resolveModel(runtimeModels.data ?? null, run.model);
  const modelLabel = resolved ? modelOptionLabel(resolved) : (run.model ?? '—');
  const ctx = contextStrip({ usage: run.usage, contextWindowTokens: resolved?.contextWindowTokens ?? null, hasRun: Boolean(run.startedAt) });
  const inOut = `${tokens(run.usage?.inputTokens ?? 0)} in · ${tokens(run.usage?.outputTokens ?? 0)} out`;
  const tokenValue = ctx ? `${inOut} · ${ctx.tokensLabel}/${ctx.windowLabel} ctx` : inOut;
  const wall = run.startedAt && run.finishedAt ? duration(new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) : '—';
  // VS-462: the turn's first request, split fresh/cached — a miss re-sends the whole conversation.
  const firstReq = firstRequest(run.usage);

  const meta: Array<[string, string]> = [
    ['agent', agentName],
    ['model', modelLabel],
    ['started', run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'],
    ['duration', wall],
    ['tokens', tokenValue],
    ...(firstReq ? [['first req', firstReq.label] as [string, string]] : []),
    ['cost', cents(run.costCents)],
    ['trigger', runTrigger(run)],
  ];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-5" data-v2-run={run.id}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusGlyph status={RUN_UI[run.status]} size="sm" pulse={run.status === 'running'} />
        <span className={`ac-mono text-ui ${STATUS_TEXT[RUN_UI[run.status]]}`}>{run.status}</span>
        <span className="v2-tag text-text-3">{turnEnded(run)}</span>
        <button type="button" onClick={() => go('/runs')} className="ml-auto text-micro text-text-2 hover:text-text-1">
          All runs
        </button>
      </div>

      <div className="v2-card" data-v2-run-meta>
        {meta.map(([k, v]) => (
          <div key={k} className="flex items-center gap-3 border-b border-line-1 px-3.5 py-2 last:border-b-0">
            <span className="ac-label flex-none" style={{ width: 72 }}>
              {k}
            </span>
            <span className="ac-mono min-w-0 flex-1 truncate text-micro text-text-1">{v}</span>
          </div>
        ))}
      </div>

      {firstReq?.missed ? (
        <div className="v2-card flex items-center gap-3 px-3.5 py-2" data-v2-run-cache-miss>
          <span className="ac-label flex-none text-needs-you">cache miss</span>
          <span className="ac-mono min-w-0 flex-1 truncate text-micro text-text-1">
            {firstReq.label} on the first request
          </span>
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="ac-label">What it did</div>
        <div className="v2-card overflow-hidden">
          <RunTranscript events={events} live={live} label="Run transcript" />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="ac-label">How it ended</div>
        <p className="v2-card p-3.5 text-meta leading-relaxed text-text-body" data-v2-run-summary>
          {run.summary ?? `The turn ${live ? 'is still running.' : `ended as ${run.status}.`}`}
        </p>
      </section>

      <div className="ac-mono text-nano text-text-3">{ago(run.startedAt ?? run.createdAt)}</div>
    </div>
  );
}
