/**
 * The global V2 Needs you screen (web-v2/needs-you).
 *
 * Every open human decision across the workspaces, each rendered as the complete V2 decision card.
 * Scope filters lead (`Everywhere` then each workspace), decision-kind chips follow, and the count
 * shown is the length of the one filtered array the list renders — never a second figure.
 *
 * The screen at `/v2/w/:ws/needs` and the one at `/v2/needs` are the same page: the scope starts
 * from the route (`useV2Scope`), which is how VS-343's workspace shortcut pre-applies it.
 */
import { useMemo, useState } from 'react';
import { projectLabel, type Decision, type DecisionAnswerInputs } from '@weave-ai/shared';
import { useAnswerDecision, useDecisionsMany, useTicketsMany, useWeaverMany, useWorkspaceProjects, useWorkspaces } from '../api/hooks';
import { NetworkError } from '../api/client';
import { enqueue } from '../lib/queue';
import { decisionCarriesSecret } from '../lib/decisionSecrets';
import { staleAnswerCopy } from '../lib/decisionStaleness';
import { SkeletonCards } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { useV2Scope, V2Page } from './V2Page';
import { V2DecisionCard, type V2Answer } from './DecisionCard';
import { cx } from '../lib/cx';

interface ChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: 'scope' | 'kind';
}

function Chip({ label, active, onClick, tone = 'kind' }: ChipProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'h-7 rounded-r4 border px-2.5 text-micro',
        active
          ? tone === 'scope'
            ? 'border-accent-edge bg-accent-tint text-text-1'
            : 'border-accent-edge text-text-1'
          : 'border-line-2 text-text-3 hover:text-text-1',
      )}
    >
      {label}
    </button>
  );
}

const KIND_LABEL: Record<string, string> = {
  plan_approval: 'Plans',
  merge_approval: 'Merges',
  action_approval: 'Actions',
  hire_approval: 'Hires',
  discard_approval: 'Discards',
  retry_approval: 'Retries',
  question: 'Questions',
  concern: 'Concerns',
  gate_finding: 'Gate findings',
  approval: 'Approvals',
};

/** A stable, kind-ordered list of the kinds actually present, so every chip filters real data. */
function kindsPresent(decisions: readonly Decision[]): string[] {
  const order = Object.keys(KIND_LABEL);
  const present = new Set<string>(decisions.map((d) => d.kind));
  return order.filter((k) => present.has(k));
}

/** The screen as a V2 destination: the standard header over the Needs you body. */
export function V2NeedsPage(): React.ReactElement {
  return (
    <V2Page title="Needs you">
      <V2NeedsScreen />
    </V2Page>
  );
}

