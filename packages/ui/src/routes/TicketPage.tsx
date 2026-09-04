import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { ticketUiStatus } from '@openconductor/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Tabs } from '../components/Tabs';
import { StatusGlyph, Badge } from '../components/StatusGlyph';
import { Skeleton, SkeletonRows } from '../components/Skeleton';
import { ErrorState, EmptyState } from '../components/States';
import { Markdown } from '../components/Markdown';
import { Composer } from '../components/Composer';
import { Button } from '../components/Button';
import { Table } from '../components/Table';
import { StatTile } from '../components/Chart';
import {
  usePatchTicket,
  usePostComment,
  useTicket,
  useTicketComments,
  useTicketDocument,
  useTicketDocumentRevisions,
  useTicketRuns,
  useTicketUsage,
  useTicketWorkProducts,
  useAnswerDecision,
  useDecisions,
} from '../api/hooks';
import { useWs } from '../api/context';
import { useGo } from '../app/link';
import { ago, cents, duration, statusText, tokens } from '../lib/format';
import { isFolded } from '../lib/board';
import { cx } from '../lib/cx';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'plan', label: 'Plan' },
  { key: 'activity', label: 'Activity' },
  { key: 'work', label: 'Work' },
  { key: 'usage', label: 'Usage' },
] as const;

export function TicketRoute(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const { ticketId } = useParams({ strict: false }) as { ticketId: string };
  const [tab, setTab] = useState<string>('overview');
  const detail = useTicket(ticketId);
  const patch = usePatchTicket();

  if (detail.isLoading) {
    return (
      <Page>
        <PageHeader title={<Skeleton className="h-4 w-48" />} />
        <PageBody className="p-5">
          <SkeletonRows rows={5} />
        </PageBody>
      </Page>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <PageHeader title="Ticket" />
        <PageBody className="p-5">
          <ErrorState
            code="TICKET_NOT_FOUND"
            message={`No ticket ${ticketId} in this workspace.`}
            actions={
              <Button variant="link" onClick={() => go('/w/$ws/board', { params: { ws } })}>
                Back to board
              </Button>
            }
          />
        </PageBody>
      </Page>
    );
  }

  const { ticket, project, worker } = detail.data;
  const ui = ticketUiStatus(ticket.status);

  return (
    <Page>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <StatusGlyph status={ui} size="md" pulse={ui === 'working'} />
            <span className="oc-mono text-micro text-text-3">{ticket.identifier}</span>
            <span className="oc-truncate max-w-[50vw]">{ticket.title}</span>
          </span>
        }
        meta={
          <span className="flex items-center gap-2">
            {isFolded(ticket.status) ? <Badge tone="accent">{statusText(ticket.status)}</Badge> : null}
            {project ? <span className="oc-mono">{project.slug}</span> : null}
            {worker ? <span>{worker.name}</span> : null}
          </span>
        }
        actions={
          <label className="flex items-center gap-2">
            <span className="text-micro text-text-3">auto-merge</span>
            <button
              type="button"
              role="switch"
              aria-checked={ticket.autoMerge}
              aria-label="Auto-merge"
              onClick={() => patch.mutate({ id: ticket.id, patch: { autoMerge: !ticket.autoMerge } })}
              className={cx(
                'flex h-5 w-9 items-center rounded-pill border px-0.5 transition-colors duration-(--dur-fast) ease-oc',
                ticket.autoMerge ? 'justify-end border-accent bg-accent' : 'justify-start border-line-2 bg-bg-3',
              )}
            >
              <span className={cx('size-3.5 rounded-pill', ticket.autoMerge ? 'bg-accent-on' : 'bg-text-nav')} />
            </button>
          </label>
        }
        tabs={<Tabs items={TABS} active={tab} onChange={setTab} className="px-3 md:px-4" />}
      />
      <PageBody className="p-4 md:p-5">
        {tab === 'overview' ? <Overview ticketId={ticketId} /> : null}
        {tab === 'plan' ? <PlanTab ticketId={ticketId} ticketIdentifier={ticket.identifier} /> : null}
        {tab === 'activity' ? <ActivityTab ticketId={ticket.id} /> : null}
        {tab === 'work' ? <WorkTab ticketId={ticket.id} /> : null}
        {tab === 'usage' ? <UsageTab ticketId={ticket.id} /> : null}
      </PageBody>
    </Page>
  );
}

