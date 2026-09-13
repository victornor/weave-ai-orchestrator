/**
 * V2 Usage (`/v2/w/:ws/usage`): what the workspace spent — tokens, cost, runs and their breakdowns —
 * over a chosen window and grain (web-v2/usage, PLAN §16.3).
 *
 * It is V1's Usage screen (`routes/Usage.tsx`) restyled: the same hooks, the same scoped query and the
 * same `@weave-ai/render` view models. The figure primitives (`components/Chart`,
 * `components/WindowGrainPicker`, `components/PlanLimits`, `components/RuntimeCredentials`) are shared
 * and token-driven, so they repaint in V2's Mono palette inside `.v2-root`; only the page frame, the
 * header actions and the section cards are V2's.
 */
import { useMemo, useState } from 'react';
import { projectLabel, type UsageGrain, type UsageWindow } from '@weave-ai/shared';
import { accountLimits, mixedBillingNote, showCost } from '@weave-ai/render';
import { WindowGrainPicker } from '../../components/WindowGrainPicker';
import { RankedBars, ShareBar, StackedBars, StatTile, LineSeries, seriesColor } from '../../components/Chart';
import { PlanLimits } from '../../components/PlanLimits';
import { RuntimeCredentials } from '../../components/RuntimeCredentials';
import { SkeletonRows } from '../../components/Skeleton';
import { EmptyState, ErrorState } from '../../components/States';
import {
  useKnowledgeUsageNeverRead,
  useKnowledgeUsageSummary,
  useKnowledgeUsageTop,
  useProjects,
  useUsage,
  useUsageAccounts,
  useUsageCredentials,
  useUsageModels,
  useUsageTop,
} from '../../api/hooks';
import { usePlanSync } from '../../lib/planSync';
import { dayLabel, cents, pct, tokens } from '../../lib/format';
import { cx } from '../../lib/cx';
import { V2Page } from '../V2Page';