export function V2NeedsScreen(): React.ReactElement {
  const workspaces = useWorkspaces();
  const listed = workspaces.data ?? [];
  const ids = listed.map((w) => w.id);
  const scope = useV2Scope();

  const [scopeFilter, setScopeFilter] = useState<string>(() => (scope.kind === 'workspace' ? scope.ws : 'all'));
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [answerError, setAnswerError] = useState<string | null>(null);

  const decisionsQueries = useDecisionsMany(ids, { status: 'open', owner: 'human' });
  const ticketQueries = useTicketsMany(ids, { limit: 300 });
  const projectsByWs = useWorkspaceProjects(ids);
  const weaverQueries = useWeaverMany(ids);
  const answer = useAnswerDecision();

  // Decisions owned by the human are raised by the weaver (or the system), not a worker — a worker's
  // ask goes to the weaver. So a question here reads as the weaver asking when the asker is that
  // workspace's weaver, and neutral otherwise (a system-raised decision has no agent).
  const weaverByWs = useMemo(() => {
    const map = new Map<string, string>();
    ids.forEach((id, i) => {
      const agentId = weaverQueries[i]?.data?.agent?.id;
      if (agentId) map.set(id, agentId);
    });
    return map;
  }, [ids.join('\0'), weaverQueries]);

  const ticketsById = useMemo(() => {
    const map = new Map<string, { identifier: string }>();
    for (const q of ticketQueries) for (const t of q.data ?? []) map.set(t.id, t);
    return map;
  }, [ticketQueries]);

  const all = useMemo(() => {
    const out: Decision[] = [];
    for (const q of decisionsQueries) for (const d of q.data ?? []) out.push(d);
    return out;
  }, [decisionsQueries]);

  const loaded = Boolean(workspaces.data) && decisionsQueries.every((q) => q.data !== undefined || q.isError);
  const errored = decisionsQueries.every((q) => q.isError) && decisionsQueries.length > 0;

  const kinds = kindsPresent(all);
  const filtered = useMemo(
    () => all.filter((d) => (scopeFilter === 'all' || d.workspaceId === scopeFilter) && (kindFilter === 'all' || d.kind === kindFilter)),
    [all, scopeFilter, kindFilter],
  );

  const onAnswer = (decision: Decision, a: V2Answer): void => {
    setAnswerError(null);
    const payload: { id: string; ws: string; key?: string; text?: string; inputs?: DecisionAnswerInputs; overrideHold?: boolean; overrideReason?: string } = {
      id: decision.id,
      ws: decision.workspaceId,
      ...a,
    };
    answer.mutate(payload, {
      onError: (e) => {
        if (e instanceof NetworkError && !decisionCarriesSecret(decision)) {
          enqueue({ kind: 'decision', path: `/decisions/${decision.id}/answer`, body: a, label: a.key ?? a.text ?? 'decision' });
          return;
        }
        const stale = staleAnswerCopy(e, decision.ticketId);
        setAnswerError(stale ? `${stale.title}: ${stale.detail}` : e.message);
      },
    });
  };

  if (workspaces.isError) {
    return <ErrorState code="WORKSPACES_QUERY_FAILED" message="Could not load workspaces." onRetry={() => void workspaces.refetch()} />;
  }
  if (!workspaces.data || !loaded) return <SkeletonCards count={2} />;
  if (errored) {
    return <ErrorState code="DECISIONS_STALE" message="Could not load what needs you." onRetry={() => void decisionsQueries[0]?.refetch()} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line-1 px-4 py-2">
        <Chip label="Everywhere" tone="scope" active={scopeFilter === 'all'} onClick={() => setScopeFilter('all')} />
        {listed.map((w) => (
          <Chip key={w.id} label={w.name} tone="scope" active={scopeFilter === w.id} onClick={() => setScopeFilter(w.id)} />
        ))}
        {kinds.length ? <span className="mx-1 h-4 w-px bg-line-2" aria-hidden /> : null}
        <Chip label="All" active={kindFilter === 'all'} onClick={() => setKindFilter('all')} />
        {kinds.map((k) => (
          <Chip key={k} label={KIND_LABEL[k] ?? k} active={kindFilter === k} onClick={() => setKindFilter(k)} />
        ))}
        <span className="ml-auto ac-mono text-micro text-text-3" aria-live="polite">
          {filtered.length} waiting
        </span>
      </div>
      {answerError ? (
        <p className="border-b border-line-1 px-4 py-2 text-micro text-blocked" role="status">
          {answerError}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {all.length === 0 ? (
          <EmptyState title="Nothing needs you right now." detail="Open decisions from every workspace show up here." />
        ) : filtered.length === 0 ? (
          <EmptyState title="Nothing in this filter." detail="Choose another scope or kind." />
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {filtered.map((d) => {
              const ticket = d.ticketId ? ticketsById.get(d.ticketId) : undefined;
              const projects = projectsByWs[d.workspaceId]?.projects ?? [];
              const project = projects.find((p) => p.id === (d.projectId ?? undefined));
              return (
                <V2DecisionCard
                  key={d.id}
                  decision={d}
                  ticketIdentifier={ticket?.identifier ?? d.ticketId}
                  projectLabel={project ? projectLabel(project) : null}
                  projectSlug={project?.slug ?? null}
                  ws={d.workspaceId}
                  askedBy={d.askedByAgentId}
                  asker={d.askedByAgentId && weaverByWs.get(d.workspaceId) === d.askedByAgentId ? 'weaver' : undefined}
                  busy={answer.isPending}
                  onAnswer={(a) => onAnswer(d, a)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
