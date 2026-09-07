import { useParams } from '@tanstack/react-router';
import { isActiveRun } from '@agent-conductor/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { RunTranscript } from '../components/RunTranscript';
import { SkeletonRows } from '../components/Skeleton';
import { ErrorState } from '../components/States';
import { StatTile } from '../components/Chart';
import { useRun } from '../api/hooks';
import { useRunEventStream } from '../api/runStream';
import { cents, duration, tokens } from '../lib/format';

export function RunRoute(): React.ReactElement {
  const { runId } = useParams({ strict: false }) as { runId: string };
  const run = useRun(runId);
  // A run page opened mid-turn follows the turn; one that is opened after it ended reads the
  // persisted events and stays still. `run.finished` invalidates this query, so a turn that ends
  // while the page is open closes its stream here without the human doing anything.
  const live = isActiveRun(run.data?.run.status);
  const { events } = useRunEventStream(runId, { live });

  if (run.isLoading) {
    return (
      <Page>
        <PageHeader title="Run" />
        <PageBody className="p-5">
          <SkeletonRows rows={6} />
        </PageBody>
      </Page>
    );
  }
  if (run.isError || !run.data) {
    return (
      <Page>
        <PageHeader title="Run" />
        <PageBody className="p-5">
          <ErrorState code="RUN_NOT_FOUND" message="That run is not in the database." />
        </PageBody>
      </Page>
    );
  }

  const { run: r, agent, ticket, phases, usage } = run.data;

  return (
    <Page>
      <PageHeader
        title={<span className="ac-mono">{r.id.slice(0, 12)}</span>}
        meta={
          <span className="ac-mono">
            {[agent?.name, ticket?.identifier, r.runtimeId, r.model, r.status].filter(Boolean).join(' · ')}
          </span>
        }
        actions={
          <a href={`/api/w/${encodeURIComponent(r.workspaceId)}/runs/${r.id}/log`} target="_blank" rel="noreferrer" className="text-micro">
            raw log ↗
          </a>
        }
      />
      <PageBody className="flex flex-col gap-4 p-4 md:p-5">
        <div className="flex gap-px overflow-hidden rounded-r6 border border-line-1 bg-line-1">
          <StatTile value={tokens((usage?.tokensIn ?? 0) + (usage?.tokensOut ?? 0))} caption="tokens" />
          <StatTile value={cents(usage?.costCents ?? r.costCents)} caption={`cost · ${usage?.costStatus ?? 'unpriced'}`} muted />
          <StatTile
            value={r.startedAt && r.finishedAt ? duration(new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) : '—'}
            caption="wall time"
            muted
          />
          <StatTile value={r.liveness ?? '—'} caption="liveness" muted />
        </div>

        {phases?.length ? (
          <section className="ac-card p-3.5">
            <div className="ac-label mb-2.5">Phase timings</div>
            <div className="flex flex-col gap-1.5">
              {phases.map((p) => {
                const max = Math.max(1, ...phases.map((x) => x.durationMs));
                return (
                  <div key={p.phase} className="flex items-center gap-3">
                    <span className="ac-mono w-36 flex-none text-micro text-text-3">{p.phase}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-bg-2">
                      <span className="block h-full rounded-pill bg-accent opacity-75" style={{ width: `${(p.durationMs / max) * 100}%` }} />
                    </span>
                    <span className="ac-mono w-16 flex-none text-right text-micro text-text-2">{duration(p.durationMs)}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="ac-card overflow-hidden">
          <div className="ac-label flex items-center gap-2 border-b border-line-1 px-3.5 py-2.5">
            Transcript
            {live ? <span className="ac-mono text-nano text-working">· following</span> : null}
          </div>
          <RunTranscript events={events} live={live} label="Run transcript" />
        </section>
      </PageBody>
    </Page>
  );
}