function Overview({ ticketId }: { ticketId: string }): React.ReactElement {
  const detail = useTicket(ticketId);
  const d = detail.data;
  if (!d) return <SkeletonRows rows={4} />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Markdown source={d.ticket.description || '_No description._'} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Facts
          title="Ticket"
          rows={[
            ['kind', d.ticket.kind],
            ['priority', d.ticket.priority],
            ['status', statusText(d.ticket.status)],
            ['created', ago(d.ticket.createdAt)],
          ]}
        />
        <Facts
          title="Delivery"
          rows={[
            ['project', d.project?.slug ?? '—'],
            ['worker', d.worker?.name ?? 'unassigned'],
            ['branch', d.worker?.branch ?? '—'],
            ['auto-merge', d.ticket.autoMerge ? 'on' : 'off'],
          ]}
        />
      </div>
      {d.blockers.length ? (
        <section>
          <div className="oc-label mb-2">Blocked by</div>
          <div className="oc-card divide-y divide-line-1">
            {d.blockers.map((b) => (
              <div key={b.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                <StatusGlyph status={ticketUiStatus(b.status)} size="xs" />
                <span className="oc-mono text-micro text-text-3">{b.identifier}</span>
                <span className="oc-truncate text-meta text-text-1">{b.title}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Facts({ title, rows }: { title: string; rows: Array<[string, string]> }): React.ReactElement {
  return (
    <div className="oc-card p-3.5">
      <div className="oc-label mb-2.5">{title}</div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-micro text-text-3">{k}</dt>
            <dd className="oc-mono text-micro text-text-1">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function PlanTab({ ticketId, ticketIdentifier }: { ticketId: string; ticketIdentifier: string }): React.ReactElement {
  const [revision, setRevision] = useState<number | undefined>();
  const doc = useTicketDocument(ticketId, 'plan', revision);
  const revisions = useTicketDocumentRevisions(ticketId, 'plan');
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  const answer = useAnswerDecision();
  const [revising, setRevising] = useState(false);
  const planDecision = decisions.data?.find((d) => d.kind === 'plan_approval' && (d.ticketId === ticketId || d.ticketId === ticketIdentifier));

  if (doc.isLoading) return <SkeletonRows rows={5} />;
  if (doc.isError || !doc.data) return <EmptyState title="No plan yet — the worker is proposing." detail="The plan arrives as a decision card when it is ready." />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {planDecision ? (
        <div className="flex flex-wrap items-center gap-2 rounded-r6 border border-accent-edge bg-accent-tint px-3.5 py-2.5">
          <StatusGlyph status="needs-you" size="sm" />
          <span className="flex-1 text-meta text-text-1">This plan is waiting on you.</span>
          <Button variant="primary" size="sm" onClick={() => answer.mutate({ id: planDecision.id, key: 'approve' })}>
            Approve
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setRevising((v) => !v)}>
            Revise…
          </Button>
        </div>
      ) : null}

      {revising && planDecision ? (
        <Composer
          rows={3}
          autoFocus
          scope={<span>Revising the plan for {ticketIdentifier}.</span>}
          placeholder="What should change?"
          submitLabel="Send revision"
          onSubmit={(t) => {
            answer.mutate({ id: planDecision.id, key: 'revise', text: t });
            setRevising(false);
          }}
        />
      ) : null}

      {(revisions.data?.length ?? 0) > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="oc-label">Revisions</span>
          {(revisions.data ?? []).map((r) => (
            <button
              key={r.revision}
              type="button"
              onClick={() => setRevision(r.revision)}
              className={cx(
                'oc-mono rounded-r4 border px-2 py-1 text-nano',
                (revision ?? doc.data.revision) === r.revision ? 'border-accent-edge bg-accent-tint text-accent-link' : 'border-line-2 text-text-3',
              )}
              title={r.reason ?? ''}
            >
              r{r.revision}
            </button>
          ))}
        </div>
      ) : null}

      <Markdown source={doc.data.body} />
    </div>
  );
}

function ActivityTab({ ticketId }: { ticketId: string }): React.ReactElement {
  const comments = useTicketComments(ticketId);
  const post = usePostComment();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {comments.isLoading ? (
        <SkeletonRows rows={4} />
      ) : (comments.data?.length ?? 0) === 0 ? (
        <EmptyState title="Nothing has happened yet." detail="Comments from you, the worker and the daemon land here." />
      ) : (
        <div className="flex flex-col gap-3">
          {(comments.data ?? []).map((c) => (
            <article key={c.id} className={cx('oc-card p-3.5', c.authorKind === 'human' && 'border-accent-edge')}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-micro font-medium text-text-soft">{c.authorKind === 'human' ? 'You' : c.authorKind === 'agent' ? 'Worker' : 'System'}</span>
                <Badge>{c.kind}</Badge>
                <div className="flex-1" />
                <span className="oc-mono text-nano text-text-4">{ago(c.createdAt)}</span>
              </div>
              <Markdown source={c.body} />
            </article>
          ))}
        </div>
      )}
      <Composer placeholder="Comment — the worker is woken by this…" submitLabel="Comment" onSubmit={(body) => post.mutate({ id: ticketId, body })} />
    </div>
  );
}

function WorkTab({ ticketId }: { ticketId: string }): React.ReactElement {
  const detail = useTicket(ticketId);
  const products = useTicketWorkProducts(ticketId);
  const runs = useTicketRuns(ticketId);
  const spec = detail.data?.openspecState;
  const done = spec?.tasks.filter((t) => t.done).length ?? 0;
  const total = spec?.tasks.length ?? 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <section>
        <div className="oc-label mb-2">Work products</div>
        {products.isLoading ? (
          <SkeletonRows rows={2} />
        ) : (products.data?.length ?? 0) === 0 ? (
          <EmptyState title="No branch or PR yet." detail="They appear as the worker pushes." />
        ) : (
          <div className="oc-card divide-y divide-line-1">
            {(products.data ?? []).map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <Badge>{p.type}</Badge>
                <span className="oc-mono oc-truncate flex-1 text-micro text-text-2">{p.ref ?? p.url ?? '—'}</span>
                {p.state ? <span className={cx('oc-mono text-nano', p.state === 'success' || p.state === 'merged' ? 'text-done' : p.state === 'failure' ? 'text-failed' : 'text-working')}>{p.state}</span> : null}
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-micro">
                    open ↗
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {spec ? (
        <section>
          <div className="oc-label mb-2">
            OpenSpec · {spec.changeName ?? 'change'} · {done}/{total} tasks
          </div>
          <div className="mb-2.5 h-1.5 overflow-hidden rounded-pill bg-bg-3">
            <div className="h-full bg-done" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <ul className="oc-card divide-y divide-line-1">
            {spec.tasks.map((t, i) => (
              <li key={i} className="flex items-start gap-2.5 px-3.5 py-2">
                <span className={cx('mt-0.5 size-3 flex-none rounded-r4 border', t.done ? 'border-done bg-done/20' : 'border-line-3')} aria-hidden />
                <span className={cx('text-meta', t.done ? 'text-text-3 line-through' : 'text-text-1')}>{t.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <div className="oc-label mb-2">Worktree</div>
        <div className="oc-card px-3.5 py-2.5">
          <span className="oc-mono text-micro text-text-2">
            {detail.data?.worker?.worktreePath ?? 'no worktree'} · {detail.data?.worker?.branch ?? 'no branch'}
          </span>
        </div>
      </section>

      <section>
        <div className="oc-label mb-2">Runs</div>
        <Table
          rows={runs.data ?? []}
          rowKey={(r) => r.id}
          emptyLabel="No runs yet."
          columns={[
            { key: 'status', header: 'Status', width: '7rem', mono: true, render: (r) => r.status },
            { key: 'model', header: 'Model', mono: true, render: (r) => r.model ?? '—' },
            { key: 'tok', header: 'Tokens', align: 'right', mono: true, render: (r) => tokens((r.usage?.inputTokens ?? 0) + (r.usage?.outputTokens ?? 0)) },
            { key: 'cost', header: 'Cost', align: 'right', mono: true, render: (r) => cents(r.costCents) },
            { key: 'when', header: 'When', align: 'right', mono: true, render: (r) => ago(r.startedAt) },
          ]}
        />
      </section>
    </div>
  );
}

function UsageTab({ ticketId }: { ticketId: string }): React.ReactElement {
  const usage = useTicketUsage(ticketId);
  if (usage.isLoading) return <SkeletonRows rows={3} />;
  const total = usage.data?.total;
  const subtree = usage.data?.subtree;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex gap-px overflow-hidden rounded-r6 border border-line-1 bg-line-1">
        <StatTile value={tokens((total?.tokensIn ?? 0) + (total?.tokensOut ?? 0))} caption="tokens on this ticket" />
        <StatTile value={cents(total?.costCents ?? null)} caption={`cost · ${total?.costStatus ?? 'unpriced'}`} muted />
        <StatTile value={String(total?.runs ?? 0)} caption="runs" muted />
        <StatTile value={duration(total?.durationMs ?? 0)} caption="agent time" muted />
      </div>
      {subtree ? (
        <div className="oc-card p-3.5">
          <div className="oc-label mb-2">Including children</div>
          <span className="oc-mono text-meta text-text-1">
            {tokens(subtree.tokensIn + subtree.tokensOut)} tok · {cents(subtree.costCents)} {subtree.costStatus}
          </span>
        </div>
      ) : null}
      {usage.data?.turns?.length ? (
        <Table
          rows={usage.data.turns}
          rowKey={(t) => t.runId}
          columns={[
            { key: 'run', header: 'Run', mono: true, render: (t) => t.runId.slice(0, 8) },
            { key: 'when', header: 'Started', mono: true, render: (t) => ago(t.startedAt) },
            { key: 'tok', header: 'Tokens', align: 'right', mono: true, render: (t) => tokens(t.tokens) },
            { key: 'cost', header: 'Cost', align: 'right', mono: true, render: (t) => cents(t.costCents) },
          ]}
        />
      ) : null}
    </div>
  );
}