/** A V2 section: the card and its heading, the one recipe every breakdown uses. */
function Section({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="v2-card p-4">
      <div className="mb-3.5 flex items-center gap-2 text-meta font-medium text-text-soft">
        <span>{title}</span>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function V2UsageScreen(): React.ReactElement {
  const [window, setWindow] = useState<UsageWindow>('week');
  const [grain, setGrain] = useState<UsageGrain>('day');
  const [custom, setCustom] = useState<{ start: string; end: string }>({
    start: new Date(Date.now() - 7 * 86400e3).toISOString(),
    end: new Date().toISOString(),
  });
  const [model, setModel] = useState<string | null>(null);

  const params = useMemo(
    () => ({ scope: model ? `model:${model}` : 'workspace', window, grain, ...(window === 'custom' ? custom : {}) }),
    [window, grain, custom, model],
  );

  const series = useUsage(params);
  const projects = useProjects();
  const topProjects = useUsageTop({ ...params, by: 'project' });
  const topTickets = useUsageTop({ ...params, by: 'ticket' });
  const topRoles = useUsageTop({ ...params, by: 'role' });
  const topWorkers = useUsageTop({ ...params, by: 'worker' });
  const models = useUsageModels(params);
  const accounts = useUsageAccounts();
  const credentials = useUsageCredentials();
  const planSync = usePlanSync();
  const knowledgeWindow = window === 'custom' ? 'all' : window;
  const knowledgeSummary = useKnowledgeUsageSummary({ window: knowledgeWindow });
  const knowledgeTop = useKnowledgeUsageTop({ window: knowledgeWindow });
  const knowledgeNeverRead = useKnowledgeUsageNeverRead({ window: knowledgeWindow });

  const total = series.data?.total;
  const headlineTokens = (total?.tokensIn ?? 0) + (total?.tokensOut ?? 0);
  const reportedShare = series.data?.reportedShare;
  const withCost = showCost(series.data?.billingMix);
  const plans = accountLimits(accounts.data ?? [], new Date());

  const projectKeys = (projects.data ?? []).map((p) => ({ key: p.id, label: projectLabel(p) }));
  const buckets = (series.data?.series ?? []).map((pt) => ({
    label: dayLabel(pt.bucket, grain),
    parts: projectKeys.length
      ? projectKeys.map((k) => ({ key: k.key, value: (pt as unknown as Record<string, number>)[`project:${k.key}`] ?? 0 }))
      : [{ key: 'all', value: pt.tokensIn + pt.tokensOut }],
  }));
  const flatBuckets = buckets.every((b) => b.parts.every((p) => p.value === 0))
    ? (series.data?.series ?? []).map((pt) => ({ label: dayLabel(pt.bucket, grain), parts: [{ key: 'all', value: pt.tokensIn + pt.tokensOut }] }))
    : buckets;
  const barKeys = flatBuckets[0]?.parts[0]?.key === 'all' ? [{ key: 'all', label: 'tokens' }] : projectKeys;

  return (
    <V2Page
      title="Usage"
      actions={
        <WindowGrainPicker window={window} grain={grain} onWindow={setWindow} onGrain={setGrain} custom={custom} onCustom={setCustom} />
      }
    >
      <div className="flex flex-col gap-4 p-4 md:p-5">
        {model ? (
          <button type="button" onClick={() => setModel(null)} className="v2-link self-start text-micro">
            filtered to {model} — clear
          </button>
        ) : null}

        {/* Above the usage conditional on purpose: a runtime whose login expired has no usage
            precisely because everything on it is stopped, and that is when this matters most. */}
        <RuntimeCredentials credentials={credentials.data ?? []} />

        <Section
          title="Knowledge context"
          extra={
            <span className="ac-mono text-nano text-text-4">
              hub and document tokens a run actually consumed, not the billed figures above
            </span>
          }
        >
          <div className="mb-3.5 flex gap-px overflow-hidden rounded-r6 border border-line-1 bg-line-1">
            <StatTile value={tokens(Math.round(knowledgeSummary.data?.averageTokensPerRun ?? 0))} caption="avg knowledge tokens / run" />
            <StatTile value={String(knowledgeNeverRead.data?.length ?? 0)} caption="documents never read" muted />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-micro text-text-2">Read most often</div>
              {knowledgeTop.data?.length ? (
                <RankedBars
                  rows={knowledgeTop.data.slice(0, 8).map((d) => ({
                    key: `${d.scope}:${d.projectId ?? ''}:${d.slug}`,
                    label: d.title ?? d.slug,
                    sublabel: d.scope,
                    value: d.tokens,
                    right: `${d.reads} reads`,
                  }))}
                />
              ) : (
                <EmptyState title="No documents read" detail="Nothing has been read in this window yet." />
              )}
            </div>
            <div>
              <div className="mb-2 text-micro text-text-2">Never read</div>
              {knowledgeNeverRead.data?.length ? (
                <div className="flex flex-col gap-1.5">
                  {knowledgeNeverRead.data.slice(0, 8).map((d) => (
                    <div key={`${d.scope}:${d.projectId ?? ''}:${d.slug}`} className="flex items-center justify-between gap-2">
                      <span className="ac-mono ac-truncate flex-1 text-micro text-text-soft">{d.title ?? d.slug}</span>
                      <span className="ac-mono text-micro text-text-4">{d.scope}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Every document has been read" detail="Nothing in the catalogue is going unused in this window." />
              )}
            </div>
          </div>
        </Section>

        {series.isLoading ? (
          <SkeletonRows rows={6} />
        ) : series.isError ? (
          <ErrorState code="USAGE_QUERY_FAILED" message="Usage could not be computed for this window." onRetry={() => void series.refetch()} />
        ) : headlineTokens === 0 ? (
          <EmptyState title="No usage in this window." detail="Widen the window, or wait for the next run." />
        ) : (
          <>
            <div className="flex flex-wrap gap-px overflow-hidden rounded-r6 border border-line-1 bg-line-1">
              <StatTile value={tokens(headlineTokens)} caption={`tokens this ${window}`} />
              {withCost ? (
                <StatTile
                  value={cents(total?.costCents ?? null)}
                  caption={reportedShare != null ? `cost · ${Math.round(reportedShare * 100)}% reported` : `cost · ${total?.costStatus ?? 'unpriced'}`}
                  muted
                />
              ) : null}
              <StatTile value={String(total?.runs ?? 0)} caption="runs" muted />
              <StatTile
                value={total ? pct(total.tokensCached, Math.max(1, total.tokensIn + total.tokensCached)) : '0%'}
                caption="cached input"
                muted
              />
            </div>

            <PlanLimits accounts={plans} mixedNote={mixedBillingNote(series.data?.billingMix)} sync={planSync} />

            <Section title={`Tokens per ${grain} by project`}>
              <StackedBars buckets={flatBuckets} keys={barKeys} />
            </Section>

            <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
              <div className="flex flex-col gap-4">
                <Section title={`Top tickets by ${withCost ? 'cost' : 'tokens'} · subtree rollup`}>
                  <RankedBars
                    rows={(topTickets.data ?? []).slice(0, 8).map((r) => ({
                      key: r.key,
                      label: r.label,
                      sublabel: r.sublabel ?? null,
                      value: r.tokens,
                      ...(withCost ? { right: cents(r.costCents) } : {}),
                    }))}
                  />
                </Section>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Section title="By role">
                    <RankedBars rows={(topRoles.data ?? []).slice(0, 6).map((r) => ({ key: r.key, label: r.label, value: r.tokens, ...(withCost ? { right: cents(r.costCents) } : {}) }))} />
                  </Section>
                  <Section title="By worker">
                    <RankedBars rows={(topWorkers.data ?? []).slice(0, 6).map((r) => ({ key: r.key, label: r.label, value: r.tokens, ...(withCost ? { right: cents(r.costCents) } : {}) }))} />
                  </Section>
                </div>

                <Section
                  title={`Runs per ${grain}`}
                  extra={total?.runs ? <span className="ac-mono text-micro text-text-3">{total.runs} total</span> : null}
                >
                  <LineSeries points={(series.data?.series ?? []).map((p) => p.runs)} label="runs" />
                </Section>
              </div>

              <div className="flex flex-col gap-4">
                <Section title="Model mix">
                  <ShareBar className="mb-3.5" parts={(models.data ?? []).map((m) => ({ key: m.model, value: m.tokens }))} />
                  <div className="flex flex-col gap-2.5">
                    {(models.data ?? []).map((m, i) => (
                      <button key={m.model} type="button" onClick={() => setModel(m.model)} className="flex items-center gap-2.5 text-left">
                        <span className="size-2 flex-none rounded-r4" style={{ background: seriesColor(i) }} />
                        <span className="ac-mono ac-truncate flex-1 text-micro text-text-soft">{m.model}</span>
                        <span className="ac-mono text-micro text-text-1">{tokens(m.tokens)}</span>
                        {withCost ? <span className="ac-mono w-9 text-right text-micro text-text-nav">{cents(m.costCents)}</span> : null}
                      </button>
                    ))}
                  </div>
                  <p className="ac-mono mt-3 border-t border-line-1 pt-2.5 text-nano text-text-4">click a model to filter the whole page</p>
                </Section>

                <Section title="Project share">
                  <div className="flex flex-col gap-3">
                    {(topProjects.data ?? []).map((p, i) => {
                      const totalTok = Math.max(1, (topProjects.data ?? []).reduce((s, x) => s + x.tokens, 0));
                      return (
                        <div key={p.key}>
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className="size-2 rounded-r4" style={{ background: seriesColor(i) }} />
                            <span className="ac-mono flex-1 text-micro text-text-soft">{p.label}</span>
                            <span className="ac-mono text-micro text-text-2">{pct(p.tokens, totalTok)}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-r4 bg-bg-2">
                            <div className={cx('h-full rounded-r4 opacity-75')} style={{ width: `${(p.tokens / totalTok) * 100}%`, background: seriesColor(i) }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              </div>
            </div>
          </>
        )}
      </div>
    </V2Page>
  );
}
